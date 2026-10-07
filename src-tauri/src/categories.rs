use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Category, CategoryInput, LocalUser},
};

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

pub fn listar(connection: &Connection) -> AppResult<Vec<Category>> {
    let mut st = connection.prepare(
        "SELECT c.id, c.name, c.parent_id, c.color, c.sort_order, c.active,
                (SELECT COUNT(*) FROM products p
                  WHERE p.category_id = c.id AND p.active = 1),
                c.highlight
         FROM categories c
         ORDER BY COALESCE((SELECT pai.sort_order FROM categories pai WHERE pai.id = c.parent_id),
                           c.sort_order),
                  c.parent_id IS NOT NULL, c.sort_order, c.name COLLATE NOCASE",
    )?;
    let linhas = st.query_map([], |row| {
        Ok(Category {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            color: row.get(3)?,
            sort_order: row.get(4)?,
            active: row.get(5)?,
            product_count: row.get(6)?,
            highlight: row.get(7)?,
        })
    })?;
    linhas.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn validar(input: &CategoryInput) -> AppResult<String> {
    let nome = input.name.trim().to_string();
    if nome.chars().count() < 2 {
        return Err(AppError::Validation(
            "o nome da categoria precisa de ao menos 2 letras".into(),
        ));
    }
    if nome.chars().count() > 60 {
        return Err(AppError::Validation("nome longo demais".into()));
    }
    Ok(nome)
}

pub fn criar(
    connection: &mut Connection,
    actor: &LocalUser,
    input: CategoryInput,
) -> AppResult<Category> {
    require(actor, "stock.create")?;
    let nome = validar(&input)?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    connection
        .execute(
            "INSERT INTO categories (id, name, parent_id, color, sort_order, active, highlight, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?7, ?6, ?6)",
            params![id, nome, input.parent_id, input.color, input.sort_order, now, input.highlight],
        )
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
                AppError::Conflict("já existe uma categoria com esse nome".into())
            }
            other => AppError::Database(other),
        })?;

    listar(connection)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(AppError::NotFound)
}

/// Renomear corrige o nome em todos os produtos de uma vez: o texto no produto
/// é só cópia para o histórico, a verdade é a categoria.
pub fn atualizar(
    connection: &mut Connection,
    actor: &LocalUser,
    id: &str,
    input: CategoryInput,
) -> AppResult<Category> {
    require(actor, "stock.edit")?;
    let nome = validar(&input)?;
    let now = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;
    let mudou = transaction
        .execute(
            "UPDATE categories SET name = ?1, color = ?2, sort_order = ?3, highlight = ?6, updated_at = ?4
             WHERE id = ?5",
            params![nome, input.color, input.sort_order, now, id, input.highlight],
        )
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
                AppError::Conflict("já existe uma categoria com esse nome".into())
            }
            other => AppError::Database(other),
        })?;
    if mudou != 1 {
        return Err(AppError::NotFound);
    }

    let e_raiz: bool = transaction.query_row(
        "SELECT parent_id IS NULL FROM categories WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if e_raiz {
        transaction.execute(
            "UPDATE products SET category = ?1, updated_at = ?2 WHERE category_id = ?3",
            params![nome, now, id],
        )?;
    } else {
        transaction.execute(
            "UPDATE products SET subcategory = ?1, updated_at = ?2
             WHERE category_id = ?3",
            params![nome, now, id],
        )?;
    }
    transaction.commit()?;

    listar(connection)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(AppError::NotFound)
}

