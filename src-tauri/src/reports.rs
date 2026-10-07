use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        DeleteSaleInput, Dre, DreCategoria, DreDia, LocalUser, ReportDeletedSale, ReportItem,
        ReportMovement, ReportRange, ReportSale,
    },
};

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// O período chega como `AAAA-MM-DD`; a comparação é feita sobre `business_date`.
/// Quantos dias para trás o papel do ator pode olhar. `None` = sem limite.
///
/// Vem do papel, não da sessão: o dono muda o número no perfil e vale na
/// próxima consulta, sem a pessoa precisar sair e entrar. Master nunca é
/// limitado — é quem administra o limite.
pub fn history_days(connection: &Connection, actor: &LocalUser) -> AppResult<Option<i64>> {
    let row: Option<(bool, i64)> = connection
        .query_row(
            "SELECT is_master, history_days FROM roles WHERE key = ?1",
            [&actor.role],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(match row {
        Some((true, _)) => None,
        Some((false, dias)) if dias > 0 => Some(dias),
        _ => None,
    })
}

/// Primeira data que o ator pode consultar, ou `None` quando não há limite.
pub fn earliest_allowed(connection: &Connection, actor: &LocalUser) -> AppResult<Option<chrono::NaiveDate>> {
    Ok(history_days(connection, actor)?.map(|dias| {
        chrono::Local::now().date_naive() - chrono::Duration::days(dias - 1)
    }))
}

fn validate_range(
    connection: &Connection,
    actor: &LocalUser,
    range: &ReportRange,
) -> AppResult<(String, String)> {
    let parse = |value: &str| {
        chrono::NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
            .map_err(|_| AppError::Validation("período inválido".into()))
    };
    let from = parse(&range.from)?;
    let to = parse(&range.to)?;
    if from > to {
        return Err(AppError::Validation(
            "a data inicial não pode ser maior que a final".into(),
        ));
    }
    if let Some(minimo) = earliest_allowed(connection, actor)? {
        if from < minimo {
            return Err(AppError::Validation(format!(
                "seu perfil só consulta a partir de {}",
                minimo.format("%d/%m/%Y")
            )));
        }
    }
    Ok((from.to_string(), to.to_string()))
}

/// Percentual seguro: divisão por zero vira zero, não NaN.
///
/// Um NaN atravessa o JSON como `null` e a tela imprime "NaN%" para o gerente
/// num dia sem venda.
fn percentual(parte: i64, total: i64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    (parte as f64 / total as f64) * 100.0
}

/// Demonstrativo de resultado do período.
pub fn dre(connection: &Connection, actor: &LocalUser, range: ReportRange) -> AppResult<Dre> {
    require(actor, "reports.view")?;
    // Resultado financeiro é permissão à parte: o dono decide quem vê o total.
    require(actor, "reports.result")?;
    let (from, to) = validate_range(connection, actor, &range)?;

    // Cabeçalho da venda: receita, desconto e meios de pagamento.
    let (vendas, receita_bruta, descontos, dinheiro, cartao, pix, troco): (
        i64, i64, i64, i64, i64, i64, i64,
    ) = connection.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(subtotal_cents), 0),
                COALESCE(SUM(discount_cents), 0),
                COALESCE(SUM(cash_tendered_cents), 0),
                COALESCE(SUM(card_cents), 0),
                COALESCE(SUM(pix_cents), 0),
                COALESCE(SUM(change_cents), 0)
         FROM sales WHERE status = 'completed' AND business_date BETWEEN ?1 AND ?2",
        params![from, to],
        |row| {
            Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?,
            ))
        },
    )?;

    // CMV e unidades pelo custo congelado no item.
    let (cmv, unidades, itens_total, itens_sem_custo): (i64, i64, i64, i64) = connection
        .query_row(
            "SELECT COALESCE(SUM(i.quantity * COALESCE(i.unit_cost_cents, 0)), 0),
                    COALESCE(SUM(i.quantity), 0),
                    COUNT(*),
                    COALESCE(SUM(CASE WHEN i.unit_cost_cents IS NULL THEN 1 ELSE 0 END), 0)
             FROM sale_items i
             JOIN sales s ON s.id = i.sale_id
             WHERE s.status = 'completed' AND s.business_date BETWEEN ?1 AND ?2",
            params![from, to],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;

    // Devoluções pela data do estorno, não da venda: é quando o dinheiro sai.
    let devolucoes: i64 = connection.query_row(
        "SELECT COALESCE(SUM(r.amount_cents), 0)
         FROM sale_returns r JOIN sales s ON s.id = r.sale_id
         WHERE s.status = 'completed'
           AND date(r.occurred_at, 'localtime') BETWEEN ?1 AND ?2",
        params![from, to],
        |row| row.get(0),
    )?;

    let receita_liquida = receita_bruta - descontos - devolucoes;
    let lucro_bruto = receita_liquida - cmv;

    let mut st = connection.prepare(
        "SELECT i.category,
                COALESCE(SUM(i.subtotal_cents), 0),
                COALESCE(SUM(i.quantity * COALESCE(i.unit_cost_cents, 0)), 0),
                COALESCE(SUM(i.quantity), 0),
                COALESCE(SUM(CASE WHEN i.unit_cost_cents IS NULL THEN 1 ELSE 0 END), 0)
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         WHERE s.status = 'completed' AND s.business_date BETWEEN ?1 AND ?2
         GROUP BY i.category
         ORDER BY 2 DESC",
    )?;
    let por_categoria: Vec<DreCategoria> = st
        .query_map(params![from, to], |row| {
            let receita: i64 = row.get(1)?;
            let custo: i64 = row.get(2)?;
            Ok(DreCategoria {
                categoria: row.get(0)?,
                receita_cents: receita,
                cmv_cents: custo,
                lucro_cents: receita - custo,
                margem_percentual: percentual(receita - custo, receita),
                participacao_percentual: percentual(receita, receita_bruta),
                unidades: row.get(3)?,
                itens_sem_custo: row.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let mut st = connection.prepare(
        "SELECT s.business_date,
                COALESCE(SUM(i.subtotal_cents), 0),
                COALESCE(SUM(i.quantity * COALESCE(i.unit_cost_cents, 0)), 0),
                COUNT(DISTINCT s.id)
         FROM sales s
         LEFT JOIN sale_items i ON i.sale_id = s.id
         WHERE s.status = 'completed' AND s.business_date BETWEEN ?1 AND ?2
         GROUP BY s.business_date
         ORDER BY s.business_date",
    )?;
    let por_dia: Vec<DreDia> = st
        .query_map(params![from, to], |row| {
            let receita: i64 = row.get(1)?;
            let custo: i64 = row.get(2)?;
            Ok(DreDia {
                dia: row.get(0)?,
                receita_cents: receita,
                cmv_cents: custo,
                lucro_cents: receita - custo,
                vendas: row.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    Ok(Dre {
        receita_bruta_cents: receita_bruta,
        descontos_cents: descontos,
        devolucoes_cents: devolucoes,
        receita_liquida_cents: receita_liquida,
        cmv_cents: cmv,
        lucro_bruto_cents: lucro_bruto,
        margem_percentual: percentual(lucro_bruto, receita_liquida),
        itens_sem_custo,
        itens_total,
        vendas,
        unidades,
        ticket_medio_cents: if vendas == 0 { 0 } else { receita_liquida / vendas },
        dinheiro_cents: dinheiro - troco,
        cartao_cents: cartao,
        pix_cents: pix,
        troco_cents: troco,
        por_categoria,
        por_dia,
    })
}

pub fn sales(
    connection: &Connection,
    actor: &LocalUser,
    range: ReportRange,
) -> AppResult<Vec<ReportSale>> {
    require(actor, "reports.sales")?;
    let (from, to) = validate_range(connection, actor, &range)?;
    let mut statement = connection.prepare(
        "SELECT s.id, s.sale_number, s.created_at, s.operator_name,
                COALESCE((SELECT SUM(i.quantity) FROM sale_items i WHERE i.sale_id = s.id), 0),
                s.total_cents, s.cash_tendered_cents, s.card_cents,
                s.discount_cents, COALESCE(s.discount_reason, ''), COALESCE(s.customer_name, '')
         FROM sales s
         WHERE s.status = 'completed' AND s.business_date BETWEEN ?1 AND ?2
         ORDER BY s.created_at DESC, s.rowid DESC",
    )?;
    let rows = statement.query_map(params![from, to], |row| {
        Ok(ReportSale {
            id: row.get(0)?,
            sale_number: row.get(1)?,
            created_at: row.get(2)?,
            operator_name: row.get(3)?,
            items_count: row.get(4)?,
            total_cents: row.get(5)?,
            cash_cents: row.get(6)?,
            card_cents: row.get(7)?,
            discount_cents: row.get(8)?,
            discount_reason: row.get(9)?,
            customer_name: row.get(10)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Itens vendidos no período. Alimenta as abas "Hora em hora" e "Por categoria".
pub fn items(
    connection: &Connection,
    actor: &LocalUser,
    range: ReportRange,
) -> AppResult<Vec<ReportItem>> {
    if require(actor, "reports.categories").is_err() {
        require(actor, "reports.hourly")?;
    }
    let (from, to) = validate_range(connection, actor, &range)?;
    let mut statement = connection.prepare(
        "SELECT i.sale_id, i.category, i.product_name, i.quantity, i.subtotal_cents, s.created_at,
                COALESCE(p.subcategory, '')
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         LEFT JOIN products p ON p.code = i.product_code
         WHERE s.status = 'completed' AND s.business_date BETWEEN ?1 AND ?2
         ORDER BY s.created_at DESC",
    )?;
    let rows = statement.query_map(params![from, to], |row| {
        Ok(ReportItem {
            sale_id: row.get(0)?,
            category: row.get(1)?,
            product_name: row.get(2)?,
            quantity: row.get(3)?,
            subtotal_cents: row.get(4)?,
            created_at: row.get(5)?,
            subcategory: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn movements(
    connection: &Connection,
    actor: &LocalUser,
    range: ReportRange,
) -> AppResult<Vec<ReportMovement>> {
    require(actor, "reports.stock")?;
    let (from, to) = validate_range(connection, actor, &range)?;
    let mut statement = connection.prepare(
        "SELECT m.id, p.name, m.delta, m.reason, m.actor_name, m.occurred_at
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         WHERE date(m.occurred_at, 'localtime') BETWEEN ?1 AND ?2
         ORDER BY m.occurred_at DESC",
    )?;
    let rows = statement.query_map(params![from, to], |row| {
        Ok(ReportMovement {
            id: row.get(0)?,
            product_name: row.get(1)?,
            delta: row.get(2)?,
            reason: row.get(3)?,
            actor_name: row.get(4)?,
            occurred_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn deleted_sales(
    connection: &Connection,
    actor: &LocalUser,
    range: ReportRange,
) -> AppResult<Vec<ReportDeletedSale>> {
    require(actor, "reports.closing")?;
    let (from, to) = validate_range(connection, actor, &range)?;
    let mut statement = connection.prepare(
        "SELECT sale_number, total_cents, operator_name, deleted_by_name, reason, deleted_at
         FROM deleted_sales
         WHERE business_date BETWEEN ?1 AND ?2
         ORDER BY deleted_at DESC",
    )?;
    let rows = statement.query_map(params![from, to], |row| {
        Ok(ReportDeletedSale {
            sale_number: row.get(0)?,
            total_cents: row.get(1)?,
            operator_name: row.get(2)?,
            deleted_by_name: row.get(3)?,
            reason: row.get(4)?,
            deleted_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Exclui a venda devolvendo o estoque e registrando o motivo, como no legado.
pub fn delete_sale(
    connection: &mut Connection,
    actor: &LocalUser,
    input: DeleteSaleInput,
) -> AppResult<()> {
    require(actor, "reports.sales")?;
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "informe o motivo da exclusão".into(),
        ));
    }
    if reason.chars().count() > 300 {
        return Err(AppError::Validation("motivo longo demais".into()));
    }

    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;

    let venda: Option<(i64, String, i64, String, String)> = transaction
        .query_row(
            "SELECT sale_number, business_date, total_cents, operator_name, created_at
             FROM sales WHERE id = ?1 AND status = 'completed'",
            params![input.sale_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    let (sale_number, business_date, total_cents, operator_name, created_at) =
        venda.ok_or(AppError::NotFound)?;

    // Devolve o estoque de cada item ao produto de origem.
    let itens: Vec<(String, Option<String>, i64, String)> = {
        let mut statement = transaction.prepare(
            "SELECT id, product_id, quantity, product_name FROM sale_items WHERE sale_id = ?1",
        )?;
        let rows = statement.query_map(params![input.sale_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (sale_item_id, product_id, quantity, _) in &itens {
        if let Some(id) = product_id {
            transaction.execute(
                "UPDATE products SET stock_quantity = stock_quantity + ?1, revision = revision + 1, updated_at = ?2
                 WHERE id = ?3",
                params![quantity, now, id],
            )?;

            // Devolve também aos lotes de origem, como a devolução já fazia.
            // Repor só no produto fazia o saldo total voltar e o saldo por lote
            // não: a partir daí o FEFO enxergava menos mercadoria do que a tela
            // mostrava, e a divergência era permanente e sem rastro.
            let lotes: Vec<(String, i64)> = {
                let mut st = transaction.prepare(
                    "SELECT batch_id, quantity - returned_quantity
                     FROM sale_item_batches
                     WHERE sale_item_id = ?1 AND quantity > returned_quantity
                     ORDER BY rowid DESC",
                )?;
                let rows = st.query_map(params![sale_item_id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            for (batch_id, ainda_no_lote) in lotes {
                transaction.execute(
                    "UPDATE product_batches
                     SET quantity = quantity + ?1, revision = revision + 1, updated_at = ?2
                     WHERE id = ?3",
                    params![ainda_no_lote, now, batch_id],
                )?;
                transaction.execute(
                    "UPDATE sale_item_batches
                     SET returned_quantity = returned_quantity + ?1
                     WHERE sale_item_id = ?2 AND batch_id = ?3",
                    params![ainda_no_lote, sale_item_id, batch_id],
                )?;
            }
            transaction.execute(
                "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason, reference_type,
                                              reference_id, actor_id, actor_name, occurred_at)
                 VALUES (?1, ?2, NULL, ?3, 'sale.cancelled', 'sale', ?4, ?5, ?6, ?7)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    quantity,
                    input.sale_id,
                    actor.id,
                    actor.full_name,
                    now
                ],
            )?;
        }
    }

    transaction.execute(
        "UPDATE sales SET status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2,
                          cancel_reason = ?3, revision = revision + 1
         WHERE id = ?4",
        params![now, actor.id, reason, input.sale_id],
    )?;

    transaction.execute(
        "INSERT INTO deleted_sales (id, sale_id, sale_number, business_date, total_cents,
                                    sale_created_at, operator_name, deleted_by, deleted_by_name,
                                    reason, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            Uuid::new_v4().to_string(),
            input.sale_id,
            sale_number,
            business_date,
            total_cents,
            created_at,
            operator_name,
            actor.id,
            actor.full_name,
            reason,
            now
        ],
    )?;

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'sale.delete', 'sale', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            input.sale_id,
            serde_json::json!({ "reason": reason, "sale_number": sale_number }).to_string(),
            now
        ],
    )?;

    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests_cancelamento {
    use super::*;
    use crate::{
        db,
        models::{FinalizeSaleInput, SaleItemInput},
        sales,
    };

    fn gerente() -> LocalUser {
        LocalUser {
            id: "g1".into(),
            username: "g".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "master".into(),
            permissions: vec!["pdv.use".into(), "reports.sales".into()],
            must_change_password: false,
        }
    }

    /// Cancelar venda tem que devolver o estoque AO LOTE, não só ao total.
    ///
    /// Repor só no produto fazia o saldo total voltar e o saldo por lote não:
    /// a partir daí o FEFO enxergava menos mercadoria do que a tela mostrava,
    /// e a divergência era permanente e sem rastro.
    #[test]
    fn cancelar_venda_recompoe_os_lotes() {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1','g','x','Gerente','master',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','B1','Coca','Bebidas','',700,10,1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO product_batches (id, product_id, expiry_date, quantity, created_at, updated_at)
             VALUES ('b1','p1','2027-01-01',10,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents, status, created_at)
             VALUES ('s1','now','g1','Gerente',0,'aberta','now')", []).unwrap();

        let venda = sales::finalize(&mut c, &gerente(), FinalizeSaleInput {
            client_sale_id: "v1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 3, credit: false }],
            cash_tendered_cents: 2100, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(), credit_customer: None,
        }).unwrap();

        let lote_apos_venda: i64 = c.query_row(
            "SELECT quantity FROM product_batches WHERE id='b1'", [], |r| r.get(0)).unwrap();
        assert_eq!(lote_apos_venda, 7);

        delete_sale(&mut c, &gerente(), DeleteSaleInput {
            sale_id: venda.id.clone(),
            reason: "cliente desistiu antes de sair".into(),
        }).unwrap();

        let produto: i64 = c.query_row(
            "SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        let lote: i64 = c.query_row(
            "SELECT quantity FROM product_batches WHERE id='b1'", [], |r| r.get(0)).unwrap();
        assert_eq!(produto, 10);
        assert_eq!(lote, 10, "o lote ficava em 7 para sempre");
        assert_eq!(produto, lote, "produto e lotes precisam bater");
    }

    /// Venda cancelada sai do DRE, como já saía do relatório de vendas.
    #[test]
    fn venda_cancelada_nao_conta_como_receita_no_dre() {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1','g','x','Gerente','master',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','B1','Coca','Bebidas','',700,300,10,1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents, status, created_at)
             VALUES ('s1','now','g1','Gerente',0,'aberta','now')", []).unwrap();

        let venda = sales::finalize(&mut c, &gerente(), FinalizeSaleInput {
            client_sale_id: "v1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 2, credit: false }],
            cash_tendered_cents: 1400, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(), credit_customer: None,
        }).unwrap();

        let hoje = chrono::Local::now().date_naive().to_string();
        let periodo = || ReportRange { from: hoje.clone(), to: hoje.clone() };

        let mut leitor = gerente();
        leitor.permissions.push("reports.view".into());
        leitor.permissions.push("reports.result".into());
        let antes = dre(&c, &leitor, periodo()).unwrap();
        assert_eq!(antes.receita_bruta_cents, 1400);

        delete_sale(&mut c, &gerente(), DeleteSaleInput {
            sale_id: venda.id, reason: "erro do operador".into(),
        }).unwrap();

        let depois = dre(&c, &leitor, periodo()).unwrap();
        assert_eq!(depois.receita_bruta_cents, 0, "o DRE somava venda cancelada");
        assert_eq!(depois.cmv_cents, 0);
        assert_eq!(depois.vendas, 0);
        assert_eq!(depois.dinheiro_cents, 0);
    }
}

#[cfg(test)]
mod tests_dre {
    use super::*;
    use crate::db;

    fn ator() -> LocalUser {
        LocalUser {
            id: "u1".into(),
            username: "gerente".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["reports.view".into(), "reports.result".into()],
            must_change_password: false,
        }
    }

    /// Uma venda de R$ 100 com R$ 10 de desconto e custo de R$ 40.
    fn banco() -> rusqlite::Connection {
        let c = db::open_in_memory().unwrap();
        c.execute_batch(
            "INSERT INTO sales (id, client_sale_id, sale_number, business_date, subtotal_cents,
                                discount_cents, total_cents, cash_tendered_cents, card_cents,
                                pix_cents, change_cents, operator_name, created_at, status, payload_hash)
             VALUES ('s1','c1',1,'2026-09-04',10000,1000,9000,10000,0,0,1000,'Ana','2026-09-04T12:00:00Z','completed','h1');
             INSERT INTO sale_items (id, sale_id, product_code, product_name, category,
                                     unit_price_cents, quantity, subtotal_cents, unit_cost_cents)
             VALUES ('i1','s1','B1','Cerveja','Bebidas',5000,2,10000,2000);",
        )
        .unwrap();
        c
    }

    fn periodo() -> ReportRange {
        ReportRange { from: "2026-09-01".into(), to: "2026-09-30".into() }
    }

    #[test]
    fn a_conta_fecha_da_receita_bruta_ao_lucro() {
        let r = dre(&banco(), &ator(), periodo()).unwrap();
        assert_eq!(r.receita_bruta_cents, 10000);
        assert_eq!(r.descontos_cents, 1000);
        assert_eq!(r.receita_liquida_cents, 9000);
        assert_eq!(r.cmv_cents, 4000, "2 unidades a R$ 20 de custo");
        assert_eq!(r.lucro_bruto_cents, 5000);
        assert!((r.margem_percentual - 55.55).abs() < 0.1);
        assert_eq!(r.ticket_medio_cents, 9000);
        assert_eq!(r.unidades, 2);
    }

    #[test]
    fn o_dinheiro_do_periodo_desconta_o_troco() {
        // Entraram R$ 100 na gaveta e saíram R$ 10 de troco: a venda em
        // dinheiro foi de R$ 90, não de R$ 100.
        let r = dre(&banco(), &ator(), periodo()).unwrap();
        assert_eq!(r.dinheiro_cents, 9000);
        assert_eq!(r.troco_cents, 1000);
    }

    #[test]
    fn a_devolucao_entra_pela_data_do_estorno() {
        let c = banco();
        c.execute_batch(
            "INSERT INTO sale_returns (id, sale_id, sale_item_id, quantity, amount_cents,
                                       refund_kind, reason, actor_name, occurred_at)
             VALUES ('r1','s1','i1',1,5000,'dinheiro','desistiu','Ana','2026-09-05T10:00:00Z');",
        )
        .unwrap();
        let r = dre(&c, &ator(), periodo()).unwrap();
        assert_eq!(r.devolucoes_cents, 5000);
        assert_eq!(r.receita_liquida_cents, 4000, "bruta 100 - desconto 10 - devolução 50");
        assert_eq!(r.lucro_bruto_cents, 0);
    }

    #[test]
    fn item_sem_custo_e_contado_em_vez_de_estimado() {
        let c = banco();
        c.execute(
            "UPDATE sale_items SET unit_cost_cents = NULL WHERE id = 'i1'",
            [],
        )
        .unwrap();
        let r = dre(&c, &ator(), periodo()).unwrap();
        assert_eq!(r.cmv_cents, 0);
        assert_eq!(r.itens_sem_custo, 1, "a tela precisa avisar que o CMV está incompleto");
        assert_eq!(r.itens_total, 1);
    }

    #[test]
    fn periodo_sem_venda_devolve_zeros_e_nao_nan() {
        let vazio = ReportRange { from: "2020-01-01".into(), to: "2020-01-31".into() };
        let r = dre(&banco(), &ator(), vazio).unwrap();
        assert_eq!(r.vendas, 0);
        assert_eq!(r.ticket_medio_cents, 0);
        assert!(r.margem_percentual.is_finite(), "NaN vira \"NaN%\" na tela");
        assert_eq!(r.margem_percentual, 0.0);
    }

    #[test]
    fn a_quebra_por_categoria_soma_a_receita_do_periodo() {
        let r = dre(&banco(), &ator(), periodo()).unwrap();
        assert_eq!(r.por_categoria.len(), 1);
        let bebidas = &r.por_categoria[0];
        assert_eq!(bebidas.categoria, "Bebidas");
        assert_eq!(bebidas.receita_cents, 10000);
        assert_eq!(bebidas.lucro_cents, 6000);
        assert!((bebidas.participacao_percentual - 100.0).abs() < 0.01);
        assert_eq!(r.por_dia.len(), 1);
        assert_eq!(r.por_dia[0].dia, "2026-09-04");
    }

    #[test]
    fn sem_permissao_o_dre_e_negado() {
        let mut sem = ator();
        sem.permissions.clear();
        assert!(matches!(dre(&banco(), &sem, periodo()), Err(AppError::Forbidden)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        models::{FinalizeSaleInput, SaleItemInput},
        sales,
    };

    fn ator() -> LocalUser {
        LocalUser {
            id: "g1".into(),
            username: "g".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec![
                "pdv.use".into(),
                "reports.sales".into(),
                "reports.categories".into(),
                "reports.stock".into(),
                "reports.closing".into(),
            ],
        must_change_password: false,
        }
    }

    fn hoje() -> String {
        chrono::Local::now().date_naive().format("%Y-%m-%d").to_string()
    }

    fn periodo() -> ReportRange {
        ReportRange { from: hoje(), to: hoje() }
    }

    fn preparar() -> Connection {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1', 'g', 'x', 'Gerente', 'gerente', 1, 'now', 'now')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1', 'B1', 'Coca', 'Bebidas', '', 700, 10, 1, 'now', 'now')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name,
                                        opening_float_cents, status, created_at)
             VALUES ('s1', 'now', 'g1', 'Gerente', 0, 'aberta', 'now')",
            [],
        ).unwrap();
        sales::finalize(&mut c, &ator(), FinalizeSaleInput {
            client_sale_id: "v-1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 2, credit: false }],
            cash_tendered_cents: 1400,
            card_cents: 0,
            pix_cents: 0,
            discount_cents: 0, discount_reason: String::new(), customer_name: String::new(), credit_customer: None,
        }).unwrap();
        c
    }

    /// Regressão: `occurred_at` é gravado em UTC e o período vem em data local.
    /// Sem converter, tudo que ocorre depois das 21h (UTC-3) sumia do relatório.
    #[test]
    fn lista_vendas_itens_e_movimentos_do_periodo() {
        let c = preparar();
        let vendas = sales(&c, &ator(), periodo()).unwrap();
        assert_eq!(vendas.len(), 1);
        assert_eq!(vendas[0].items_count, 2);
        assert_eq!(vendas[0].total_cents, 1400);

        let itens = items(&c, &ator(), periodo()).unwrap();
        assert_eq!(itens.len(), 1);
        assert_eq!(itens[0].category, "Bebidas");

        let movs = movements(&c, &ator(), periodo()).unwrap();
        assert!(!movs.is_empty());
        assert!(movs.iter().any(|m| m.delta == -2));
    }

    #[test]
    fn excluir_venda_devolve_estoque_e_registra_motivo() {
        let mut c = preparar();
        let id = sales(&c, &ator(), periodo()).unwrap()[0].id.clone();

        delete_sale(&mut c, &ator(), DeleteSaleInput {
            sale_id: id.clone(),
            reason: "cliente desistiu".into(),
        }).unwrap();

        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, 10, "o estoque volta ao valor original");

        assert!(sales(&c, &ator(), periodo()).unwrap().is_empty(), "some da aba Vendas");

        let excluidas = deleted_sales(&c, &ator(), periodo()).unwrap();
        assert_eq!(excluidas.len(), 1);
        assert_eq!(excluidas[0].reason, "cliente desistiu");
        assert_eq!(excluidas[0].total_cents, 1400);
    }

    #[test]
    fn exige_motivo_e_permissao_para_excluir() {
        let mut c = preparar();
        let id = sales(&c, &ator(), periodo()).unwrap()[0].id.clone();

        let sem_motivo = delete_sale(&mut c, &ator(), DeleteSaleInput { sale_id: id.clone(), reason: "   ".into() });
        assert!(matches!(sem_motivo, Err(AppError::Validation(_))));

        let mut sem_permissao = ator();
        sem_permissao.permissions.retain(|p| p != "reports.sales");
        let negado = delete_sale(&mut c, &sem_permissao, DeleteSaleInput { sale_id: id, reason: "x".into() });
        assert!(matches!(negado, Err(AppError::Forbidden)));

        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, 8, "nada foi devolvido");
    }

    #[test]
    fn valida_periodo_invertido() {
        let c = preparar();
        let r = sales(&c, &ator(), ReportRange { from: "2026-12-31".into(), to: "2026-01-01".into() });
        assert!(matches!(r, Err(AppError::Validation(_))));
    }
}
