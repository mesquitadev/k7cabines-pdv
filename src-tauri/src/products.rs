use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{CreateProductInput, LocalUser, Product},
};

pub fn list(connection: &Connection) -> AppResult<Vec<Product>> {
    let mut statement = connection.prepare(
        "SELECT p.id, p.code, p.name, p.category, p.subcategory, p.price_cents, p.cost_cents,
                p.barcode, p.min_stock, p.stock_quantity, p.active, p.created_at, p.updated_at,
                p.category_id, p.parent_id, p.variant_name,
                (SELECT COUNT(*) FROM products v WHERE v.parent_id = p.id AND v.active = 1),
                p.unit, p.supplier_id, f.name,
                (SELECT m.occurred_at FROM stock_movements m
                  WHERE m.product_id = p.id AND m.delta > 0 AND m.unit_cost_cents IS NOT NULL
                  ORDER BY m.occurred_at DESC LIMIT 1),
                (SELECT m.unit_cost_cents FROM stock_movements m
                  WHERE m.product_id = p.id AND m.delta > 0 AND m.unit_cost_cents IS NOT NULL
                  ORDER BY m.occurred_at DESC LIMIT 1),
                p.highlight,
                (p.highlight = 1
                  OR EXISTS (SELECT 1 FROM categories c
                              WHERE c.highlight = 1
                                AND (c.id = p.category_id
                                     OR (p.category_id IS NULL AND c.parent_id IS NULL
                                         AND lower(c.name) = lower(p.category)))))
         FROM products p
         LEFT JOIN suppliers f ON f.id = p.supplier_id
         WHERE p.active = 1
         ORDER BY p.name COLLATE NOCASE, p.variant_name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Product {
            id: row.get(0)?,
            code: row.get(1)?,
            name: row.get(2)?,
            category: row.get(3)?,
            subcategory: row.get(4)?,
            price_cents: row.get(5)?,
            cost_cents: row.get(6)?,
            barcode: row.get(7)?,
            min_stock: row.get(8)?,
            stock_quantity: row.get(9)?,
            active: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
            category_id: row.get(13)?,
            parent_id: row.get(14)?,
            variant_name: row.get(15)?,
            variant_count: row.get(16)?,
            unit: row.get(17)?,
            supplier_id: row.get(18)?,
            supplier_name: row.get(19)?,
            last_purchase_at: row.get(20)?,
            last_purchase_cents: row.get(21)?,
            highlight: row.get(22)?,
            highlight_effective: row.get(23)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn create(
    connection: &mut Connection,
    actor: &LocalUser,
    input: CreateProductInput,
) -> AppResult<Product> {
    require_permission(actor, "stock.create")?;
    let code = crate::identificacao::normaliza_sku(&input.code)?;
    let name = input.name.trim();
    let category = input.category.trim();
    if name.len() < 2 || category.is_empty() {
        return Err(AppError::Validation(
            "nome e categoria são obrigatórios".into(),
        ));
    }
    let unit = crate::identificacao::normaliza_unidade(&input.unit)?;
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
    // Vazio vira NULL: o índice único recusa duas strings vazias, mas aceita
    // vários NULL. A validação do dígito verificador vive em `identificacao`.
    let barcode = crate::identificacao::normaliza_gtin(input.barcode.as_deref())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    // A categoria é a fonte; o texto no produto é cópia para o histórico.
    let (category, subcategory) = match input.category_id.as_deref() {
        Some(cid) => crate::categories::textos_de(connection, Some(cid))?,
        None => (
            category.to_string(),
            input.subcategory.unwrap_or_default().trim().to_string(),
        ),
    };
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents,
                               barcode, min_stock, stock_quantity, active, category_id, parent_id,
                               variant_name, unit, supplier_id, highlight, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 1, ?10, ?11, ?12, ?13, ?14, ?16, ?15, ?15)",
        params![id, code, name, category, subcategory, input.price_cents, input.cost_cents,
                barcode, input.min_stock, input.category_id, input.parent_id,
                input.variant_name.trim(), unit, input.supplier_id, now, input.highlight],
    ).map_err(|error| match error {
        rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
            AppError::Conflict("já existe um produto com esse código ou código de barras".into())
        }
        other => AppError::Database(other),
    })?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'product.create', 'product', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            id,
            serde_json::json!({"code": code, "name": name, "price_cents": input.price_cents}).to_string(),
            now
        ],
    )?;
    transaction.commit()?;
    get(connection, &id)?.ok_or(AppError::NotFound)
}

fn get(connection: &Connection, id: &str) -> AppResult<Option<Product>> {
    Ok(list(connection)?
        .into_iter()
        .find(|product| product.id == id))
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

    fn manager() -> LocalUser {
        LocalUser {
            id: "manager-1".into(),
            username: "manager".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["stock.create".into()],
        must_change_password: false,
        }
    }

    #[test]
    fn creates_product_with_money_in_cents_and_unique_code() {
        let mut connection = db::open_in_memory().expect("database should open");
        connection
            .execute(
                "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
                 VALUES ('manager-1', 'manager', 'test-only', 'Gerente', 'gerente', 1, 'now', 'now')",
                [],
            )
            .expect("actor should exist");
        let input = CreateProductInput {
            highlight: false,
            code: "abc-1".into(),
            name: "Produto".into(),
            category: "Categoria".into(),
            subcategory: None,
            price_cents: 1290,
            cost_cents: 0,
            barcode: None,
            unit: "UN".into(),
            supplier_id: None,
            min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(),
        };
        let product =
            create(&mut connection, &manager(), input).expect("product should be created");
        assert_eq!(product.code, "ABC-1");
        assert_eq!(product.price_cents, 1290);
        assert_eq!(product.stock_quantity, 0);

        let duplicate = create(
            &mut connection,
            &manager(),
            CreateProductInput {
                highlight: false,
                code: "ABC-1".into(),
                name: "Outro".into(),
                category: "Categoria".into(),
                subcategory: None,
                price_cents: 100,
                cost_cents: 0,
                barcode: None,
            unit: "UN".into(),
            supplier_id: None,
                min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(),
            },
        );
        assert!(matches!(duplicate, Err(AppError::Conflict(_))));
    }

    #[test]
    fn rejects_product_creation_without_permission() {
        let mut connection = db::open_in_memory().expect("database should open");
        let mut actor = manager();
        actor.permissions.clear();
        let result = create(
            &mut connection,
            &actor,
            CreateProductInput {
                highlight: false,
                code: "ABC-2".into(),
                name: "Produto".into(),
                category: "Categoria".into(),
                subcategory: None,
                price_cents: 100,
                cost_cents: 0,
                barcode: None,
            unit: "UN".into(),
            supplier_id: None,
                min_stock: 0, category_id: None, parent_id: None, variant_name: String::new(),
            },
        );
        assert!(matches!(result, Err(AppError::Forbidden)));
    }
}