/// Desativar em vez de excluir: categoria some das listas mas o histórico
/// de vendas continua íntegro.
/// Apaga a categoria de vez.
///
/// Só sai quando ninguém aponta para ela — nem produto ativo, nem inativo, nem
/// subcategoria. Produto inativo conta porque ele guarda `category_id` e ainda
/// aparece no histórico: apagar deixaria uma referência morta e o relatório
/// antigo sem o nome da categoria.
///
/// Quando há vínculo, a saída é `desativar`, que tira do caminho sem quebrar o
/// passado.
pub fn excluir(connection: &mut Connection, actor: &LocalUser, id: &str) -> AppResult<()> {
    require(actor, "stock.delete")?;

    let produtos: i64 = connection.query_row(
        "SELECT COUNT(*) FROM products WHERE category_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if produtos > 0 {
        return Err(AppError::Validation(format!(
            "{produtos} produto(s) usam esta categoria, contando os já excluídos; \
             mova-os para outra categoria ou apenas desative esta"
        )));
    }
    let filhas: i64 = connection.query_row(
        "SELECT COUNT(*) FROM categories WHERE parent_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if filhas > 0 {
        return Err(AppError::Validation(
            "exclua as subcategorias antes desta".into(),
        ));
    }

    let agora = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;
    let nome: String = transaction
        .query_row(
            "SELECT name FROM categories WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    transaction.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
    crate::stock::audit(
        &transaction,
        actor,
        "category.delete",
        id,
        serde_json::json!({ "name": nome }),
        &agora,
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn desativar(connection: &mut Connection, actor: &LocalUser, id: &str) -> AppResult<()> {
    require(actor, "stock.delete")?;

    let em_uso: i64 = connection.query_row(
        "SELECT COUNT(*) FROM products WHERE category_id = ?1 AND active = 1",
        params![id],
        |row| row.get(0),
    )?;
    if em_uso > 0 {
        return Err(AppError::Validation(format!(
            "{em_uso} produto(s) ativo(s) usam esta categoria; mova-os antes de desativá-la"
        )));
    }
    let filhas: i64 = connection.query_row(
        "SELECT COUNT(*) FROM categories WHERE parent_id = ?1 AND active = 1",
        params![id],
        |row| row.get(0),
    )?;
    if filhas > 0 {
        return Err(AppError::Validation(
            "desative as subcategorias antes desta".into(),
        ));
    }

    let mudou = connection.execute(
        "UPDATE categories SET active = 0, updated_at = ?1 WHERE id = ?2",
        params![Utc::now().to_rfc3339(), id],
    )?;
    if mudou != 1 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Categoria pela qual um produto deve ser gravado, devolvendo os textos
/// desnormalizados que o cupom e o histórico usam.
pub fn textos_de(
    connection: &Connection,
    category_id: Option<&str>,
) -> AppResult<(String, String)> {
    let Some(id) = category_id else {
        return Ok((String::new(), String::new()));
    };
    let linha: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT name, parent_id FROM categories WHERE id = ?1 AND active = 1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((nome, pai)) = linha else {
        return Err(AppError::Validation("categoria inválida".into()));
    };
    match pai {
        None => Ok((nome, String::new())),
        Some(pai_id) => {
            let nome_pai: String = connection.query_row(
                "SELECT name FROM categories WHERE id = ?1",
                params![pai_id],
                |row| row.get(0),
            )?;
            Ok((nome_pai, nome))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn gerente() -> LocalUser {
        LocalUser {
            id: "g1".into(),
            username: "g".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "master".into(),
            permissions: vec![
                "stock.create".into(),
                "stock.edit".into(),
                "stock.delete".into(),
            ],
            must_change_password: false,
        }
    }

    fn base() -> Connection {
        db::open_in_memory().unwrap()
    }

    fn entrada(nome: &str, pai: Option<String>) -> CategoryInput {
        CategoryInput {
            highlight: false,
            name: nome.into(),
            parent_id: pai,
            color: "var(--linha-outro)".into(),
            sort_order: 10,
        }
    }

    #[test]
    fn cria_categoria_e_subcategoria_e_recusa_nome_repetido() {
        let mut c = base();
        let bebidas = criar(&mut c, &gerente(), entrada("Bebidas", None)).unwrap();
        criar(&mut c, &gerente(), entrada("Brahma", Some(bebidas.id.clone()))).unwrap();

        let repetida = criar(&mut c, &gerente(), entrada("Bebidas", None));
        assert!(matches!(repetida, Err(AppError::Conflict(_))));

        // O mesmo nome pode existir sob pais diferentes.
        let eroticos = criar(&mut c, &gerente(), entrada("Produtos eróticos", None)).unwrap();
        criar(&mut c, &gerente(), entrada("Brahma", Some(eroticos.id))).unwrap();

        assert_eq!(listar(&c).unwrap().len(), 4);
    }

    #[test]
    fn renomear_corrige_o_texto_em_todos_os_produtos() {
        let mut c = base();
        let cat = criar(&mut c, &gerente(), entrada("Bebida", None)).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity,
                                   active, category_id, created_at, updated_at)
             VALUES ('p1','B1','Coca','Bebida','',700,5,1,?1,'now','now')",
            params![cat.id],
        ).unwrap();

        atualizar(&mut c, &gerente(), &cat.id, entrada("Bebidas", None)).unwrap();

        let texto: String = c
            .query_row("SELECT category FROM products WHERE id='p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(texto, "Bebidas", "o produto acompanha a renomeação");
    }

    #[test]
    fn nao_desativa_categoria_em_uso() {
        let mut c = base();
        let cat = criar(&mut c, &gerente(), entrada("Bebidas", None)).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity,
                                   active, category_id, created_at, updated_at)
             VALUES ('p1','B1','Coca','Bebidas','',700,5,1,?1,'now','now')",
            params![cat.id],
        ).unwrap();

        let r = desativar(&mut c, &gerente(), &cat.id);
        assert!(matches!(r, Err(AppError::Validation(_))));

        c.execute("UPDATE products SET active = 0 WHERE id='p1'", []).unwrap();
        desativar(&mut c, &gerente(), &cat.id).unwrap();
    }

    #[test]
    fn textos_desnormalizados_saem_certos() {
        let mut c = base();
        let bebidas = criar(&mut c, &gerente(), entrada("Bebidas", None)).unwrap();
        let brahma = criar(&mut c, &gerente(), entrada("Brahma", Some(bebidas.id.clone()))).unwrap();

        assert_eq!(textos_de(&c, Some(&bebidas.id)).unwrap(), ("Bebidas".into(), "".into()));
        assert_eq!(textos_de(&c, Some(&brahma.id)).unwrap(), ("Bebidas".into(), "Brahma".into()));
    }

    #[test]
    fn exige_permissao() {
        let mut c = base();
        let mut sem = gerente();
        sem.permissions.clear();
        assert!(matches!(
            criar(&mut c, &sem, entrada("X", None)),
            Err(AppError::Forbidden)
        ));
    }
}
