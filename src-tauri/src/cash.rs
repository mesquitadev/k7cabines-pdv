use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        CashMovement, CashSession, CashSessionSummary, CategoriaVendida, LocalUser,
        ProdutoVendido, SubcategoriaVendida, VendasDoTurno,
    },
};

const MAX_MONEY_CENTS: i64 = 100_000_000;

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn valida_valor(valor: i64, campo: &str) -> AppResult<()> {
    if valor < 0 {
        return Err(AppError::Validation(format!("{campo} não pode ser negativo")));
    }
    if valor > MAX_MONEY_CENTS {
        return Err(AppError::Validation(format!("{campo} fora da faixa")));
    }
    Ok(())
}

fn ler_sessao(connection: &Connection, id: &str) -> AppResult<Option<CashSession>> {
    connection
        .query_row(
            "SELECT id, opened_at, opened_by_name, opening_float_cents, closed_at, closed_by_name,
                    expected_cash_cents, counted_cash_cents, difference_cents, notes, status,
                    closed_without_count
             FROM cash_sessions WHERE id = ?1",
            params![id],
            |row| {
                Ok(CashSession {
                    id: row.get(0)?,
                    opened_at: row.get(1)?,
                    opened_by_name: row.get(2)?,
                    opening_float_cents: row.get(3)?,
                    closed_at: row.get(4)?,
                    closed_by_name: row.get(5)?,
                    expected_cash_cents: row.get(6)?,
                    counted_cash_cents: row.get(7)?,
                    difference_cents: row.get(8)?,
                    notes: row.get(9)?,
                    status: row.get(10)?,
                    closed_without_count: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

/// A sessão aberta, se houver. O PDV consulta isso antes de vender.
pub fn sessao_aberta(connection: &Connection) -> AppResult<Option<CashSession>> {
    let id: Option<String> = connection
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'aberta'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    match id {
        Some(id) => ler_sessao(connection, &id),
        None => Ok(None),
    }
}

pub fn abrir(
    connection: &mut Connection,
    actor: &LocalUser,
    fundo_troco_cents: i64,
    ) -> AppResult<CashSession> {
    require(actor, "cash.operate")?;
    valida_valor(fundo_troco_cents, "o fundo de troco")?;

    if sessao_aberta(connection)?.is_some() {
        return Err(AppError::Conflict(
            "já existe um caixa aberto. Feche o caixa atual antes de abrir outro.".into(),
        ));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents,
                                    status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'aberta', ?2)",
        params![id, now, actor.id, actor.full_name, fundo_troco_cents],
    )?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'cash.open', 'cash_session', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            id,
            serde_json::json!({ "opening_float_cents": fundo_troco_cents }).to_string(),
            now
        ],
    )?;
    transaction.commit()?;

    ler_sessao(connection, &id)?.ok_or(AppError::NotFound)
}

/// Sangria (retirada) ou suprimento (reforço) no caixa aberto.
pub fn movimentar(
    connection: &mut Connection,
    actor: &LocalUser,
    kind: &str,
    amount_cents: i64,
    reason: &str,
) -> AppResult<CashSession> {
    require(actor, "cash.operate")?;
    if kind != "sangria" && kind != "suprimento" {
        return Err(AppError::Validation("tipo de movimento inválido".into()));
    }
    if amount_cents <= 0 {
        return Err(AppError::Validation(
            "o valor precisa ser maior que zero".into(),
        ));
    }
    valida_valor(amount_cents, "o valor")?;
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation("informe o motivo".into()));
    }
    if reason.chars().count() > 200 {
        return Err(AppError::Validation("motivo longo demais".into()));
    }

    let sessao = sessao_aberta(connection)?
        .ok_or_else(|| AppError::Validation("nenhum caixa aberto".into()))?;

    // Sangria não pode levar mais dinheiro do que existe na gaveta.
    if kind == "sangria" {
        let resumo = resumo(connection, &sessao.id)?;
        if amount_cents > resumo.esperado_cents {
            return Err(AppError::Validation(format!(
                "a gaveta tem {} em dinheiro; a sangria não pode ser maior",
                formata(resumo.esperado_cents)
            )));
        }
    }

    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO cash_movements (id, session_id, kind, amount_cents, reason, actor_id, actor_name, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            Uuid::new_v4().to_string(),
            sessao.id,
            kind,
            amount_cents,
            reason,
            actor.id,
            actor.full_name,
            now
        ],
    )?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, ?3, 'cash_session', ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            format!("cash.{kind}"),
            sessao.id,
            serde_json::json!({ "amount_cents": amount_cents, "reason": reason }).to_string(),
            now
        ],
    )?;
    transaction.commit()?;

    ler_sessao(connection, &sessao.id)?.ok_or(AppError::NotFound)
}

