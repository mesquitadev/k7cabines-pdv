use chrono::{Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{CompletedSale, CompletedSaleItem, FinalizeSaleInput, LocalUser},
};

const MAX_ITEMS: usize = 200;
const MAX_QUANTITY: i64 = 999;
const MAX_MONEY_CENTS: i64 = 100_000_000;

/// Regra de negócio: a Pulseira K7 é limitada a uma unidade por venda.
fn is_pulseira_k7(name: &str) -> bool {
    name.to_lowercase().contains("pulseira k7")
}

pub fn finalize(
    connection: &mut Connection,
    actor: &LocalUser,
    input: FinalizeSaleInput,
) -> AppResult<CompletedSale> {
    require_permission(actor, "pdv.use")?;

    let client_sale_id = input.client_sale_id.trim().to_string();
    if client_sale_id.is_empty() || client_sale_id.len() > 64 {
        return Err(AppError::Validation(
            "identificador da venda é obrigatório".into(),
        ));
    }
    if input.items.is_empty() {
        return Err(AppError::Validation("o carrinho está vazio".into()));
    }
    if input.items.len() > MAX_ITEMS {
        return Err(AppError::Validation(
            "a venda tem itens demais para um único cupom".into(),
        ));
    }
    if input.cash_tendered_cents < 0 || input.card_cents < 0 || input.pix_cents < 0 {
        return Err(AppError::Validation(
            "os valores pagos não podem ser negativos".into(),
        ));
    }
    if input.cash_tendered_cents > MAX_MONEY_CENTS
        || input.card_cents > MAX_MONEY_CENTS
        || input.pix_cents > MAX_MONEY_CENTS
    {
        return Err(AppError::Validation("valor pago fora da faixa".into()));
    }
    if input.discount_cents < 0 {
        return Err(AppError::Validation("o desconto não pode ser negativo".into()));
    }
    let discount_reason = input.discount_reason.trim().to_string();
    if input.discount_cents > 0 && discount_reason.len() < 3 {
        return Err(AppError::Validation("informe o motivo do desconto".into()));
    }
    // Cliente da venda: opcional; se veio só na ficha, aproveita o mesmo nome.
    let customer_name = {
        let direto = input.customer_name.trim();
        if direto.is_empty() {
            input.credit_customer.as_deref().map(str::trim).unwrap_or("").to_string()
        } else {
            direto.to_string()
        }
    };
    if customer_name.chars().count() > 60 {
        return Err(AppError::Validation("o nome do cliente é longo demais".into()));
    }

    // Idempotência: a mesma venda enviada duas vezes devolve o mesmo cupom.
    if let Some(existing) = find_by_client_sale_id(connection, &client_sale_id)? {
        return Ok(existing);
    }

    // Venda pertence a um turno: sem caixa aberto não há onde lançar o dinheiro,
    // e o fechamento não teria como conferir a gaveta. A exigência é parametrizável
    // porque nem toda loja controla gaveta.
    let exige_caixa = crate::params::booleano(connection, "venda.exige_caixa_aberto", true);
    let ciclo = crate::params::inteiro(connection, "venda.numero_maximo", 999).max(9) + 1;
    let session_id: Option<String> = connection
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'aberta'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if exige_caixa && session_id.is_none() {
        return Err(AppError::Validation("abra o turno antes de vender".into()));
    }

    let now = Utc::now().to_rfc3339();
    let business_date = Local::now().date_naive().format("%Y-%m-%d").to_string();
    let sale_id = Uuid::new_v4().to_string();

    let transaction = connection.transaction()?;

    let mut items: Vec<CompletedSaleItem> = Vec::with_capacity(input.items.len());
    // Custo unitário de cada item, na mesma ordem de `items`.
    let mut custos: Vec<i64> = Vec::with_capacity(input.items.len());
    // Quais itens ficam em ficha, na mesma ordem de `items`.
    let mut em_credito: Vec<bool> = Vec::with_capacity(input.items.len());
    let mut total_cents: i64 = 0;
    let mut seen: Vec<String> = Vec::with_capacity(input.items.len());
    let mut pulseira_k7_count: i64 = 0;

    for item in &input.items {
        if item.quantity <= 0 || item.quantity > MAX_QUANTITY {
            return Err(AppError::Validation("quantidade inválida".into()));
        }
        if seen.iter().any(|id| id == &item.product_id) {
            return Err(AppError::Validation(
                "o mesmo produto foi enviado duas vezes no carrinho".into(),
            ));
        }
        seen.push(item.product_id.clone());

        // Preço, custo e estoque vêm sempre do banco; nunca do frontend.
        let (code, name, category, price_cents, stock, cost_cents): (
            String,
            String,
            String,
            i64,
            i64,
            i64,
        ) = transaction
                .query_row(
                    "SELECT code, name, category, price_cents, stock_quantity, cost_cents
                     FROM products WHERE id = ?1 AND active = 1",
                    params![item.product_id],
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
                .ok_or_else(|| {
                    AppError::Validation("produto indisponível para venda".into())
                })?;

        if is_pulseira_k7(&name) {
            pulseira_k7_count += item.quantity;
            if pulseira_k7_count > 1 {
                return Err(AppError::Validation(
                    "Pulseira K7: apenas 1 por venda".into(),
                ));
            }
        }

        if stock < item.quantity {
            return Err(AppError::Validation(format!(
                "estoque insuficiente para {name}. Disponível: {stock}"
            )));
        }

        let subtotal_cents = price_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| AppError::Validation("subtotal fora da faixa".into()))?;
        total_cents = total_cents
            .checked_add(subtotal_cents)
            .filter(|value| *value <= MAX_MONEY_CENTS)
            .ok_or_else(|| AppError::Validation("total fora da faixa".into()))?;

        // O custo é congelado aqui junto com o preço: ele muda a cada compra, e
        // sem a foto do momento não há CMV honesto no relatório.
        custos.push(cost_cents);
        em_credito.push(item.credit);
        items.push(CompletedSaleItem {
            product_id: item.product_id.clone(),
            product_code: code,
            product_name: name,
            category,
            unit_price_cents: price_cents,
            quantity: item.quantity,
            subtotal_cents,
        });
    }

    // O total dos itens é o subtotal; o desconto incide sobre ele.
    let subtotal_cents = total_cents;
    if input.discount_cents > subtotal_cents {
        return Err(AppError::Validation(
            "o desconto não pode ser maior que o valor da venda".into(),
        ));
    }
    let total_cents = subtotal_cents - input.discount_cents;

    let paid_cents = input.cash_tendered_cents + input.card_cents + input.pix_cents;
    if input.card_cents + input.pix_cents > total_cents {
        return Err(AppError::Validation(
            "cartão e PIX somados não podem ultrapassar o total".into(),
        ));
    }
    if paid_cents < total_cents {
        return Err(AppError::Validation("valor pago insuficiente".into()));
    }
    let change_cents = if input.cash_tendered_cents > 0 {
        paid_cents - total_cents
    } else {
        0
    };
    if change_cents != paid_cents - total_cents {
        return Err(AppError::Validation(
            "pagamento inconsistente: troco só é possível em dinheiro".into(),
        ));
    }

    let payload_hash = payload_hash(&client_sale_id, &items, total_cents);

    // Paridade com o legado: o número é global e cicla de 0 a 999.
    // É o número que o cliente usa para retirar o pedido na chapelaria.
    let last_number: Option<i64> = transaction
        .query_row(
            "SELECT sale_number FROM sales ORDER BY created_at DESC, rowid DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let mut sale_number = match last_number {
        None => 0,
        Some(last) => (last + 1) % ciclo,
    };
    // O legado não garante unicidade; aqui o banco garante. Se o número já foi
    // usado hoje (só acontece acima de 1000 vendas no mesmo dia), pula para o
    // próximo livre em vez de recusar a venda.
    for _ in 0..1000 {
        let em_uso: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sales WHERE business_date = ?1 AND sale_number = ?2)",
            params![business_date, sale_number],
            |row| row.get(0),
        )?;
        if !em_uso {
            break;
        }
        sale_number = (sale_number + 1) % ciclo;
    }

    transaction.execute(
        "INSERT INTO sales (id, client_sale_id, sale_number, business_date, status, total_cents,
                            cash_tendered_cents, card_cents, change_cents, operator_id,
                            operator_name, payload_hash, created_at, cash_session_id,
                            subtotal_cents, pix_cents, discount_cents, discount_reason, customer_name)
         VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            sale_id,
            client_sale_id,
            sale_number,
            business_date,
            total_cents,
            input.cash_tendered_cents,
            input.card_cents,
            change_cents,
            actor.id,
            actor.full_name,
            payload_hash,
            now,
            session_id,
            subtotal_cents,
            input.pix_cents,
            input.discount_cents,
            discount_reason,
            customer_name
        ],
    ).map_err(|error| match error {
        rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
            AppError::Conflict("esta venda já foi registrada".into())
        }
        other => AppError::Database(other),
    })?;

    // Ficha: só existe quando algum item fica para retirar depois.
    let tem_credito = em_credito.iter().any(|c| *c);
    let voucher_id = if tem_credito {
        require_permission(actor, "credit.sell")?;
        // Ficha ao portador: um item por ficha — um produto, uma unidade, uma
        // venda. Quem quer duas cervejas faz duas vendas e recebe dois papéis:
        // cada papel vale exatamente uma retirada, sem conta a fazer no balcão.
        if items.len() != 1 || items[0].quantity != 1 {
            return Err(AppError::Validation(
                "ficha é um item só: um produto, uma unidade por venda".into(),
            ));
        }
        // O nome é opcional: ajuda a achar, mas a ficha é do portador.
        let nome = input
            .credit_customer
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        if nome.chars().count() > 60 {
            return Err(AppError::Validation("o nome do cliente é longo demais".into()));
        }
        let id = Uuid::new_v4().to_string();
        let code = crate::credito::gerar_codigo(&transaction)?;
        transaction.execute(
            "INSERT INTO credit_vouchers (id, sale_id, customer_name, created_at, code)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, sale_id, nome, now, code],
        )?;
        Some(id)
    } else {
        None
    };

    for (indice, item) in items.iter().enumerate() {
        let sale_item_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO sale_items (id, sale_id, product_id, product_code, product_name, category,
                                     unit_price_cents, quantity, subtotal_cents, unit_cost_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                sale_item_id,
                sale_id,
                item.product_id,
                item.product_code,
                item.product_name,
                item.category,
                item.unit_price_cents,
                item.quantity,
                item.subtotal_cents,
                custos[indice]
            ],
        )?;

        // Item em crédito não baixa estoque agora: a mercadoria continua na
        // geladeira até o cliente vir buscar. A baixa acontece na retirada.
        if em_credito[indice] {
            transaction.execute(
                "INSERT INTO credit_voucher_items
                    (id, voucher_id, product_id, product_name, category, quantity)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    Uuid::new_v4().to_string(),
                    voucher_id.as_ref().expect("ficha criada quando há item em crédito"),
                    item.product_id,
                    item.product_name,
                    item.category,
                    item.quantity
                ],
            )?;
            continue;
        }

        // Baixa de estoque protegida: só reduz se ainda houver saldo suficiente.
        let updated = transaction.execute(
            "UPDATE products
             SET stock_quantity = stock_quantity - ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3 AND stock_quantity >= ?1",
            params![item.quantity, now, item.product_id],
        )?;
        if updated != 1 {
            return Err(AppError::Validation(format!(
                "estoque insuficiente para {}",
                item.product_name
            )));
        }

        consume_batches(&transaction, sale_item_id.as_str(), item, &now, actor, &sale_id)?;

        transaction.execute(
            "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason, reference_type,
                                          reference_id, actor_id, actor_name, occurred_at)
             VALUES (?1, ?2, NULL, ?3, 'sale', 'sale', ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                item.product_id,
                -item.quantity,
                sale_id,
                actor.id,
                actor.full_name,
                now
            ],
        )?;
    }

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json,
                                   correlation_id, occurred_at)
         VALUES (?1, ?2, 'sale.finalize', 'sale', ?3, ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            sale_id,
            serde_json::json!({
                "sale_number": sale_number,
                "business_date": business_date,
                "total_cents": total_cents,
                "items": items.len(),
            })
            .to_string(),
            client_sale_id,
            now
        ],
    )?;

    // Reservado para sincronização futura; nada é enviado para fora do aplicativo.
    transaction.execute(
        "INSERT INTO sync_outbox (id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at)
         VALUES (?1, 'sale', ?2, 'sale.completed', ?3, ?4)",
        params![
            Uuid::new_v4().to_string(),
            sale_id,
            serde_json::json!({ "client_sale_id": client_sale_id, "payload_hash": payload_hash })
                .to_string(),
            now
        ],
    )?;

    transaction.commit()?;

    Ok(CompletedSale {
        id: sale_id,
        subtotal_cents,
        discount_cents: input.discount_cents,
        pix_cents: input.pix_cents,
        client_sale_id,
        sale_number,
        business_date,
        total_cents,
        cash_tendered_cents: input.cash_tendered_cents,
        card_cents: input.card_cents,
        change_cents,
        operator_name: actor.full_name.clone(),
        created_at: now,
        items,
    })
}

