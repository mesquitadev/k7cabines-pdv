//! Crédito de ficha: o cliente paga agora e retira depois.
//!
//! Compra cinco cervejas e leva uma por vez. O dinheiro entra na venda; a
//! mercadoria sai da geladeira só quando ele vem buscar.
//!
//! A ficha é achada pelo nome que o cliente deu no balcão — não há cadastro,
//! é apelido de fila. Homônimo é resolvido pelo número do pedido, que aparece
//! ao lado na tela.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{CreditVoucher, CreditVoucherItem, LocalUser, WithdrawCreditInput},
};

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Uma ficha pelo id, para reimprimir.
/// Alfabeto sem letras e dígitos que se confundem à mão e na câmera (0/O, 1/I/L).
const ALFABETO_CODIGO: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/// Normaliza o que o atendente digitou para comparar com o código gravado:
/// maiúsculas, sem espaços, hífen ou prefixo "K7".
pub fn normalizar_codigo(entrada: &str) -> String {
    let limpo: String = entrada
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    limpo.strip_prefix("K7").map(str::to_string).unwrap_or(limpo)
}

/// Gera o código da ficha: 4 caracteres do alfabeto seguro, único entre todas
/// as fichas já gravadas. Colisão é rara (≈ 900 mil combinações); se ocorrer,
/// tenta de novo.
pub fn gerar_codigo(connection: &Connection) -> AppResult<String> {
    for _ in 0..50 {
        let bytes = Uuid::new_v4();
        let candidato: String = bytes
            .as_bytes()
            .iter()
            .take(4)
            .map(|b| ALFABETO_CODIGO[(*b as usize) % ALFABETO_CODIGO.len()] as char)
            .collect();
        let existe: i64 = connection.query_row(
            "SELECT COUNT(*) FROM credit_vouchers WHERE code = ?1",
            params![candidato],
            |r| r.get(0),
        )?;
        if existe == 0 {
            return Ok(candidato);
        }
    }
    Err(AppError::Internal("não foi possível gerar o código da ficha".into()))
}

