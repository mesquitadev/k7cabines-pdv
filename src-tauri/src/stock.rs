use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{AddStockInput, LocalUser, ProductBatch, RemoveStockInput, UpdateProductInput},
    products,
};

const MAX_QUANTITY: i64 = 100_000;

/// Regra do negócio: toda categoria exige controle de validade por lote,
/// exceto Pulseiras.
pub fn requires_expiry(category: &str) -> bool {
    !normalize(category).contains("pulseira")
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            other => other.to_ascii_lowercase(),
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn require_permission(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn validate_quantity(quantity: i64) -> AppResult<()> {
    if quantity <= 0 {
        return Err(AppError::Validation(
            "a quantidade deve ser maior que zero".into(),
        ));
    }
    if quantity > MAX_QUANTITY {
        return Err(AppError::Validation("quantidade fora da faixa".into()));
    }
    Ok(())
}

/// Aceita apenas datas ISO `AAAA-MM-DD`.
fn validate_expiry(date: &str) -> AppResult<String> {
    let trimmed = date.trim();
    chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("data de validade inválida".into()))?;
    Ok(trimmed.to_string())
}

pub(crate) fn audit(
    transaction: &Transaction<'_>,
    actor: &LocalUser,
    action: &str,
    entity_id: &str,
    payload: serde_json::Value,
    now: &str,
) -> AppResult<()> {
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, ?3, 'product', ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            action,
            entity_id,
            payload.to_string(),
            now
        ],
    )?;
    Ok(())
}

/// Motivo do movimento: a nota do operador quando existe, senão o código do
/// evento. Guardar "quebra na prateleira" vale mais no relatório que "stock.remove".
fn nota_ou(nota: Option<&str>, padrao: &str) -> String {
    match nota.map(str::trim) {
        Some(texto) if !texto.is_empty() => texto.chars().take(200).collect(),
        _ => padrao.to_string(),
    }
}

fn movement(
    transaction: &Transaction<'_>,
    actor: &LocalUser,
    product_id: &str,
    batch_id: Option<&str>,
    delta: i64,
    reason: &str,
    now: &str,
) -> AppResult<()> {
    movement_compra(transaction, actor, product_id, batch_id, delta, reason, now, None, None)
}

/// Movimento com a procedência da compra: custo pago e fornecedor.
#[allow(clippy::too_many_arguments)]
fn movement_compra(
    transaction: &Transaction<'_>,
    actor: &LocalUser,
    product_id: &str,
    batch_id: Option<&str>,
    delta: i64,
    reason: &str,
    now: &str,
    unit_cost_cents: Option<i64>,
    supplier_id: Option<&str>,
) -> AppResult<()> {
    transaction.execute(
        "INSERT INTO stock_movements (id, product_id, batch_id, delta, reason, reference_type,
                                      reference_id, actor_id, actor_name, occurred_at,
                                      unit_cost_cents, supplier_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 'manual', NULL, ?6, ?7, ?8, ?9, ?10)",
        params![
            Uuid::new_v4().to_string(),
            product_id,
            batch_id,
            delta,
            reason,
            actor.id,
            actor.full_name,
            now,
            unit_cost_cents,
            supplier_id
        ],
    )?;
    Ok(())
}