/// Consome lotes FEFO quando o produto tem controle de validade.
fn consume_batches(
    transaction: &rusqlite::Transaction<'_>,
    sale_item_id: &str,
    item: &CompletedSaleItem,
    now: &str,
    actor: &LocalUser,
    sale_id: &str,
) -> AppResult<()> {
    let mut remaining = item.quantity;
    let batches: Vec<(String, i64)> = {
        let mut statement = transaction.prepare(
            "SELECT id, quantity FROM product_batches
             WHERE product_id = ?1 AND quantity > 0
             ORDER BY expiry_date ASC, created_at ASC, id ASC",
        )?;
        let rows = statement.query_map(params![item.product_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for (batch_id, available) in batches {
        if remaining <= 0 {
            break;
        }
        let take = available.min(remaining);
        transaction.execute(
            "UPDATE product_batches
             SET quantity = quantity - ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3 AND quantity >= ?1",
            params![take, now, batch_id],
        )?;
        transaction.execute(
            "INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity) VALUES (?1, ?2, ?3)",
            params![sale_item_id, batch_id, take],
        )?;
        transaction.execute(
            "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason, reference_type,
                                          reference_id, actor_id, actor_name, occurred_at)
             VALUES (?1, ?2, ?3, ?4, 'sale.batch', 'sale', ?5, ?6, ?7, ?8)",
            params![
                Uuid::new_v4().to_string(),
                item.product_id,
                batch_id,
                -take,
                sale_id,
                actor.id,
                actor.full_name,
                now
            ],
        )?;
        remaining -= take;
    }
    Ok(())
}

fn payload_hash(client_sale_id: &str, items: &[CompletedSaleItem], total_cents: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(client_sale_id.as_bytes());
    for item in items {
        hasher.update(item.product_id.as_bytes());
        hasher.update(item.unit_price_cents.to_le_bytes());
        hasher.update(item.quantity.to_le_bytes());
    }
    hasher.update(total_cents.to_le_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn find_by_client_sale_id(
    connection: &Connection,
    client_sale_id: &str,
) -> AppResult<Option<CompletedSale>> {
    buscar(connection, "client_sale_id", client_sale_id)
}

/// A venda pelo id interno, para reimprimir a partir do relatório.
pub fn find_by_id(connection: &Connection, sale_id: &str) -> AppResult<Option<CompletedSale>> {
    buscar(connection, "id", sale_id)
}

/// Carrega a venda por uma das duas chaves únicas.
///
/// `coluna` nunca vem da tela: são dois literais deste arquivo. Concatenar
/// SQL só é seguro porque o valor é sempre parametrizado.
fn buscar(connection: &Connection, coluna: &str, valor: &str) -> AppResult<Option<CompletedSale>> {
    debug_assert!(matches!(coluna, "id" | "client_sale_id"));
    let sale = connection
        .query_row(
            &format!(
                "SELECT id, client_sale_id, sale_number, business_date, total_cents,
                        cash_tendered_cents, card_cents, change_cents, operator_name, created_at,
                        subtotal_cents, discount_cents, pix_cents
                 FROM sales WHERE {coluna} = ?1"
            ),
            params![valor],
            |row| {
                Ok(CompletedSale {
                    id: row.get(0)?,
                    client_sale_id: row.get(1)?,
                    sale_number: row.get(2)?,
                    business_date: row.get(3)?,
                    total_cents: row.get(4)?,
                    cash_tendered_cents: row.get(5)?,
                    card_cents: row.get(6)?,
                    change_cents: row.get(7)?,
                    operator_name: row.get(8)?,
                    created_at: row.get(9)?,
                    subtotal_cents: row.get(10)?,
                    discount_cents: row.get(11)?,
                    pix_cents: row.get(12)?,
                    items: Vec::new(),
                })
            },
        )
        .optional()?;

    let Some(mut sale) = sale else {
        return Ok(None);
    };

    let mut statement = connection.prepare(
        "SELECT product_id, product_code, product_name, category, unit_price_cents, quantity, subtotal_cents
         FROM sale_items WHERE sale_id = ?1 ORDER BY rowid",
    )?;
    let rows = statement.query_map(params![sale.id], |row| {
        Ok(CompletedSaleItem {
            product_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            product_code: row.get(1)?,
            product_name: row.get(2)?,
            category: row.get(3)?,
            unit_price_cents: row.get(4)?,
            quantity: row.get(5)?,
            subtotal_cents: row.get(6)?,
        })
    })?;
    sale.items = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(Some(sale))
}

fn require_permission(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor
        .permissions
        .iter()
        .any(|candidate| candidate == permission)
    {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::SaleItemInput;

    fn operator() -> LocalUser {
        LocalUser {
            id: "operator-1".into(),
            username: "caixa".into(),
            full_name: "Caixa Um".into(),
            whatsapp: None,
            role: "atendente".into(),
            permissions: vec!["pdv.use".into()],
        must_change_password: false,
        }
    }

    fn seed(connection: &Connection) {
        connection
            .execute(
                "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
                 VALUES ('operator-1', 'caixa', 'test-only', 'Caixa Um', 'atendente', 1, 'now', 'now')",
                [],
            )
            .expect("actor should exist");
        connection
            .execute(
                "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
                 VALUES ('p-agua', 'A1', 'Água com gás', 'Bebidas', '', 500, 10, 1, 'now', 'now')",
                [],
            )
            .expect("product should exist");
        connection
            .execute(
                "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
                 VALUES ('p-k7', 'K7', 'Pulseira K7', 'Pulseiras', '', 3000, 5, 1, 'now', 'now')",
                [],
            )
            .expect("product should exist");
        connection
            .execute(
                "INSERT INTO product_batches (id, product_id, expiry_date, quantity, created_at, updated_at)
                 VALUES ('b-1', 'p-agua', '2027-01-01', 3, 'now', 'now'),
                        ('b-2', 'p-agua', '2027-06-01', 7, 'now', 'now')",
                [],
            )
            .expect("batches should exist");

        // Toda venda pertence a um turno; os cenários abrem o caixa primeiro.
        connection
            .execute(
                "INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name,
                                            opening_float_cents, status, created_at)
                 VALUES ('sessao-1', 'now', 'operator-1', 'Caixa Um', 0, 'aberta', 'now')",
                [],
            )
            .expect("cash session should open");
    }

    fn input(client_sale_id: &str, items: Vec<(&str, i64)>, cash: i64, card: i64) -> FinalizeSaleInput {
        FinalizeSaleInput {
            client_sale_id: client_sale_id.into(),
            items: items
                .into_iter()
                .map(|(product_id, quantity)| SaleItemInput {
                    product_id: product_id.into(),
                    quantity,
                    credit: false,
                })
                .collect(),
            cash_tendered_cents: cash,
            card_cents: card,
            pix_cents: 0,
            discount_cents: 0, discount_reason: String::new(), customer_name: String::new(),
            credit_customer: None,
        }
    }

    #[test]
    fn finalizes_sale_with_server_side_prices_stock_and_fefo_batches() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);

        let sale = finalize(
            &mut connection,
            &operator(),
            input("venda-1", vec![("p-agua", 4), ("p-k7", 1)], 6000, 0),
        )
        .expect("sale should be finalized");

        assert_eq!(sale.sale_number, 0, "a primeira venda do legado comeca em 0");
        assert_eq!(sale.total_cents, 4 * 500 + 3000);
        assert_eq!(sale.change_cents, 6000 - 5000);
        assert_eq!(sale.items.len(), 2);

        let stock: i64 = connection
            .query_row("SELECT stock_quantity FROM products WHERE id = 'p-agua'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stock, 6);

        // FEFO: o lote com validade mais próxima é consumido primeiro.
        let first: i64 = connection
            .query_row("SELECT quantity FROM product_batches WHERE id = 'b-1'", [], |r| r.get(0))
            .unwrap();
        let second: i64 = connection
            .query_row("SELECT quantity FROM product_batches WHERE id = 'b-2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!((first, second), (0, 6));

        let movements: i64 = connection
            .query_row("SELECT COUNT(*) FROM stock_movements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(movements, 4); // 2 vendas + 2 lotes
        let outbox: i64 = connection
            .query_row("SELECT COUNT(*) FROM sync_outbox WHERE exported_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(outbox, 1);
    }

    #[test]
    fn numera_vendas_ciclando_de_0_a_999_como_o_legado() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        let first = finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 1)], 500, 0)).unwrap();
        let second = finalize(&mut connection, &operator(), input("v-2", vec![("p-agua", 1)], 500, 0)).unwrap();
        assert_eq!((first.sale_number, second.sale_number), (0, 1));
        assert_eq!(first.business_date, second.business_date);

        // Ao passar de 999 o número volta para 0.
        connection
            .execute("UPDATE sales SET sale_number = 500 WHERE client_sale_id = 'v-1'", [])
            .unwrap();
        connection
            .execute("UPDATE sales SET sale_number = 999 WHERE client_sale_id = 'v-2'", [])
            .unwrap();
        let third = finalize(&mut connection, &operator(), input("v-3", vec![("p-agua", 1)], 500, 0)).unwrap();
        assert_eq!(third.sale_number, 0);
    }

    #[test]
    fn nao_vende_com_o_caixa_fechado() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        connection
            .execute("UPDATE cash_sessions SET status = 'fechada'", [])
            .unwrap();

        let resultado = finalize(
            &mut connection,
            &operator(),
            input("v-1", vec![("p-agua", 1)], 500, 0),
        );
        assert!(matches!(resultado, Err(AppError::Validation(_))));

        let vendas: i64 = connection
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(vendas, 0, "nada é gravado sem turno aberto");
    }

    #[test]
    fn a_venda_fica_amarrada_ao_turno_aberto() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 2)], 1000, 0)).unwrap();

        let sessao: String = connection
            .query_row("SELECT cash_session_id FROM sales WHERE client_sale_id = 'v-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sessao, "sessao-1");

        // E o resumo do caixa já enxerga o dinheiro que entrou.
        let resumo = crate::cash::resumo(&connection, "sessao-1").unwrap();
        assert_eq!(resumo.sales_count, 1);
        assert_eq!(resumo.cash_cents, 1000, "recebido menos troco");
    }

    #[test]
    fn rejects_sale_without_pdv_permission() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        let mut actor = operator();
        actor.permissions.clear();
        let result = finalize(&mut connection, &actor, input("v-1", vec![("p-agua", 1)], 500, 0));
        assert!(matches!(result, Err(AppError::Forbidden)));
    }

    #[test]
    fn rejects_insufficient_stock_and_rolls_everything_back() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        let result = finalize(
            &mut connection,
            &operator(),
            input("v-1", vec![("p-k7", 1), ("p-agua", 99)], 100_000, 0),
        );
        assert!(matches!(result, Err(AppError::Validation(_))));

        let k7_stock: i64 = connection
            .query_row("SELECT stock_quantity FROM products WHERE id = 'p-k7'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(k7_stock, 5);
        for table in ["sales", "sale_items", "stock_movements", "sync_outbox", "audit_events"] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0, "{table} should be empty after rollback");
        }
        let vendas: i64 = connection
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(vendas, 0);
    }

    #[test]
    fn aceita_pix_como_forma_de_pagamento() {
        let mut connection = db::open_in_memory().unwrap();
        seed(&connection);
        let venda = finalize(&mut connection, &operator(), FinalizeSaleInput {
            client_sale_id: "v-pix".into(),
            items: vec![SaleItemInput { product_id: "p-agua".into(), quantity: 2, credit: false }],
            cash_tendered_cents: 0,
            card_cents: 0,
            pix_cents: 1000,
            discount_cents: 0, discount_reason: String::new(), customer_name: String::new(), credit_customer: None,
        }).unwrap();
        assert_eq!(venda.total_cents, 1000);
        assert_eq!(venda.pix_cents, 1000);
        assert_eq!(venda.change_cents, 0);

        // O caixa contabiliza o PIX à parte do dinheiro da gaveta.
        let r = crate::cash::resumo(&connection, "sessao-1").unwrap();
        assert_eq!(r.pix_cents, 1000);
        assert_eq!(r.cash_cents, 0);
        assert_eq!(r.esperado_cents, 0, "PIX não entra na gaveta");
    }

    #[test]
    fn desconto_abate_do_total_e_exige_motivo() {
        let mut connection = db::open_in_memory().unwrap();
        seed(&connection);

        let mut com_permissao = operator();
        com_permissao.permissions.push("sale.discount".into());
        let venda = finalize(&mut connection, &com_permissao, FinalizeSaleInput {
            client_sale_id: "v-desc".into(),
            items: vec![SaleItemInput { product_id: "p-agua".into(), quantity: 4, credit: false }],
            cash_tendered_cents: 1800,
            card_cents: 0,
            pix_cents: 0,
            discount_cents: 200, discount_reason: "cliente fiel".into(), customer_name: String::new(), credit_customer: None,
        }).unwrap();
        assert_eq!(venda.subtotal_cents, 2000);
        assert_eq!(venda.discount_cents, 200);
        assert_eq!(venda.total_cents, 1800);
        assert_eq!(venda.change_cents, 0);

        // Sem motivo, o desconto é recusado.
        let negado = finalize(&mut connection, &operator(), FinalizeSaleInput {
            client_sale_id: "v-desc-2".into(),
            items: vec![SaleItemInput { product_id: "p-agua".into(), quantity: 1, credit: false }],
            cash_tendered_cents: 400,
            card_cents: 0,
            pix_cents: 0,
            discount_cents: 100, discount_reason: String::new(), customer_name: String::new(), credit_customer: None,
        });
        assert!(matches!(negado, Err(AppError::Validation(_))));
    }

    #[test]
    fn desconto_nao_pode_ser_maior_que_a_venda() {
        let mut connection = db::open_in_memory().unwrap();
        seed(&connection);
        let mut ator = operator();
        ator.permissions.push("sale.discount".into());
        let r = finalize(&mut connection, &ator, FinalizeSaleInput {
            client_sale_id: "v-1".into(),
            items: vec![SaleItemInput { product_id: "p-agua".into(), quantity: 1, credit: false }],
            cash_tendered_cents: 0,
            card_cents: 0,
            pix_cents: 0,
            discount_cents: 999_999, discount_reason: "teste".into(), customer_name: String::new(), credit_customer: None,
        });
        assert!(matches!(r, Err(AppError::Validation(_))));
    }

    #[test]
    fn rejects_insufficient_payment() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        let result = finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 2)], 400, 500));
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[test]
    fn ignores_prices_sent_by_the_frontend() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        // O input só carrega product_id e quantidade; o preço vem do banco.
        let sale = finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 2)], 1000, 0)).unwrap();
        assert_eq!(sale.total_cents, 1000);
        assert_eq!(sale.items[0].unit_price_cents, 500);
    }

    #[test]
    fn limits_pulseira_k7_to_one_per_sale() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        let result = finalize(&mut connection, &operator(), input("v-1", vec![("p-k7", 2)], 6000, 0));
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[test]
    fn is_idempotent_for_the_same_client_sale_id() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        let first = finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 1)], 500, 0)).unwrap();
        let second = finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 1)], 500, 0)).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.sale_number, second.sale_number);
        assert_eq!(second.items.len(), 1);

        let stock: i64 = connection
            .query_row("SELECT stock_quantity FROM products WHERE id = 'p-agua'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stock, 9, "a venda repetida não pode baixar estoque de novo");
    }

    #[test]
    fn rejects_inactive_or_unknown_product() {
        let mut connection = db::open_in_memory().expect("database should open");
        seed(&connection);
        connection
            .execute("UPDATE products SET active = 0 WHERE id = 'p-agua'", [])
            .unwrap();
        let result = finalize(&mut connection, &operator(), input("v-1", vec![("p-agua", 1)], 500, 0));
        assert!(matches!(result, Err(AppError::Validation(_))));
    }
}