fn formata(centavos: i64) -> String {
    format!("R$ {},{:02}", centavos / 100, (centavos % 100).abs())
}

/// O que o caixa deveria ter em dinheiro agora, e de onde veio.
pub fn resumo(connection: &Connection, session_id: &str) -> AppResult<CashSessionSummary> {
    let (fundo, status): (i64, String) = connection.query_row(
        "SELECT opening_float_cents, status FROM cash_sessions WHERE id = ?1",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    // Só vendas concluídas entram; canceladas saem da conta.
    let (dinheiro, troco, cartao, pix, total, vendas): (i64, i64, i64, i64, i64, i64) = connection
        .query_row(
            "SELECT COALESCE(SUM(cash_tendered_cents), 0), COALESCE(SUM(change_cents), 0),
                    COALESCE(SUM(card_cents), 0), COALESCE(SUM(pix_cents), 0),
                    COALESCE(SUM(total_cents), 0), COUNT(*)
             FROM sales WHERE cash_session_id = ?1 AND status = 'completed'",
            params![session_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )?;

    let (sangrias, suprimentos): (i64, i64) = connection.query_row(
        "SELECT COALESCE(SUM(CASE WHEN kind = 'sangria' THEN amount_cents ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN kind = 'suprimento' THEN amount_cents ELSE 0 END), 0)
         FROM cash_movements WHERE session_id = ?1",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    // Estorno em dinheiro sai da gaveta do turno em que foi feito, não do
    // turno da venda: quem devolve hoje uma compra de ontem tira dinheiro da
    // gaveta de hoje. `cash_session_id` nulo é linha anterior à correção, e
    // para ela vale o turno da venda, que era o comportamento antigo.
    let estornos: i64 = connection.query_row(
        "SELECT COALESCE(SUM(r.amount_cents), 0)
         FROM sale_returns r JOIN sales s ON s.id = r.sale_id
         WHERE COALESCE(r.cash_session_id, s.cash_session_id) = ?1
           AND r.refund_kind = 'dinheiro'
           AND s.status = 'completed'",
        params![session_id],
        |row| row.get(0),
    )?;

    // Dinheiro recebido menos o troco devolvido é o que ficou na gaveta.
    let dinheiro_liquido = dinheiro - troco;
    let esperado = fundo + dinheiro_liquido + suprimentos - sangrias - estornos;

    Ok(CashSessionSummary {
        session_id: session_id.to_string(),
        status,
        opening_float_cents: fundo,
        cash_cents: dinheiro_liquido,
        card_cents: cartao,
        pix_cents: pix,
        total_sales_cents: total,
        sales_count: vendas,
        withdrawals_cents: sangrias,
        deposits_cents: suprimentos,
        refunds_cash_cents: estornos,
        esperado_cents: esperado,
    })
}

pub fn fechar(
    connection: &mut Connection,
    actor: &LocalUser,
    contado_cents: i64,
    notas: Option<String>,
) -> AppResult<CashSession> {
    require(actor, "cash.manage")?;
    valida_valor(contado_cents, "o valor contado")?;

    let sessao = sessao_aberta(connection)?
        .ok_or_else(|| AppError::Validation("nenhum caixa aberto".into()))?;
    let resumo = resumo(connection, &sessao.id)?;
    let diferenca = contado_cents - resumo.esperado_cents;
    let now = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE cash_sessions
         SET status = 'fechada', closed_at = ?1, closed_by = ?2, closed_by_name = ?3,
             expected_cash_cents = ?4, counted_cash_cents = ?5, difference_cents = ?6, notes = ?7
         WHERE id = ?8 AND status = 'aberta'",
        params![
            now,
            actor.id,
            actor.full_name,
            resumo.esperado_cents,
            contado_cents,
            diferenca,
            notas.as_deref().map(str::trim).filter(|n| !n.is_empty()),
            sessao.id
        ],
    )?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'cash.close', 'cash_session', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            sessao.id,
            serde_json::json!({
                "expected_cents": resumo.esperado_cents,
                "counted_cents": contado_cents,
                "difference_cents": diferenca,
            })
            .to_string(),
            now
        ],
    )?;
    transaction.commit()?;

    ler_sessao(connection, &sessao.id)?.ok_or(AppError::NotFound)
}