fn product_category(transaction: &Transaction<'_>, product_id: &str) -> AppResult<(String, String)> {
    transaction
        .query_row(
            "SELECT category, name FROM products WHERE id = ?1 AND active = 1",
            params![product_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)
}

pub fn list_batches(connection: &Connection) -> AppResult<Vec<ProductBatch>> {
    let mut statement = connection.prepare(
        "SELECT b.id, b.product_id, b.expiry_date, b.quantity
         FROM product_batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.quantity > 0 AND p.active = 1
         ORDER BY b.product_id, b.expiry_date",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(ProductBatch {
            id: row.get(0)?,
            product_id: row.get(1)?,
            expiry_date: row.get(2)?,
            quantity: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn update_product(
    connection: &mut Connection,
    actor: &LocalUser,
    input: UpdateProductInput,
) -> AppResult<crate::models::Product> {
    require_permission(actor, "stock.edit")?;
    let code = crate::identificacao::normaliza_sku(&input.code)?;
    let name = input.name.trim().to_string();
    let category = input.category.trim().to_string();
    if name.len() < 2 || category.is_empty() {
        return Err(AppError::Validation(
            "nome e categoria são obrigatórios".into(),
        ));
    }
    if input.price_cents < 0 || input.cost_cents < 0 {
        return Err(AppError::Validation(
            "preço e custo não podem ser negativos".into(),
        ));
    }
    if input.min_stock < 0 {
        return Err(AppError::Validation(
            "o estoque mínimo não pode ser negativo".into(),
        ));
    }
    let barcode = crate::identificacao::normaliza_gtin(input.barcode.as_deref())?;
    let unit = crate::identificacao::normaliza_unidade(&input.unit)?;
    let now = Utc::now().to_rfc3339();
    let (category, subcategory) = match input.category_id.as_deref() {
        Some(cid) => crate::categories::textos_de(connection, Some(cid))?,
        None => (
            category,
            input.subcategory.unwrap_or_default().trim().to_string(),
        ),
    };

    if let Some(pai) = input.parent_id.as_deref() {
        if pai == input.id {
            return Err(AppError::Validation(
                "um produto não pode ser variação de si mesmo".into(),
            ));
        }
        let avo: Option<String> = connection
            .query_row(
                "SELECT parent_id FROM products WHERE id = ?1",
                params![pai],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if avo.is_some() {
            return Err(AppError::Validation(
                "variação não pode ter variação: a hierarquia tem um nível só".into(),
            ));
        }
    }

    let transaction = connection.transaction()?;
    let changed = transaction
        .execute(
            "UPDATE products
             SET code = ?1, name = ?2, category = ?3, subcategory = ?4, price_cents = ?5,
                 cost_cents = ?6, barcode = ?7, min_stock = ?8, category_id = ?9,
                 parent_id = ?10, variant_name = ?11, unit = ?12, supplier_id = ?13,
                 highlight = ?16,
                 revision = revision + 1, updated_at = ?14
             WHERE id = ?15 AND active = 1",
            params![code, name, category, subcategory, input.price_cents, input.cost_cents,
                    barcode, input.min_stock, input.category_id, input.parent_id,
                    input.variant_name.trim(), unit, input.supplier_id, now, input.id,
                    input.highlight],
        )
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
                AppError::Conflict("já existe um produto com esse código ou código de barras".into())
            }
            other => AppError::Database(other),
        })?;
    if changed != 1 {
        return Err(AppError::NotFound);
    }
    audit(
        &transaction,
        actor,
        "product.update",
        &input.id,
        serde_json::json!({ "code": code, "name": name, "price_cents": input.price_cents }),
        &now,
    )?;
    transaction.commit()?;

    products::list(connection)?
        .into_iter()
        .find(|p| p.id == input.id)
        .ok_or(AppError::NotFound)
}

/// Exclusão lógica: o produto sai das listas mas o histórico de vendas continua íntegro.
pub fn delete_product(
    connection: &mut Connection,
    actor: &LocalUser,
    product_id: &str,
) -> AppResult<()> {
    require_permission(actor, "stock.delete")?;
    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;
    let changed = transaction.execute(
        "UPDATE products SET active = 0, revision = revision + 1, updated_at = ?1
         WHERE id = ?2 AND active = 1",
        params![now, product_id],
    )?;
    if changed != 1 {
        return Err(AppError::NotFound);
    }
    audit(
        &transaction,
        actor,
        "product.delete",
        product_id,
        serde_json::json!({ "soft_delete": true }),
        &now,
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn add_stock(
    connection: &mut Connection,
    actor: &LocalUser,
    input: AddStockInput,
) -> AppResult<()> {
    require_permission(actor, "stock.add")?;
    validate_quantity(input.quantity)?;
    let now = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;
    let (category, _) = product_category(&transaction, &input.product_id)?;

    let expiry = match input.expiry_date.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Some(validate_expiry(value)?),
        _ => None,
    };
    if requires_expiry(&category) && expiry.is_none() {
        return Err(AppError::Validation(
            "data de validade obrigatória para esta categoria".into(),
        ));
    }

    let mut batch_id: Option<String> = None;
    if let Some(ref date) = expiry {
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM product_batches WHERE product_id = ?1 AND expiry_date = ?2",
                params![input.product_id, date],
                |row| row.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => {
                transaction.execute(
                    "UPDATE product_batches
                     SET quantity = quantity + ?1, revision = revision + 1, updated_at = ?2
                     WHERE id = ?3",
                    params![input.quantity, now, id],
                )?;
                id
            }
            None => {
                let id = Uuid::new_v4().to_string();
                transaction.execute(
                    "INSERT INTO product_batches (id, product_id, expiry_date, quantity, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![id, input.product_id, date, input.quantity, now],
                )?;
                id
            }
        };
        batch_id = Some(id);
    }

    // Custo médio ponderado: o custo do produto passa a ser a média entre o que
    // já estava parado e o que acabou de entrar. Sobrescrever pelo custo da
    // última compra faria o relatório de margem mentir sobre o estoque antigo.
    if let Some(custo) = input.unit_cost_cents {
        if custo < 0 {
            return Err(AppError::Validation("o custo não pode ser negativo".into()));
        }
        let (saldo, custo_atual): (i64, i64) = transaction.query_row(
            "SELECT stock_quantity, cost_cents FROM products WHERE id = ?1",
            params![input.product_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let total = saldo + input.quantity;
        let medio = if total > 0 {
            (saldo * custo_atual + input.quantity * custo) / total
        } else {
            custo
        };
        transaction.execute(
            "UPDATE products SET cost_cents = ?1 WHERE id = ?2",
            params![medio, input.product_id],
        )?;
    }

    transaction.execute(
        "UPDATE products SET stock_quantity = stock_quantity + ?1, revision = revision + 1, updated_at = ?2
         WHERE id = ?3",
        params![input.quantity, now, input.product_id],
    )?;
    let motivo_entrada = nota_ou(input.note.as_deref(), "stock.add");
    movement_compra(
        &transaction,
        actor,
        &input.product_id,
        batch_id.as_deref(),
        input.quantity,
        &motivo_entrada,
        &now,
        input.unit_cost_cents,
        input.supplier_id.as_deref(),
    )?;
    audit(
        &transaction,
        actor,
        "stock.add",
        &input.product_id,
        serde_json::json!({ "quantity": input.quantity, "expiry_date": expiry }),
        &now,
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn remove_stock(
    connection: &mut Connection,
    actor: &LocalUser,
    input: RemoveStockInput,
) -> AppResult<()> {
    require_permission(actor, "stock.remove")?;
    validate_quantity(input.quantity)?;
    let now = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;
    product_category(&transaction, &input.product_id)?;

    let changed = transaction.execute(
        "UPDATE products SET stock_quantity = stock_quantity - ?1, revision = revision + 1, updated_at = ?2
         WHERE id = ?3 AND stock_quantity >= ?1",
        params![input.quantity, now, input.product_id],
    )?;
    if changed != 1 {
        return Err(AppError::Validation("estoque insuficiente".into()));
    }

    // Consome os lotes que vencem primeiro, igual à baixa por venda.
    let batches: Vec<(String, i64)> = {
        let mut statement = transaction.prepare(
            "SELECT id, quantity FROM product_batches
             WHERE product_id = ?1 AND quantity > 0
             ORDER BY expiry_date ASC, created_at ASC, id ASC",
        )?;
        let rows = statement.query_map(params![input.product_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut remaining = input.quantity;
    for (batch_id, available) in batches {
        if remaining <= 0 {
            break;
        }
        let take = available.min(remaining);
        transaction.execute(
            "UPDATE product_batches SET quantity = quantity - ?1, revision = revision + 1, updated_at = ?2
             WHERE id = ?3",
            params![take, now, batch_id],
        )?;
        movement(
            &transaction,
            actor,
            &input.product_id,
            Some(&batch_id),
            -take,
            "stock.remove.batch",
            &now,
        )?;
        remaining -= take;
    }

    movement(
        &transaction,
        actor,
        &input.product_id,
        None,
        -input.quantity,
        &nota_ou(input.note.as_deref(), "stock.remove"),
        &now,
    )?;
    audit(
        &transaction,
        actor,
        "stock.remove",
        &input.product_id,
        serde_json::json!({ "quantity": input.quantity }),
        &now,
    )?;
    transaction.commit()?;
    Ok(())
}

/// Descarta um lote inteiro (tipicamente vencido) e abate a quantidade do estoque.
pub fn delete_batch(
    connection: &mut Connection,
    actor: &LocalUser,
    batch_id: &str,
) -> AppResult<()> {
    require_permission(actor, "stock.remove")?;
    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;

    let (product_id, quantity): (String, i64) = transaction
        .query_row(
            "SELECT product_id, quantity FROM product_batches WHERE id = ?1",
            params![batch_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    transaction.execute(
        "UPDATE products SET stock_quantity = MAX(stock_quantity - ?1, 0), revision = revision + 1, updated_at = ?2
         WHERE id = ?3",
        params![quantity, now, product_id],
    )?;
    movement(
        &transaction,
        actor,
        &product_id,
        Some(batch_id),
        -quantity.max(1),
        "stock.batch.discard",
        &now,
    )?;
    transaction.execute(
        "UPDATE product_batches SET quantity = 0, revision = revision + 1, updated_at = ?1 WHERE id = ?2",
        params![now, batch_id],
    )?;
    audit(
        &transaction,
        actor,
        "stock.batch.discard",
        &product_id,
        serde_json::json!({ "batch_id": batch_id, "quantity": quantity }),
        &now,
    )?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn actor(permissions: &[&str]) -> LocalUser {
        LocalUser {
            id: "gerente-1".into(),
            username: "gerente".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: permissions.iter().map(|p| p.to_string()).collect(),
        must_change_password: false,
        }
    }

    fn full() -> LocalUser {
        actor(&[
            "stock.add",
            "stock.remove",
            "stock.edit",
            "stock.delete",
        ])
    }

    fn seed(connection: &Connection) {
        connection.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('gerente-1', 'gerente', 'x', 'Gerente', 'gerente', 1, 'now', 'now')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p-bebida', 'B1', 'Coca-cola', 'Bebidas', '', 700, 0, 1, 'now', 'now'),
                    ('p-k7', 'K7', 'Pulseira K7', 'Pulseiras', '', 3000, 0, 1, 'now', 'now')",
            [],
        ).unwrap();
    }

    fn stock_of(connection: &Connection, id: &str) -> i64 {
        connection
            .query_row(
                "SELECT stock_quantity FROM products WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn categoria_pulseira_e_a_unica_sem_validade_obrigatoria() {
        assert!(!requires_expiry("Pulseiras"));
        assert!(!requires_expiry("PULSEIRA K7"));
        assert!(requires_expiry("Bebidas"));
        assert!(requires_expiry("Produtos eróticos"));
    }

    #[test]
    fn adiciona_estoque_criando_e_reaproveitando_lote() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 10, expiry_date: Some("2027-01-01".into()), unit_cost_cents: None, note: None, supplier_id: None }).unwrap();
        add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 5, expiry_date: Some("2027-01-01".into()), unit_cost_cents: None, note: None, supplier_id: None }).unwrap();
        assert_eq!(stock_of(&c, "p-bebida"), 15);
        let lotes = list_batches(&c).unwrap();
        assert_eq!(lotes.len(), 1, "mesma validade deve somar no mesmo lote");
        assert_eq!(lotes[0].quantity, 15);
    }

    #[test]
    fn exige_validade_fora_de_pulseiras_e_dispensa_em_pulseiras() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        let sem_validade = add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 3, expiry_date: None, unit_cost_cents: None, note: None, supplier_id: None });
        assert!(matches!(sem_validade, Err(AppError::Validation(_))));

        add_stock(&mut c, &full(), AddStockInput { product_id: "p-k7".into(), quantity: 7, expiry_date: None, unit_cost_cents: None, note: None, supplier_id: None }).unwrap();
        assert_eq!(stock_of(&c, "p-k7"), 7);
        assert!(list_batches(&c).unwrap().is_empty());
    }

    #[test]
    fn rejeita_data_invalida_e_quantidade_invalida() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        assert!(matches!(
            add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 1, expiry_date: Some("31/12/2027".into()), unit_cost_cents: None, note: None, supplier_id: None }),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 0, expiry_date: Some("2027-01-01".into()), unit_cost_cents: None, note: None, supplier_id: None }),
            Err(AppError::Validation(_))
        ));
        assert_eq!(stock_of(&c, "p-bebida"), 0);
    }

    #[test]
    fn remove_estoque_consumindo_lotes_por_validade() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 4, expiry_date: Some("2027-06-01".into()), unit_cost_cents: None, note: None, supplier_id: None }).unwrap();
        add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 6, expiry_date: Some("2027-01-01".into()), unit_cost_cents: None, note: None, supplier_id: None }).unwrap();

        remove_stock(&mut c, &full(), RemoveStockInput { product_id: "p-bebida".into(), quantity: 8, note: None }).unwrap();
        assert_eq!(stock_of(&c, "p-bebida"), 2);

        let lotes = list_batches(&c).unwrap();
        assert_eq!(lotes.len(), 1, "o lote que vence primeiro deve zerar");
        assert_eq!(lotes[0].expiry_date, "2027-06-01");
        assert_eq!(lotes[0].quantity, 2);
    }

    #[test]
    fn nao_remove_alem_do_estoque() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 2, expiry_date: Some("2027-01-01".into()), unit_cost_cents: None, note: None, supplier_id: None }).unwrap();
        assert!(matches!(
            remove_stock(&mut c, &full(), RemoveStockInput { product_id: "p-bebida".into(), quantity: 5, note: None }),
            Err(AppError::Validation(_))
        ));
        assert_eq!(stock_of(&c, "p-bebida"), 2);
    }

    #[test]
    fn descarta_lote_vencido_abatendo_o_estoque() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        add_stock(&mut c, &full(), AddStockInput { product_id: "p-bebida".into(), quantity: 9, expiry_date: Some("2020-01-01".into()), unit_cost_cents: None, note: None, supplier_id: None }).unwrap();
        let lote = list_batches(&c).unwrap()[0].id.clone();
        delete_batch(&mut c, &full(), &lote).unwrap();
        assert_eq!(stock_of(&c, "p-bebida"), 0);
        assert!(list_batches(&c).unwrap().is_empty());
    }

    #[test]
    fn exclusao_de_produto_e_logica_e_preserva_historico() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        delete_product(&mut c, &full(), "p-bebida").unwrap();
        let restantes = products::list(&c).unwrap();
        assert_eq!(restantes.len(), 1);
        assert_eq!(restantes[0].id, "p-k7");
        let ainda_existe: i64 = c
            .query_row("SELECT COUNT(*) FROM products WHERE id = 'p-bebida'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ainda_existe, 1, "a linha continua no banco, apenas inativa");
    }

    #[test]
    fn edita_produto_e_rejeita_codigo_duplicado() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        let p = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-bebida".into(), code: "b9".into(), name: "Coca 600ml".into(),
            category: "Bebidas".into(), subcategory: None, price_cents: 800, cost_cents: 0, barcode: None, min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(), unit: String::new(), supplier_id: None,
        }).unwrap();
        assert_eq!(p.code, "B9");
        assert_eq!(p.price_cents, 800);

        let duplicado = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-k7".into(), code: "B9".into(), name: "Pulseira K7".into(),
            category: "Pulseiras".into(), subcategory: None, price_cents: 3000, cost_cents: 0, barcode: None, min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(), unit: String::new(), supplier_id: None,
        });
        assert!(matches!(duplicado, Err(AppError::Conflict(_))));
    }

    #[test]
    fn custo_codigo_de_barras_e_minimo_sao_gravados_e_devolvidos() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);

        let p = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-bebida".into(),
            code: "B1".into(),
            name: "Coca-cola".into(),
            category: "Bebidas".into(),
            subcategory: Some("Refrigerante".into()),
            price_cents: 700,
            cost_cents: 420,
            barcode: Some("7894900011517".into()),
            min_stock: 24,
            category_id: None,
            parent_id: None,
            variant_name: String::new(), unit: String::new(), supplier_id: None,
        }).unwrap();

        assert_eq!(p.cost_cents, 420, "custo grava e volta");
        assert_eq!(p.barcode.as_deref(), Some("7894900011517"));
        assert_eq!(p.min_stock, 24);

        // Código de barras em branco vira ausente, para o índice único aceitar
        // vários produtos sem EAN.
        let sem_ean = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-k7".into(), code: "K7".into(), name: "Pulseira K7".into(),
            category: "Pulseiras".into(), subcategory: None, price_cents: 3000,
            cost_cents: 0, barcode: Some("   ".into()), min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(), unit: String::new(), supplier_id: None,
        }).unwrap();
        assert_eq!(sem_ean.barcode, None);
    }

    #[test]
    fn entrada_com_custo_recalcula_a_media_ponderada() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        // Pulseira não exige validade, o que deixa o teste sobre o custo.
        add_stock(&mut c, &full(), AddStockInput {
            product_id: "p-k7".into(), quantity: 10, expiry_date: None,
            unit_cost_cents: Some(1000), note: None, supplier_id: None,
        }).unwrap();
        let custo: i64 = c.query_row("SELECT cost_cents FROM products WHERE id='p-k7'", [], |r| r.get(0)).unwrap();
        assert_eq!(custo, 1000, "primeira entrada define o custo");

        // 10 a R$ 10 mais 10 a R$ 20 dá média de R$ 15, não os R$ 20 da última compra.
        add_stock(&mut c, &full(), AddStockInput {
            product_id: "p-k7".into(), quantity: 10, expiry_date: None,
            unit_cost_cents: Some(2000), note: None, supplier_id: None,
        }).unwrap();
        let custo: i64 = c.query_row("SELECT cost_cents FROM products WHERE id='p-k7'", [], |r| r.get(0)).unwrap();
        assert_eq!(custo, 1500);
    }

    #[test]
    fn entrada_sem_custo_nao_mexe_no_custo_ja_gravado() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        add_stock(&mut c, &full(), AddStockInput {
            product_id: "p-k7".into(), quantity: 5, expiry_date: None,
            unit_cost_cents: Some(800), note: None, supplier_id: None,
        }).unwrap();
        add_stock(&mut c, &full(), AddStockInput {
            product_id: "p-k7".into(), quantity: 5, expiry_date: None,
            unit_cost_cents: None, note: None, supplier_id: None,
        }).unwrap();
        let custo: i64 = c.query_row("SELECT cost_cents FROM products WHERE id='p-k7'", [], |r| r.get(0)).unwrap();
        assert_eq!(custo, 800);
    }

    #[test]
    fn a_nota_do_operador_vira_o_motivo_do_movimento() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        add_stock(&mut c, &full(), AddStockInput {
            product_id: "p-k7".into(), quantity: 3, expiry_date: None,
            unit_cost_cents: None, note: Some("  NF 1234 fornecedor Alfa  ".into()), supplier_id: None,
        }).unwrap();
        let motivo: String = c.query_row(
            "SELECT reason FROM stock_movements WHERE product_id='p-k7' ORDER BY occurred_at DESC LIMIT 1",
            [], |r| r.get(0)).unwrap();
        assert_eq!(motivo, "NF 1234 fornecedor Alfa");

        remove_stock(&mut c, &full(), RemoveStockInput {
            product_id: "p-k7".into(), quantity: 1, note: Some("quebra na prateleira".into()),
        }).unwrap();
        let motivo: String = c.query_row(
            "SELECT reason FROM stock_movements WHERE product_id='p-k7' AND delta < 0 ORDER BY occurred_at DESC LIMIT 1",
            [], |r| r.get(0)).unwrap();
        assert_eq!(motivo, "quebra na prateleira");
    }

    #[test]
    fn codigo_de_barras_repetido_e_recusado() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-bebida".into(), code: "B1".into(), name: "Coca".into(),
            category: "Bebidas".into(), subcategory: None, price_cents: 700,
            cost_cents: 0, barcode: Some("0123456789012".into()), min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(), unit: String::new(), supplier_id: None,
        }).unwrap();

        let duplicado = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-k7".into(), code: "K7".into(), name: "Pulseira K7".into(),
            category: "Pulseiras".into(), subcategory: None, price_cents: 3000,
            cost_cents: 0, barcode: Some("0123456789012".into()), min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(), unit: String::new(), supplier_id: None,
        });
        assert!(matches!(duplicado, Err(AppError::Conflict(_))));
    }

    #[test]
    fn variacao_tem_um_nivel_so_e_nao_aponta_para_si_mesma() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);

        // p-k7 vira variação de p-bebida: um nível, permitido.
        let base = UpdateProductInput {
            highlight: false,
            id: "p-k7".into(), code: "K7".into(), name: "Pulseira K7".into(),
            category: "Pulseiras".into(), subcategory: None, price_cents: 3000,
            cost_cents: 0, barcode: None, min_stock: 0,
            category_id: None, parent_id: Some("p-bebida".into()),
            variant_name: "Unidade".into(), unit: String::new(), supplier_id: None,
        };
        update_product(&mut c, &full(), base).unwrap();

        // Variação de variação é recusada.
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p-x','X1','Outro','Bebidas','',100,0,1,'now','now')", []).unwrap();
        let neta = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-x".into(), code: "X1".into(), name: "Outro".into(),
            category: "Bebidas".into(), subcategory: None, price_cents: 100,
            cost_cents: 0, barcode: None, min_stock: 0,
            category_id: None, parent_id: Some("p-k7".into()), variant_name: "N".into(), unit: String::new(), supplier_id: None,
        });
        assert!(matches!(neta, Err(AppError::Validation(_))));

        // Ser variação de si mesmo também.
        let propria = update_product(&mut c, &full(), UpdateProductInput {
            highlight: false,
            id: "p-x".into(), code: "X1".into(), name: "Outro".into(),
            category: "Bebidas".into(), subcategory: None, price_cents: 100,
            cost_cents: 0, barcode: None, min_stock: 0,
            category_id: None, parent_id: Some("p-x".into()), variant_name: "N".into(), unit: String::new(), supplier_id: None,
        });
        assert!(matches!(propria, Err(AppError::Validation(_))));

        // O pai passa a contar suas variações.
        let pai = products::list(&c).unwrap().into_iter().find(|p| p.id == "p-bebida").unwrap();
        assert_eq!(pai.variant_count, 1);
    }

    #[test]
    fn cada_operacao_exige_a_sua_permissao() {
        let mut c = db::open_in_memory().unwrap();
        seed(&c);
        let sem = actor(&[]);
        assert!(matches!(add_stock(&mut c, &sem, AddStockInput { product_id: "p-k7".into(), quantity: 1, expiry_date: None, unit_cost_cents: None, note: None, supplier_id: None }), Err(AppError::Forbidden)));
        assert!(matches!(remove_stock(&mut c, &sem, RemoveStockInput { product_id: "p-k7".into(), quantity: 1, note: None }), Err(AppError::Forbidden)));
        assert!(matches!(delete_product(&mut c, &sem, "p-k7"), Err(AppError::Forbidden)));
        assert!(matches!(delete_batch(&mut c, &sem, "qualquer"), Err(AppError::Forbidden)));
        assert!(matches!(update_product(&mut c, &sem, UpdateProductInput {
            highlight: false,
            id: "p-k7".into(), code: "K7".into(), name: "Pulseira K7".into(),
            category: "Pulseiras".into(), subcategory: None, price_cents: 3000, cost_cents: 0, barcode: None, min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(), unit: String::new(), supplier_id: None,
        }), Err(AppError::Forbidden)));
    }
}