pub fn por_id(connection: &Connection, actor: &LocalUser, id: &str) -> AppResult<CreditVoucher> {
    require(actor, "credit.withdraw")?;
    let (sale_id, sale_number, customer_name, created_at, settled_at, code) = connection
        .query_row(
            "SELECT v.sale_id, s.sale_number, v.customer_name, v.created_at, v.settled_at, v.code
             FROM credit_vouchers v JOIN sales s ON s.id = v.sale_id WHERE v.id = ?1",
            params![id],
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
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    Ok(CreditVoucher {
        items: itens_da_ficha(connection, id)?,
        id: id.to_string(),
        sale_id,
        sale_number,
        code,
        customer_name,
        created_at,
        settled_at,
    })
}

/// A ficha criada por uma venda, quando houve item em crédito.
pub fn da_venda(connection: &Connection, sale_id: &str) -> AppResult<Option<CreditVoucher>> {
    let base: Option<(String, i64, String, String, Option<String>, String)> = connection
        .query_row(
            "SELECT v.id, s.sale_number, v.customer_name, v.created_at, v.settled_at, v.code
             FROM credit_vouchers v JOIN sales s ON s.id = v.sale_id WHERE v.sale_id = ?1",
            params![sale_id],
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
        )
        .optional()?;
    let Some((id, sale_number, customer_name, created_at, settled_at, code)) = base else {
        return Ok(None);
    };
    Ok(Some(CreditVoucher {
        items: itens_da_ficha(connection, &id)?,
        id,
        sale_id: sale_id.to_string(),
        sale_number,
        code,
        customer_name,
        created_at,
        settled_at,
    }))
}

/// Fichas com saldo a retirar, da mais recente para a mais antiga.
///
/// `busca` filtra por código da ficha, nome do cliente ou número do pedido. Vazio devolve
/// todas as abertas, que é o que o atendente quer ver ao abrir a tela.
pub fn listar_abertas(
    connection: &Connection,
    actor: &LocalUser,
    busca: &str,
) -> AppResult<Vec<CreditVoucher>> {
    require(actor, "credit.withdraw")?;
    let termo = busca.trim();
    let curinga = format!("%{termo}%");
    // Só dígitos significa número de pedido; o resto é nome ou código.
    let numero: Option<i64> = termo.parse().ok();
    let codigo = normalizar_codigo(termo);

    let mut st = connection.prepare(
        "SELECT v.id, v.sale_id, s.sale_number, v.customer_name, v.created_at, v.settled_at, v.code
         FROM credit_vouchers v
         JOIN sales s ON s.id = v.sale_id
         WHERE v.settled_at IS NULL
           AND s.status = 'completed'
           AND (?1 = '' OR v.customer_name LIKE ?2 OR s.sale_number = ?3 OR v.code = ?4)
         ORDER BY v.created_at DESC
         LIMIT 100",
    )?;
    let bases = st
        .query_map(params![termo, curinga, numero, codigo], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut fichas = Vec::with_capacity(bases.len());
    for (id, sale_id, sale_number, customer_name, created_at, settled_at, code) in bases {
        fichas.push(CreditVoucher {
            items: itens_da_ficha(connection, &id)?,
            id,
            sale_id,
            sale_number,
            code,
            customer_name,
            created_at,
            settled_at,
        });
    }
    Ok(fichas)
}

fn itens_da_ficha(connection: &Connection, voucher_id: &str) -> AppResult<Vec<CreditVoucherItem>> {
    let mut st = connection.prepare(
        "SELECT id, product_id, product_name, category, quantity, taken_quantity
         FROM credit_voucher_items WHERE voucher_id = ?1 ORDER BY rowid",
    )?;
    let linhas = st.query_map(params![voucher_id], |row| {
        Ok(CreditVoucherItem {
            id: row.get(0)?,
            product_id: row.get(1)?,
            product_name: row.get(2)?,
            category: row.get(3)?,
            quantity: row.get(4)?,
            taken_quantity: row.get(5)?,
        })
    })?;
    linhas.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Entrega parte de um item da ficha.
///
/// É aqui que o estoque sai, com consumo FEFO, porque é agora que a garrafa
/// deixa a geladeira. A venda já cobrou; esta operação não mexe em dinheiro.
pub fn retirar(
    connection: &mut Connection,
    actor: &LocalUser,
    input: WithdrawCreditInput,
) -> AppResult<CreditVoucher> {
    require(actor, "credit.withdraw")?;
    if input.quantity <= 0 {
        return Err(AppError::Validation(
            "a quantidade retirada deve ser maior que zero".into(),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;

    // Duplo clique antes de qualquer outra checagem: com a ficha de uma
    // unidade, a segunda tentativa encontraria "restam 0" e esconderia que a
    // entrega já aconteceu.
    if let Some(cliente) = input.client_withdrawal_id.as_deref() {
        let repetida: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM credit_withdrawals WHERE client_withdrawal_id = ?1)",
            params![cliente],
            |row| row.get(0),
        )?;
        if repetida {
            return Err(AppError::Conflict("esta retirada já foi registrada".into()));
        }
    }

    let (voucher_id, product_id, product_name, comprada, retirada): (
        String,
        Option<String>,
        String,
        i64,
        i64,
    ) = transaction
        .query_row(
            "SELECT voucher_id, product_id, product_name, quantity, taken_quantity
             FROM credit_voucher_items WHERE id = ?1",
            params![input.voucher_item_id],
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
        .optional()?
        .ok_or(AppError::NotFound)?;

    let disponivel = comprada - retirada;
    if input.quantity > disponivel {
        return Err(AppError::Validation(format!(
            "restam {disponivel} de {product_name} nesta ficha"
        )));
    }

    transaction.execute(
        "INSERT INTO credit_withdrawals
            (id, voucher_item_id, quantity, client_withdrawal_id, actor_id, actor_name, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            Uuid::new_v4().to_string(),
            input.voucher_item_id,
            input.quantity,
            input.client_withdrawal_id.as_deref(),
            actor.id,
            actor.full_name,
            now
        ],
    )
    .map_err(|erro| match erro {
        rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
            AppError::Conflict("esta retirada já foi registrada".into())
        }
        outro => AppError::Database(outro),
    })?;

    transaction.execute(
        "UPDATE credit_voucher_items SET taken_quantity = taken_quantity + ?1 WHERE id = ?2",
        params![input.quantity, input.voucher_item_id],
    )?;

    // Agora sim o estoque sai, com o mesmo cuidado da venda.
    if let Some(pid) = &product_id {
        let mudou = transaction.execute(
            "UPDATE products
             SET stock_quantity = stock_quantity - ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3 AND stock_quantity >= ?1",
            params![input.quantity, now, pid],
        )?;
        if mudou != 1 {
            return Err(AppError::Validation(format!(
                "estoque insuficiente para entregar {product_name}"
            )));
        }
        consumir_lotes(&transaction, pid, input.quantity, &now)?;
        transaction.execute(
            "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason, reference_type,
                                          reference_id, actor_id, actor_name, occurred_at)
             VALUES (?1, ?2, NULL, ?3, 'credit.withdraw', 'credit', ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                pid,
                -input.quantity,
                voucher_id,
                actor.id,
                actor.full_name,
                now
            ],
        )?;
    }

    // Ficha quitada quando não resta nada a retirar em nenhum item.
    let em_aberto: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM credit_voucher_items
         WHERE voucher_id = ?1 AND taken_quantity < quantity",
        params![voucher_id],
        |row| row.get(0),
    )?;
    if em_aberto == 0 {
        transaction.execute(
            "UPDATE credit_vouchers SET settled_at = ?1 WHERE id = ?2",
            params![now, voucher_id],
        )?;
    }

    crate::stock::audit(
        &transaction,
        actor,
        "credit.withdraw",
        &voucher_id,
        serde_json::json!({
            "produto": product_name,
            "quantidade": input.quantity,
        }),
        &now,
    )?;
    transaction.commit()?;

    let itens = itens_da_ficha(connection, &voucher_id)?;
    let (sale_id, sale_number, customer_name, created_at, settled_at, code) = connection.query_row(
        "SELECT v.sale_id, s.sale_number, v.customer_name, v.created_at, v.settled_at, v.code
         FROM credit_vouchers v JOIN sales s ON s.id = v.sale_id WHERE v.id = ?1",
        params![voucher_id],
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
    Ok(CreditVoucher {
        id: voucher_id,
        sale_id,
        sale_number,
        code,
        customer_name,
        created_at,
        settled_at,
        items: itens,
    })
}

/// Consome do lote que vence primeiro, como a venda faz.
fn consumir_lotes(
    transaction: &rusqlite::Transaction<'_>,
    product_id: &str,
    quantidade: i64,
    agora: &str,
) -> AppResult<()> {
    let lotes: Vec<(String, i64)> = {
        let mut st = transaction.prepare(
            "SELECT id, quantity FROM product_batches
             WHERE product_id = ?1 AND quantity > 0 ORDER BY expiry_date ASC",
        )?;
        let linhas = st.query_map(params![product_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        linhas.collect::<Result<Vec<_>, _>>()?
    };
    let mut restante = quantidade;
    for (batch_id, saldo) in lotes {
        if restante <= 0 {
            break;
        }
        let tira = saldo.min(restante);
        transaction.execute(
            "UPDATE product_batches
             SET quantity = quantity - ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3",
            params![tira, agora, batch_id],
        )?;
        restante -= tira;
    }
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
                "credit.sell".into(),
                "credit.withdraw".into(),
            ],
            must_change_password: false,
        }
    }

    /// Cinco cervejas pagas de uma vez, com dois lotes no estoque.
    fn cenario() -> Connection {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1','g','x','Gerente','master',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','B1','Brahma','Bebidas','Brahma',1000,10,1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO product_batches (id, product_id, expiry_date, quantity, created_at, updated_at)
             VALUES ('b1','p1','2027-01-01',4,'now','now'), ('b2','p1','2027-06-01',6,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents, status, created_at)
             VALUES ('s1','now','g1','Gerente',0,'aberta','now')", []).unwrap();
        sales::finalize(&mut c, &ator(), FinalizeSaleInput {
            client_sale_id: "v1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 1, credit: true }],
            cash_tendered_cents: 1000, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(),
            credit_customer: Some("João da mesa 4".into()),
        }).unwrap();
        c
    }

    fn saldo(c: &Connection) -> (i64, i64) {
        let produto: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        let lotes: i64 = c.query_row("SELECT SUM(quantity) FROM product_batches WHERE product_id='p1'", [], |r| r.get(0)).unwrap();
        (produto, lotes)
    }

    #[test]
    fn venda_em_ficha_cobra_agora_e_nao_baixa_estoque() {
        let c = cenario();
        assert_eq!(saldo(&c), (10, 10), "a garrafa continua na geladeira");

        let total: i64 = c.query_row("SELECT total_cents FROM sales", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 1000, "o dinheiro entrou na venda");

        let fichas = listar_abertas(&c, &ator(), "").unwrap();
        assert_eq!(fichas.len(), 1);
        assert_eq!(fichas[0].customer_name, "João da mesa 4");
        assert_eq!(fichas[0].items[0].quantity, 1, "ficha é um item só");
        assert_eq!(fichas[0].items[0].taken_quantity, 0);
    }

    #[test]
    fn cada_retirada_baixa_estoque_consumindo_o_lote_que_vence_antes() {
        let mut c = cenario();
        let item = listar_abertas(&c, &ator(), "").unwrap()[0].items[0].id.clone();

        let ficha = retirar(&mut c, &ator(), WithdrawCreditInput {
            voucher_item_id: item, quantity: 1, client_withdrawal_id: None,
        }).unwrap();
        assert_eq!(saldo(&c), (9, 9));
        let b1: i64 = c.query_row("SELECT quantity FROM product_batches WHERE id='b1'", [], |r| r.get(0)).unwrap();
        assert_eq!(b1, 3, "o lote que vence antes sai primeiro");
        assert!(ficha.settled_at.is_some(), "a ficha de um item se encerra na entrega");
        assert!(listar_abertas(&c, &ator(), "").unwrap().is_empty());
    }

    #[test]
    fn nao_retira_mais_do_que_foi_pago() {
        let mut c = cenario();
        let item = listar_abertas(&c, &ator(), "").unwrap()[0].items[0].id.clone();
        let demais = retirar(&mut c, &ator(), WithdrawCreditInput {
            voucher_item_id: item, quantity: 2, client_withdrawal_id: None,
        });
        assert!(matches!(demais, Err(AppError::Validation(_))));
        assert_eq!(saldo(&c), (10, 10), "nada pode ter saído");
    }

    #[test]
    fn retirada_e_idempotente_por_client_withdrawal_id() {
        let mut c = cenario();
        let item = listar_abertas(&c, &ator(), "").unwrap()[0].items[0].id.clone();
        let entrada = || WithdrawCreditInput {
            voucher_item_id: item.clone(), quantity: 1,
            client_withdrawal_id: Some("ret-1".into()),
        };
        retirar(&mut c, &ator(), entrada()).unwrap();
        assert!(matches!(retirar(&mut c, &ator(), entrada()), Err(AppError::Conflict(_))));
        assert_eq!(saldo(&c), (9, 9), "o duplo clique não pode entregar duas");
    }

    #[test]
    fn a_ficha_e_encontrada_por_nome_e_por_numero_do_pedido() {
        let c = cenario();
        assert_eq!(listar_abertas(&c, &ator(), "joão").unwrap().len(), 1);
        assert_eq!(listar_abertas(&c, &ator(), "JOAO DA MESA").unwrap().len(), 0,
                   "sem acento não casa: a busca é por trecho do nome como digitado");
        assert_eq!(listar_abertas(&c, &ator(), "mesa 4").unwrap().len(), 1);
        let numero: i64 = c.query_row("SELECT sale_number FROM sales", [], |r| r.get(0)).unwrap();
        assert_eq!(
            listar_abertas(&c, &ator(), &numero.to_string()).unwrap().len(),
            1,
            "número do pedido"
        );
        assert_eq!(listar_abertas(&c, &ator(), "zzz").unwrap().len(), 0);
    }

    #[test]
    fn venda_em_ficha_sem_nome_e_aceita_e_ganha_codigo() {
        let mut c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1','g','x','Gerente','master',1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1','B1','Brahma','Bebidas','',1000,10,1,'now','now')", []).unwrap();
        c.execute(
            "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_float_cents, status, created_at)
             VALUES ('s1','now','g1','Gerente',0,'aberta','now')", []).unwrap();
        sales::finalize(&mut c, &ator(), FinalizeSaleInput {
            client_sale_id: "v1".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 1, credit: true }],
            cash_tendered_cents: 1000, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(),
            credit_customer: None,
        }).unwrap();
        let fichas = listar_abertas(&c, &ator(), "").unwrap();
        assert_eq!(fichas.len(), 1);
        assert_eq!(fichas[0].customer_name, "");
        assert_eq!(fichas[0].code.len(), 4, "a ficha ao portador é identificada pelo código");
        // A busca acha pelo código, com ou sem prefixo, em qualquer caixa.
        let codigo = fichas[0].code.clone();
        assert_eq!(listar_abertas(&c, &ator(), &codigo.to_lowercase()).unwrap().len(), 1);
        assert_eq!(listar_abertas(&c, &ator(), &format!("k7-{codigo}")).unwrap().len(), 1);
        assert_eq!(listar_abertas(&c, &ator(), "ZZZZ").unwrap().len(), 0);
    }

    #[test]
    fn ficha_so_aceita_um_produto_por_venda() {
        let mut c = cenario();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p2','K7','Pulseira K7','Pulseiras','',3000,5,1,'now','now')", []).unwrap();

        let mista = sales::finalize(&mut c, &ator(), FinalizeSaleInput {
            client_sale_id: "v2".into(),
            items: vec![
                SaleItemInput { product_id: "p2".into(), quantity: 1, credit: false },
                SaleItemInput { product_id: "p1".into(), quantity: 2, credit: true },
            ],
            cash_tendered_cents: 5000, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(),
            credit_customer: Some("Maria".into()),
        });
        assert!(matches!(mista, Err(AppError::Validation(_))), "ficha é um produto por papel");
        assert_eq!(saldo(&c).0, 10, "nada saiu");

        // Uma linha, mas duas unidades: também não. Uma ficha, uma retirada.
        let dupla = sales::finalize(&mut c, &ator(), FinalizeSaleInput {
            client_sale_id: "v3".into(),
            items: vec![SaleItemInput { product_id: "p1".into(), quantity: 2, credit: true }],
            cash_tendered_cents: 2000, card_cents: 0, pix_cents: 0, discount_cents: 0, discount_reason: String::new(), customer_name: String::new(),
            credit_customer: None,
        });
        assert!(matches!(dupla, Err(AppError::Validation(_))), "ficha é uma unidade por papel");
    }

    #[test]
    fn sem_permissao_nao_vende_nem_entrega() {
        let mut c = cenario();
        let sem = LocalUser { permissions: vec!["pdv.use".into()], ..ator() };
        assert!(matches!(listar_abertas(&c, &sem, ""), Err(AppError::Forbidden)));
        let item = listar_abertas(&c, &ator(), "").unwrap()[0].items[0].id.clone();
        assert!(matches!(
            retirar(&mut c, &sem, WithdrawCreditInput {
                voucher_item_id: item, quantity: 1, client_withdrawal_id: None,
            }),
            Err(AppError::Forbidden)
        ));
    }
}