/// O que foi vendido no turno, agrupado por categoria, subcategoria e produto.
///
/// A conferência do dinheiro responde "bate?"; isto responde "do que veio".
/// São perguntas diferentes e o gerente faz as duas no mesmo momento, então
/// as duas ficam na mesma tela.
pub fn vendas_do_turno(
    connection: &Connection,
    actor: &LocalUser,
    session_id: &str,
) -> AppResult<VendasDoTurno> {
    require(actor, "reports.closing")?;
    let mut st = connection.prepare(
        "SELECT i.category, p.subcategory, i.product_name,
                SUM(i.quantity), SUM(i.subtotal_cents)
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         LEFT JOIN products p ON p.id = i.product_id
         WHERE s.cash_session_id = ?1 AND s.status = 'completed'
         GROUP BY i.category, p.subcategory, i.product_name
         ORDER BY i.category, p.subcategory, SUM(i.subtotal_cents) DESC",
    )?;
    let linhas = st
        .query_map(params![session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut categorias: Vec<CategoriaVendida> = Vec::new();
    for (categoria, subcategoria, produto, unidades, total) in linhas {
        let cat = match categorias.iter_mut().find(|c| c.categoria == categoria) {
            Some(existente) => existente,
            None => {
                categorias.push(CategoriaVendida {
                    categoria: categoria.clone(),
                    total_cents: 0,
                    unidades: 0,
                    subcategorias: Vec::new(),
                });
                categorias.last_mut().expect("acabou de ser inserida")
            }
        };
        cat.total_cents += total;
        cat.unidades += unidades;

        let sub = match cat
            .subcategorias
            .iter_mut()
            .find(|s| s.subcategoria == subcategoria)
        {
            Some(existente) => existente,
            None => {
                cat.subcategorias.push(SubcategoriaVendida {
                    subcategoria: subcategoria.clone(),
                    total_cents: 0,
                    unidades: 0,
                    produtos: Vec::new(),
                });
                cat.subcategorias.last_mut().expect("acabou de ser inserida")
            }
        };
        sub.total_cents += total;
        sub.unidades += unidades;
        sub.produtos.push(ProdutoVendido {
            produto,
            unidades,
            total_cents: total,
        });
    }

    // A ordem sai do SQL por categoria; aqui as maiores vêm primeiro, que é
    // como o gerente lê: o que puxou a receita no topo.
    categorias.sort_by_key(|c| std::cmp::Reverse(c.total_cents));
    for c in &mut categorias {
        c.subcategorias.sort_by_key(|s| std::cmp::Reverse(s.total_cents));
    }

    Ok(VendasDoTurno {
        total_cents: categorias.iter().map(|c| c.total_cents).sum(),
        unidades: categorias.iter().map(|c| c.unidades).sum(),
        categorias,
    })
}

/// Turnos do período, do mais recente para o mais antigo.
///
/// Existe para o gerente ver o histórico de fechamentos e, principalmente,
/// quais turnos foram encerrados sem contagem — é o alerta de processo que a
/// virada de dia gera.
pub fn listar(
    connection: &Connection,
    actor: &LocalUser,
    de: &str,
    ate: &str,
) -> AppResult<Vec<CashSession>> {
    require(actor, "reports.closing")?;
    let mut st = connection.prepare(
        "SELECT id, opened_at, opened_by_name, opening_float_cents, closed_at, closed_by_name,
                expected_cash_cents, counted_cash_cents, difference_cents, notes, status,
                closed_without_count
         FROM cash_sessions
         WHERE date(opened_at, 'localtime') BETWEEN ?1 AND ?2
         ORDER BY opened_at DESC",
    )?;
    let linhas = st.query_map(params![de, ate], |row| {
        Ok(CashSession {
            id: row.get(0)?,
            opened_at: row.get(1)?,
            opened_by_name: row.get(2)?,
            opening_float_cents: row.get(3)?,
            closed_at: row.get(4)?,
            closed_by_name: row.get(5)?,
            expected_cash_cents: row.get(6)?,
            counted_cash_cents: row.get(7)?,
            difference_cents: row.get(8)?,
            notes: row.get(9)?,
            status: row.get(10)?,
            closed_without_count: row.get(11)?,
        })
    })?;
    linhas.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Encerra o turno de ontem sem contar e abre o de hoje, numa transação.
///
/// É a saída para o turno esquecido aberto. Nunca inventa um valor contado: o
/// esperado é gravado, o contado fica nulo e a sessão sai marcada como
/// encerrada sem conferência — que no relatório é um alerta de processo, não
/// uma diferença de caixa.
///
/// O fundo do turno novo é o esperado do anterior, porque o dinheiro continua
/// fisicamente na gaveta: ninguém tirou nada, só ninguém contou.
///
/// As duas coisas acontecem juntas de propósito. Encerrar sem abrir deixaria a
/// loja sem poder vender; abrir sem encerrar é o problema que estamos
/// resolvendo.
pub fn virar_dia(
    connection: &mut Connection,
    actor: &LocalUser,
    motivo: &str,
) -> AppResult<CashSession> {
    require(actor, "cash.manage")?;
    let motivo = motivo.trim();
    if motivo.chars().count() < 3 {
        return Err(AppError::Validation(
            "explique por que o turno está sendo encerrado sem contagem".into(),
        ));
    }

    let anterior = sessao_aberta(connection)?
        .ok_or_else(|| AppError::Validation("nenhum turno aberto".into()))?;
    let resumo = resumo(connection, &anterior.id)?;
    let now = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE cash_sessions
         SET status = 'fechada', closed_at = ?1, closed_by = ?2, closed_by_name = ?3,
             expected_cash_cents = ?4, counted_cash_cents = NULL, difference_cents = NULL,
             closed_without_count = 1, notes = ?5
         WHERE id = ?6 AND status = 'aberta'",
        params![
            now,
            actor.id,
            actor.full_name,
            resumo.esperado_cents,
            motivo,
            anterior.id
        ],
    )?;

    let novo_id = Uuid::new_v4().to_string();
    transaction.execute(
        "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents,
                                    status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'aberta', ?2)",
        params![
            novo_id,
            now,
            actor.id,
            actor.full_name,
            resumo.esperado_cents
        ],
    )?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'cash.rollover', 'cash_session', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            anterior.id,
            serde_json::json!({
                "expected_cents": resumo.esperado_cents,
                "reason": motivo,
                "new_session_id": novo_id,
            })
            .to_string(),
            now
        ],
    )?;
    transaction.commit()?;

    ler_sessao(connection, &novo_id)?.ok_or(AppError::NotFound)
}

