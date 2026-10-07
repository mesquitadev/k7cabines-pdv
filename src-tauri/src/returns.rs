use chrono::{Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{InventoryCountInput, LocalUser, ReturnInput, SaleItemForReturn},
};

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Itens de uma venda com o que ainda pode ser devolvido.
pub fn itens_da_venda(
    connection: &Connection,
    actor: &LocalUser,
    sale_id: &str,
) -> AppResult<Vec<SaleItemForReturn>> {
    require(actor, "sale.return")?;
    let mut statement = connection.prepare(
        "SELECT id, product_name, quantity, returned_quantity, unit_price_cents
         FROM sale_items WHERE sale_id = ?1 ORDER BY rowid",
    )?;
    let rows = statement.query_map(params![sale_id], |row| {
        Ok(SaleItemForReturn {
            sale_item_id: row.get(0)?,
            product_name: row.get(1)?,
            quantity: row.get(2)?,
            returned_quantity: row.get(3)?,
            unit_price_cents: row.get(4)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Devolve parte de um item vendido.
///
/// O estoque volta para os lotes de origem — a tabela `sale_item_batches`
/// guarda de qual lote cada unidade saiu, então a devolução recompõe o que
/// realmente foi consumido, em vez de inventar saldo novo.
/// Espalha uma diferença de inventário pelos lotes do produto.
///
/// Sem isto, `products.stock_quantity` e a soma de `product_batches` divergem
/// em silêncio, e o FEFO passa a trabalhar sobre um saldo que não existe.
fn ajustar_lotes(
    transaction: &rusqlite::Transaction<'_>,
    product_id: &str,
    diferenca: i64,
    agora: &str,
) -> AppResult<()> {
    // Falta: consome do que vence primeiro. Sobra: entra no que vence por último.
    let ordem = if diferenca < 0 { "ASC" } else { "DESC" };
    let lotes: Vec<(String, i64)> = {
        let mut st = transaction.prepare(&format!(
            "SELECT id, quantity FROM product_batches
             WHERE product_id = ?1 ORDER BY expiry_date {ordem}"
        ))?;
        let rows = st.query_map(params![product_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if lotes.is_empty() {
        // Produto sem controle de lote (Pulseiras): nada a espalhar.
        return Ok(());
    }

    let mut restante = diferenca.abs();
    for (batch_id, saldo) in &lotes {
        if restante <= 0 {
            break;
        }
        let passo = if diferenca < 0 {
            (*saldo).min(restante)
        } else {
            restante
        };
        let delta = if diferenca < 0 { -passo } else { passo };
        transaction.execute(
            "UPDATE product_batches
             SET quantity = quantity + ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3",
            params![delta, agora, batch_id],
        )?;
        restante -= passo;
    }
    Ok(())
}

/// Quanto devolver por `quantidade` unidades a `preco`, já descontada a parte
/// proporcional do desconto concedido na venda.
///
/// Aritmética inteira com arredondamento ao mais próximo: dividir centavos
/// truncando faria a loja ficar com um centavo a cada devolução.
fn valor_estornavel(
    transaction: &rusqlite::Transaction<'_>,
    sale_id: &str,
    preco: i64,
    quantidade: i64,
) -> AppResult<i64> {
    let bruto = preco
        .checked_mul(quantidade)
        .ok_or_else(|| AppError::Validation("valor da devolução fora da faixa".into()))?;
    let (subtotal, desconto): (i64, i64) = transaction.query_row(
        "SELECT subtotal_cents, discount_cents FROM sales WHERE id = ?1",
        params![sale_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if desconto <= 0 || subtotal <= 0 {
        return Ok(bruto);
    }
    let liquido = (subtotal - desconto).max(0);
    let numerador = bruto
        .checked_mul(liquido)
        .ok_or_else(|| AppError::Validation("valor da devolução fora da faixa".into()))?;
    Ok((numerador + subtotal / 2) / subtotal)
}

pub fn devolver(
    connection: &mut Connection,
    actor: &LocalUser,
    input: ReturnInput,
) -> AppResult<()> {
    require(actor, "sale.return")?;
    if input.quantity <= 0 {
        return Err(AppError::Validation(
            "a quantidade devolvida deve ser maior que zero".into(),
        ));
    }
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::Validation("informe o motivo da devolução".into()));
    }
    if !matches!(
        input.refund_kind.as_str(),
        "dinheiro" | "cartao" | "pix" | "sem_estorno"
    ) {
        return Err(AppError::Validation("forma de estorno inválida".into()));
    }

    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;

    // O turno em que o dinheiro está saindo, que é o de agora — não o da venda.
    let turno_atual: Option<String> = transaction
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'aberta' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if input.refund_kind == "dinheiro" && turno_atual.is_none() {
        // Sem turno aberto o dinheiro sairia da gaveta sem entrar em nenhuma
        // conferência: o caixa fecharia certo com dinheiro a menos.
        return Err(AppError::Validation(
            "abra o turno antes de estornar em dinheiro: a saída precisa entrar na conferência"
                .into(),
        ));
    }

    let (sale_id, product_id, product_name, vendida, devolvida, preco, business_date): (
        String,
        Option<String>,
        String,
        i64,
        i64,
        i64,
        String,
    ) = transaction
        .query_row(
            "SELECT i.sale_id, i.product_id, i.product_name, i.quantity, i.returned_quantity,
                    i.unit_price_cents, s.business_date
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             WHERE i.id = ?1 AND s.status = 'completed'",
            params![input.sale_item_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    // Pedido do cliente (24/09/2026): o caixa de ontem não se mexe. Só o
    // atendente fica preso ao dia vigente, a mesma regra da exclusão.
    let hoje = Local::now().date_naive().format("%Y-%m-%d").to_string();
    let gestor = matches!(actor.role.as_str(), "gerente" | "master");
    if !gestor && business_date != hoje {
        return Err(AppError::Validation(
            "apenas vendas do dia vigente podem ser devolvidas".into(),
        ));
    }

    let disponivel = vendida - devolvida;
    if input.quantity > disponivel {
        return Err(AppError::Validation(format!(
            "só restam {disponivel} unidade(s) de {product_name} para devolver"
        )));
    }

    transaction.execute(
        "UPDATE sale_items SET returned_quantity = returned_quantity + ?1 WHERE id = ?2",
        params![input.quantity, input.sale_item_id],
    )?;

    if input.restock {
        if let Some(pid) = &product_id {
            transaction.execute(
                "UPDATE products SET stock_quantity = stock_quantity + ?1, revision = revision + 1,
                                     updated_at = ?2
                 WHERE id = ?3",
                params![input.quantity, now, pid],
            )?;

            // Recompõe os lotes de origem, do último consumido para o
            // primeiro, descontando o que devoluções anteriores já repuseram.
            // Sem `returned_quantity`, a segunda devolução parcial recomeçava
            // pelo mesmo lote e a unidade migrava para uma validade mais longa.
            let lotes: Vec<(String, i64)> = {
                let mut st = transaction.prepare(
                    "SELECT batch_id, quantity - returned_quantity
                     FROM sale_item_batches
                     WHERE sale_item_id = ?1 AND quantity > returned_quantity
                     ORDER BY rowid DESC",
                )?;
                let rows = st.query_map(params![input.sale_item_id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let mut restante = input.quantity;
            for (batch_id, ainda_no_lote) in lotes {
                if restante <= 0 {
                    break;
                }
                let devolver_lote = ainda_no_lote.min(restante);
                transaction.execute(
                    "UPDATE product_batches
                     SET quantity = quantity + ?1, revision = revision + 1, updated_at = ?2
                     WHERE id = ?3",
                    params![devolver_lote, now, batch_id],
                )?;
                transaction.execute(
                    "UPDATE sale_item_batches
                     SET returned_quantity = returned_quantity + ?1
                     WHERE sale_item_id = ?2 AND batch_id = ?3",
                    params![devolver_lote, input.sale_item_id, batch_id],
                )?;
                restante -= devolver_lote;
            }

            transaction.execute(
                "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason,
                                              reference_type, reference_id, actor_id, actor_name,
                                              occurred_at)
                 VALUES (?1, ?2, NULL, ?3, 'sale.return', 'sale', ?4, ?5, ?6, ?7)",
                params![
                    Uuid::new_v4().to_string(),
                    pid,
                    input.quantity,
                    sale_id,
                    actor.id,
                    actor.full_name,
                    now
                ],
            )?;
        }
    }

    // O desconto foi dado no total da venda e nunca rateado por item. Estornar
    // o preço cheio devolve mais do que o cliente pagou: numa venda de R$ 20
    // com R$ 2 de desconto, devolver tudo tirava R$ 20 da gaveta contra R$ 18
    // recebidos. O rateio é proporcional ao peso do item na venda.
    let valor = valor_estornavel(&transaction, &sale_id, preco, input.quantity)?;
    transaction.execute(
        "INSERT INTO sale_returns (id, sale_id, sale_item_id, quantity, amount_cents, refund_kind,
                                   reason, restocked, actor_id, actor_name, occurred_at,
                                   cash_session_id, client_return_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            Uuid::new_v4().to_string(),
            sale_id,
            input.sale_item_id,
            input.quantity,
            valor,
            input.refund_kind,
            reason,
            input.restock,
            actor.id,
            actor.full_name,
            now,
            turno_atual,
            input.client_return_id.as_deref()
        ],
    )
    .map_err(|erro| match erro {
        rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
            // Segundo clique no mesmo botão: a primeira devolução valeu.
            AppError::Conflict("esta devolução já foi registrada".into())
        }
        outro => AppError::Database(outro),
    })?;

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'sale.return', 'sale', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            sale_id,
            serde_json::json!({
                "item": product_name,
                "quantity": input.quantity,
                "amount_cents": valor,
                "refund_kind": input.refund_kind,
                "reason": reason,
            })
            .to_string(),
            now
        ],
    )?;

    transaction.commit()?;
    Ok(())
}

/// Inventário: registra a contagem física e ajusta o sistema para ela.
pub fn contar(
    connection: &mut Connection,
    actor: &LocalUser,
    input: InventoryCountInput,
) -> AppResult<()> {
    require(actor, "stock.inventory")?;
    if input.counted_quantity < 0 {
        return Err(AppError::Validation(
            "a contagem não pode ser negativa".into(),
        ));
    }
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::Validation("informe o motivo do ajuste".into()));
    }

    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;

    let (sistema, nome): (i64, String) = transaction
        .query_row(
            "SELECT stock_quantity, name FROM products WHERE id = ?1 AND active = 1",
            params![input.product_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    let diferenca = input.counted_quantity - sistema;

    transaction.execute(
        "INSERT INTO inventory_counts (id, product_id, system_quantity, counted_quantity,
                                       difference, reason, actor_id, actor_name, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            Uuid::new_v4().to_string(),
            input.product_id,
            sistema,
            input.counted_quantity,
            diferenca,
            reason,
            actor.id,
            actor.full_name,
            now
        ],
    )?;

    if diferenca != 0 {
        transaction.execute(
            "UPDATE products SET stock_quantity = ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3",
            params![input.counted_quantity, now, input.product_id],
        )?;

        // O ajuste também precisa cair nos lotes, senão o controle de validade
        // passa a descrever mercadoria que não existe: contar 4 onde o sistema
        // dizia 10 deixava os lotes somando 10 para sempre.
        //
        // Falta consome o que vence primeiro — é o que já saiu da prateleira.
        // Sobra entra no que vence por último, porque mercadoria achada numa
        // contagem não tem validade conhecida, e supor a mais curta anteciparia
        // um descarte indevido.
        ajustar_lotes(&transaction, &input.product_id, diferenca, now.as_str())?;
        transaction.execute(
            "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason, reference_type,
                                          reference_id, actor_id, actor_name, occurred_at)
             VALUES (?1, ?2, NULL, ?3, 'inventory', 'inventory', NULL, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                input.product_id,
                diferenca,
                actor.id,
                actor.full_name,
                now
            ],
        )?;
    }

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'stock.inventory', 'product', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            input.product_id,
            serde_json::json!({
                "produto": nome,
                "sistema": sistema,
                "contado": input.counted_quantity,
                "diferenca": diferenca,
                "motivo": reason,
            })
            .to_string(),
            now
        ],
    )?;

    transaction.commit()?;
    Ok(())
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
            role: "master".into(),
            permissions: vec![
                "pdv.use".into(),
                "sale.return".into(),
                "stock.inventory".into(),
            ],
            must_change_password: false,
        }
    }

    /// Venda de 3 unidades consumindo dois lotes: 2 do que vence antes, 1 do outro.
    fn cenario() -> Connection {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1','g','x','Gerente','master',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','B1','Coca','Bebidas','',700,3,1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO product_batches (id, product_id, expiry_date, quantity, created_at, updated_at)
             VALUES ('b1','p1','2027-01-01',2,'now','now'), ('b2','p1','2027-06-01',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents, status, created_at)
             VALUES ('s1','now','g1','Gerente',0,'aberta','now')", []).unwrap();
        sales::finalize(&mut c, &ator(), FinalizeSaleInput {
            client_sale_id: "v1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 3, credit: false }],
            cash_tendered_cents: 2100, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(), credit_customer: None,
        }).unwrap();
        c
    }

    #[test]
    fn atendente_nao_devolve_venda_de_dia_anterior() {
        let mut c = cenario();
        c.execute("UPDATE sales SET business_date = '2020-01-01'", []).unwrap();
        let item: String = c
            .query_row("SELECT id FROM sale_items LIMIT 1", [], |r| r.get(0))
            .unwrap();
        let mut atendente = ator();
        atendente.role = "atendente".into();
        let negado = devolver(&mut c, &atendente, ReturnInput {
            client_return_id: Some("r-ontem".into()),
            sale_item_id: item.clone(),
            quantity: 1,
            reason: "errei".into(),
            refund_kind: "sem_estorno".into(),
            restock: false,
        });
        assert!(matches!(negado, Err(AppError::Validation(_))));
        // O gestor continua podendo corrigir o passado.
        devolver(&mut c, &ator(), ReturnInput {
            client_return_id: Some("r-ontem-2".into()),
            sale_item_id: item,
            quantity: 1,
            reason: "errei".into(),
            refund_kind: "sem_estorno".into(),
            restock: false,
        }).unwrap();
    }

    #[test]
    fn devolucao_parcial_recompoe_os_lotes_de_origem() {
        let mut c = cenario();
        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();

        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item.clone(), quantity: 2, refund_kind: "dinheiro".into(),
            reason: "cliente desistiu".into(), restock: true, client_return_id: None,
        }).unwrap();

        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, 2, "0 restante + 2 devolvidas");

        // A devolução volta primeiro ao último lote consumido.
        let b2: i64 = c.query_row("SELECT quantity FROM product_batches WHERE id='b2'", [], |r| r.get(0)).unwrap();
        let b1: i64 = c.query_row("SELECT quantity FROM product_batches WHERE id='b1'", [], |r| r.get(0)).unwrap();
        assert_eq!((b1, b2), (1, 1));

        let restante = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].returned_quantity;
        assert_eq!(restante, 2);
    }


    /// Duas devoluções parciais não podem repor no mesmo lote duas vezes.
    ///
    /// Era o bug: o laço relia o consumo original e recomeçava pelo último
    /// lote, migrando uma unidade de janeiro para junho. Ela seria vendida
    /// depois de vencida, sem o alerta ver.
    #[test]
    fn devolucoes_parciais_sucessivas_repoem_no_lote_certo() {
        let mut c = cenario();
        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();

        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item.clone(), quantity: 2, refund_kind: "dinheiro".into(),
            reason: "primeira".into(), restock: true, client_return_id: None,
        }).unwrap();
        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item.clone(), quantity: 1, refund_kind: "dinheiro".into(),
            reason: "segunda".into(), restock: true, client_return_id: None,
        }).unwrap();

        let b1: i64 = c.query_row("SELECT quantity FROM product_batches WHERE id='b1'", [], |r| r.get(0)).unwrap();
        let b2: i64 = c.query_row("SELECT quantity FROM product_batches WHERE id='b2'", [], |r| r.get(0)).unwrap();
        assert_eq!(
            (b1, b2),
            (2, 1),
            "cada lote volta exatamente ao que emprestou"
        );
        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, b1 + b2, "produto e lotes precisam bater");
    }

    /// Devolução com desconto não pode estornar mais do que o cliente pagou.
    #[test]
    fn devolucao_de_venda_com_desconto_estorna_o_valor_pago() {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1','g','x','Gerente','master',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','GEL','Gel Íntimo','Eróticos','',500,4,1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents, status, created_at)
             VALUES ('s1','now','g1','Gerente',0,'aberta','now')", []).unwrap();
        let mut com_desconto = ator();
        com_desconto.permissions.push("sale.discount".into());
        // 4 × R$ 5,00 = R$ 20,00, com R$ 2,00 de desconto: o cliente paga R$ 18,00.
        sales::finalize(&mut c, &com_desconto, FinalizeSaleInput {
            client_sale_id: "v1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 4, credit: false }],
            cash_tendered_cents: 1800, card_cents: 0, pix_cents: 0, discount_cents: 200, discount_reason: "teste".into(), customer_name: String::new(), credit_customer: None,
        }).unwrap();

        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();
        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item, quantity: 4, refund_kind: "dinheiro".into(),
            reason: "desistiu".into(), restock: true, client_return_id: None,
        }).unwrap();

        let estornado: i64 = c.query_row("SELECT amount_cents FROM sale_returns", [], |r| r.get(0)).unwrap();
        assert_eq!(
            estornado, 1800,
            "estornar o preço cheio devolveria R$ 20 contra R$ 18 recebidos"
        );
    }

    /// Dois cliques no mesmo botão devolvem uma vez só.
    #[test]
    fn devolucao_e_idempotente_por_client_return_id() {
        let mut c = cenario();
        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();
        let entrada = || ReturnInput {
            sale_item_id: item.clone(), quantity: 1, refund_kind: "dinheiro".into(),
            reason: "duplo clique".into(), restock: true,
            client_return_id: Some("dev-1".into()),
        };

        devolver(&mut c, &ator(), entrada()).unwrap();
        let segunda = devolver(&mut c, &ator(), entrada());
        assert!(matches!(segunda, Err(AppError::Conflict(_))));

        let devolvido: i64 = c.query_row(
            "SELECT COALESCE(SUM(quantity), 0) FROM sale_returns", [], |r| r.get(0)).unwrap();
        assert_eq!(devolvido, 1, "a segunda chamada não pode repor estoque de novo");
        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, 1);
    }

    /// Inventário precisa ajustar os lotes, não só o total do produto.
    #[test]
    fn inventario_ajusta_os_lotes_alem_do_saldo_do_produto() {
        let mut c = cenario();
        // Vendeu 3 de 3: produto 0, lotes 0. Repõe para ter o que contar.
        c.execute("UPDATE products SET stock_quantity = 10 WHERE id='p1'", []).unwrap();
        c.execute("UPDATE product_batches SET quantity = 6 WHERE id='b1'", []).unwrap();
        c.execute("UPDATE product_batches SET quantity = 4 WHERE id='b2'", []).unwrap();

        contar(&mut c, &ator(), crate::models::InventoryCountInput {
            product_id: "p1".into(), counted_quantity: 4, reason: "contagem mensal".into(),
        }).unwrap();

        let produto: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        let soma: i64 = c.query_row("SELECT SUM(quantity) FROM product_batches WHERE product_id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(produto, 4);
        assert_eq!(soma, 4, "os lotes seguiam somando 10 e o FEFO mentia");
        // A falta sai do lote que vence primeiro: é o que já deixou a prateleira.
        let b1: i64 = c.query_row("SELECT quantity FROM product_batches WHERE id='b1'", [], |r| r.get(0)).unwrap();
        assert_eq!(b1, 0);
    }

    #[test]
    fn nao_devolve_mais_do_que_foi_vendido() {
        let mut c = cenario();
        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();
        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item.clone(), quantity: 3, refund_kind: "dinheiro".into(),
            reason: "x".into(), restock: true, client_return_id: None,
        }).unwrap();
        let excesso = devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item, quantity: 1, refund_kind: "dinheiro".into(),
            reason: "x".into(), restock: true, client_return_id: None,
        });
        assert!(matches!(excesso, Err(AppError::Validation(_))));
    }

    #[test]
    fn devolucao_sem_reposicao_nao_mexe_no_estoque() {
        let mut c = cenario();
        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();
        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item, quantity: 1, refund_kind: "sem_estorno".into(),
            reason: "produto danificado".into(), restock: false, client_return_id: None,
        }).unwrap();
        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, 0, "mercadoria imprópria não volta para a prateleira");
    }

    #[test]
    fn estorno_em_dinheiro_sai_da_gaveta_no_fechamento() {
        let mut c = cenario();
        let item = itens_da_venda(&c, &ator(), &sale_id(&c)).unwrap()[0].sale_item_id.clone();
        let antes = crate::cash::resumo(&c, "s1").unwrap().esperado_cents;
        devolver(&mut c, &ator(), ReturnInput {
            sale_item_id: item, quantity: 1, refund_kind: "dinheiro".into(),
            reason: "troca".into(), restock: true, client_return_id: None,
        }).unwrap();
        let depois = crate::cash::resumo(&c, "s1").unwrap().esperado_cents;
        assert_eq!(antes - depois, 700);
    }

    #[test]
    fn inventario_ajusta_e_registra_a_diferenca() {
        let mut c = cenario();
        contar(&mut c, &ator(), InventoryCountInput {
            product_id: "p1".into(), counted_quantity: 5, reason: "contagem semanal".into(),
        }).unwrap();

        let estoque: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(estoque, 5);
        let (sistema, contado, dif): (i64, i64, i64) = c.query_row(
            "SELECT system_quantity, counted_quantity, difference FROM inventory_counts", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((sistema, contado, dif), (0, 5, 5));
    }

    #[test]
    fn exige_permissao() {
        let mut c = cenario();
        let mut sem = ator();
        sem.permissions.clear();
        assert!(matches!(
            contar(&mut c, &sem, InventoryCountInput {
                product_id: "p1".into(), counted_quantity: 1, reason: "x".into() }),
            Err(AppError::Forbidden)
        ));
        assert!(matches!(itens_da_venda(&c, &sem, "qualquer"), Err(AppError::Forbidden)));
    }

    fn sale_id(c: &Connection) -> String {
        c.query_row("SELECT id FROM sales LIMIT 1", [], |r| r.get(0)).unwrap()
    }
}