pub fn movimentos(connection: &Connection, session_id: &str) -> AppResult<Vec<CashMovement>> {
    let mut statement = connection.prepare(
        "SELECT id, kind, amount_cents, reason, actor_name, occurred_at
         FROM cash_movements WHERE session_id = ?1 ORDER BY occurred_at DESC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        Ok(CashMovement {
            id: row.get(0)?,
            kind: row.get(1)?,
            amount_cents: row.get(2)?,
            reason: row.get(3)?,
            actor_name: row.get(4)?,
            occurred_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn operador() -> LocalUser {
        LocalUser {
            id: "op1".into(),
            username: "caixa".into(),
            full_name: "Caixa Um".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["cash.operate".into(), "cash.manage".into(), "pdv.use".into()],
        must_change_password: false,
        }
    }

    fn base() -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('op1', 'caixa', 'x', 'Caixa Um', 'gerente', 1, 'now', 'now')",
            [],
        ).unwrap();
        c
    }

    /// Um segundo operador, para os testes de troca de turno.
    fn outro_operador() -> LocalUser {
        LocalUser {
            id: "op2".into(),
            username: "caixa2".into(),
            full_name: "Caixa Dois".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["cash.operate".into(), "cash.manage".into(), "pdv.use".into()],
            must_change_password: false,
        }
    }

    fn com_dois_operadores() -> Connection {
        let c = base();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('op2', 'caixa2', 'x', 'Caixa Dois', 'gerente', 1, 'now', 'now')",
            [],
        )
        .unwrap();
        c
    }

    /// O turno é do dia, não de quem abriu.
    ///
    /// Regra do cliente: abre no início do dia, troca de gente no meio, e no
    /// fim do dia alguém fecha — não precisa ser quem abriu. Está em teste
    /// porque é o tipo de coisa que alguém "conserta" depois amarrando o
    /// fechamento ao operador da abertura.
    #[test]
    fn quem_fecha_o_turno_nao_precisa_ser_quem_abriu() {
        let mut c = com_dois_operadores();
        let aberto = abrir(&mut c, &operador(), 20000).unwrap();
        assert_eq!(aberto.opened_by_name, "Caixa Um");

        let fechado = fechar(&mut c, &outro_operador(), 20000, None).unwrap();
        assert_eq!(fechado.status, "fechada");
        assert_eq!(fechado.closed_by_name.as_deref(), Some("Caixa Dois"));
        assert_eq!(fechado.opened_by_name, "Caixa Um", "quem abriu continua registrado");
    }

    /// A troca de operador não parte a contabilidade do turno.
    #[test]
    fn sangria_de_operadores_diferentes_entra_no_mesmo_turno() {
        let mut c = com_dois_operadores();
        let sessao = abrir(&mut c, &operador(), 20000).unwrap();

        movimentar(&mut c, &operador(), "sangria", 5000, "cofre").unwrap();
        movimentar(&mut c, &outro_operador(), "suprimento", 3000, "troco").unwrap();

        let r = resumo(&c, &sessao.id).unwrap();
        assert_eq!(r.withdrawals_cents, 5000);
        assert_eq!(r.deposits_cents, 3000);
        assert_eq!(r.esperado_cents, 20000 - 5000 + 3000);

        let movimentos = movimentos(&c, &sessao.id).unwrap();
        assert_eq!(movimentos.len(), 2, "os dois operadores mexem no mesmo turno");
    }

    /// O fechamento precisa dizer o que saiu, não só se o dinheiro bate.
    #[test]
    fn vendas_do_turno_agrupam_por_categoria_subcategoria_e_produto() {
        use crate::models::{FinalizeSaleInput, SaleItemInput};
        let mut c = base();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','B1','Brahma Latão','Bebidas','Brahma',1000,50,1,'now','now'),
                    ('p2','B2','Skol Beats','Bebidas','Skol',1200,50,1,'now','now'),
                    ('p3','K7','Pulseira K7','Pulseiras','',3000,50,1,'now','now')", []).unwrap();
        let sessao = abrir(&mut c, &operador(), 0).unwrap();

        let mut vender = |id: &str, produto: &str, qtd: i64, pago: i64| {
            crate::sales::finalize(&mut c, &operador(), FinalizeSaleInput {
                client_sale_id: id.into(),
                items: vec![SaleItemInput { product_id: produto.into(), quantity: qtd, credit: false }],
                cash_tendered_cents: pago, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(),
                credit_customer: None,
            }).unwrap();
        };
        vender("v1", "p1", 3, 3000);
        vender("v2", "p2", 2, 2400);
        vender("v3", "p3", 1, 3000);

        let leitor = LocalUser {
            permissions: vec!["reports.closing".into()],
            ..operador()
        };
        let r = vendas_do_turno(&c, &leitor, &sessao.id).unwrap();

        assert_eq!(r.total_cents, 3000 + 2400 + 3000);
        assert_eq!(r.unidades, 6);
        // Bebidas (R$ 54) vem antes de Pulseiras (R$ 30): maior receita primeiro.
        assert_eq!(r.categorias[0].categoria, "Bebidas");
        assert_eq!(r.categorias[0].total_cents, 5400);
        assert_eq!(r.categorias[0].subcategorias.len(), 2, "Brahma e Skol");
        assert_eq!(r.categorias[0].subcategorias[0].subcategoria, "Brahma");
        assert_eq!(r.categorias[0].subcategorias[0].produtos[0].produto, "Brahma Latão");
        assert_eq!(r.categorias[0].subcategorias[0].produtos[0].unidades, 3);
        // Produto sem subcategoria entra num grupo de nome vazio, não some.
        assert_eq!(r.categorias[1].categoria, "Pulseiras");
        assert_eq!(r.categorias[1].subcategorias[0].subcategoria, "");
    }

    #[test]
    fn vendas_do_turno_exige_permissao_de_fechamento() {
        let mut c = base();
        let sessao = abrir(&mut c, &operador(), 0).unwrap();
        let sem = LocalUser { permissions: vec![], ..operador() };
        assert!(matches!(
            vendas_do_turno(&c, &sem, &sessao.id),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn virar_o_dia_encerra_sem_contagem_e_abre_com_o_esperado() {
        let mut c = com_dois_operadores();
        let ontem = abrir(&mut c, &operador(), 20000).unwrap();
        movimentar(&mut c, &operador(), "suprimento", 5000, "reforço").unwrap();

        let hoje = virar_dia(&mut c, &outro_operador(), "esqueceram de fechar ontem").unwrap();

        // O turno novo herda o dinheiro que continua na gaveta.
        assert_eq!(hoje.opening_float_cents, 25000);
        assert_eq!(hoje.status, "aberta");
        assert_ne!(hoje.id, ontem.id);

        let anterior = ler_sessao(&c, &ontem.id).unwrap().unwrap();
        assert_eq!(anterior.status, "fechada");
        assert!(anterior.closed_without_count, "precisa ficar marcado");
        assert_eq!(anterior.expected_cash_cents, Some(25000));
        assert_eq!(
            anterior.counted_cash_cents, None,
            "nunca inventar um valor contado"
        );
        assert_eq!(
            anterior.difference_cents, None,
            "sem contagem não existe diferença apurada"
        );
        assert_eq!(anterior.notes.as_deref(), Some("esqueceram de fechar ontem"));
    }

    #[test]
    fn virar_o_dia_exige_motivo_e_permissao_de_fechar() {
        let mut c = com_dois_operadores();
        abrir(&mut c, &operador(), 10000).unwrap();

        assert!(matches!(
            virar_dia(&mut c, &operador(), "  "),
            Err(AppError::Validation(_))
        ));

        let so_opera = LocalUser {
            permissions: vec!["cash.operate".into()],
            ..operador()
        };
        assert!(matches!(
            virar_dia(&mut c, &so_opera, "virada do dia"),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn virar_o_dia_sem_turno_aberto_e_recusado() {
        let mut c = base();
        assert!(matches!(
            virar_dia(&mut c, &operador(), "virada do dia"),
            Err(AppError::Validation(_))
        ));
    }

    /// Fechamento normal continua gravando a contagem e a diferença.
    #[test]
    fn fechamento_conferido_nao_e_marcado_como_sem_contagem() {
        let mut c = base();
        abrir(&mut c, &operador(), 10000).unwrap();
        let fechado = fechar(&mut c, &operador(), 9500, None).unwrap();
        assert!(!fechado.closed_without_count);
        assert_eq!(fechado.counted_cash_cents, Some(9500));
        assert_eq!(fechado.difference_cents, Some(-500));
    }

    #[test]
    fn abre_o_caixa_e_recusa_um_segundo() {
        let mut c = base();
        let s = abrir(&mut c, &operador(), 20000).unwrap();
        assert_eq!(s.status, "aberta");
        assert_eq!(s.opening_float_cents, 20000);

        let segundo = abrir(&mut c, &operador(), 10000);
        assert!(matches!(segundo, Err(AppError::Conflict(_))));
    }

    #[test]
    fn sangria_e_suprimento_movem_o_esperado() {
        let mut c = base();
        let s = abrir(&mut c, &operador(), 20000).unwrap();
        assert_eq!(resumo(&c, &s.id).unwrap().esperado_cents, 20000);

        movimentar(&mut c, &operador(), "suprimento", 10000, "reforço").unwrap();
        assert_eq!(resumo(&c, &s.id).unwrap().esperado_cents, 30000);

        movimentar(&mut c, &operador(), "sangria", 25000, "malote").unwrap();
        let r = resumo(&c, &s.id).unwrap();
        assert_eq!(r.esperado_cents, 5000);
        assert_eq!(r.withdrawals_cents, 25000);
        assert_eq!(r.deposits_cents, 10000);
    }

    #[test]
    fn sangria_nao_pode_levar_mais_do_que_existe() {
        let mut c = base();
        abrir(&mut c, &operador(), 5000).unwrap();
        let r = movimentar(&mut c, &operador(), "sangria", 9000, "malote");
        assert!(matches!(r, Err(AppError::Validation(_))));
    }

    #[test]
    fn movimento_exige_motivo() {
        let mut c = base();
        abrir(&mut c, &operador(), 5000).unwrap();
        assert!(matches!(
            movimentar(&mut c, &operador(), "sangria", 1000, "   "),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn fechamento_calcula_a_diferenca_e_registra() {
        let mut c = base();
        let s = abrir(&mut c, &operador(), 20000).unwrap();
        movimentar(&mut c, &operador(), "suprimento", 5000, "reforço").unwrap();

        // Faltando R$ 30,00 na gaveta.
        let fechada = fechar(&mut c, &operador(), 22000, Some("conferido a dois".into())).unwrap();
        assert_eq!(fechada.status, "fechada");
        assert_eq!(fechada.expected_cash_cents, Some(25000));
        assert_eq!(fechada.counted_cash_cents, Some(22000));
        assert_eq!(fechada.difference_cents, Some(-3000));
        assert!(sessao_aberta(&c).unwrap().is_none(), "o caixa fica fechado");
        assert_eq!(s.id, fechada.id);
    }

    #[test]
    fn nao_movimenta_nem_fecha_sem_caixa_aberto() {
        let mut c = base();
        assert!(matches!(
            movimentar(&mut c, &operador(), "sangria", 1000, "x"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(fechar(&mut c, &operador(), 0, None), Err(AppError::Validation(_))));
    }

    #[test]
    fn exige_permissao() {
        let mut c = base();
        let mut sem = operador();
        sem.permissions.clear();
        assert!(matches!(abrir(&mut c, &sem, 1000), Err(AppError::Forbidden)));
    }
}
