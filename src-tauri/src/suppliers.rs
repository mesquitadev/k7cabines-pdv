//! Fornecedores e o histórico de compra por produto.
//!
//! O cadastro é magro de propósito: nome, documento, contato e observação. O
//! valor não está nos campos, está no vínculo — a entrada de estoque passa a
//! saber de quem veio e por quanto, o que transforma "custo médio subiu" em
//! "subiu com o fornecedor Alfa, na compra do dia 12".

use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{LocalUser, Supplier, SupplierInput, SupplierPurchase},
};

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Normaliza CNPJ ou CPF: só dígitos, com verificação do dígito verificador.
///
/// Vazio vira `None` porque muito distribuidor pequeno não emite nota, e exigir
/// documento faria o operador inventar um número para conseguir salvar.
pub fn normaliza_documento(bruto: Option<&str>) -> AppResult<Option<String>> {
    let Some(texto) = bruto else { return Ok(None) };
    let digitos: String = texto.chars().filter(char::is_ascii_digit).collect();
    if digitos.is_empty() {
        return Ok(None);
    }
    match digitos.len() {
        11 if cpf_valido(&digitos) => Ok(Some(digitos)),
        14 if cnpj_valido(&digitos) => Ok(Some(digitos)),
        11 | 14 => Err(AppError::Validation(
            "documento inválido: confira os números".into(),
        )),
        _ => Err(AppError::Validation(
            "documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ)".into(),
        )),
    }
}

/// Dígitos verificadores de CPF: dois módulos 11 com pesos decrescentes.
fn cpf_valido(d: &str) -> bool {
    let n: Vec<u32> = d.chars().filter_map(|c| c.to_digit(10)).collect();
    if n.iter().all(|x| *x == n[0]) {
        return false;
    }
    for (tamanho, peso_inicial) in [(9usize, 10u32), (10, 11)] {
        let soma: u32 = n[..tamanho]
            .iter()
            .enumerate()
            .map(|(i, v)| v * (peso_inicial - i as u32))
            .sum();
        let resto = soma % 11;
        let esperado = if resto < 2 { 0 } else { 11 - resto };
        if n[tamanho] != esperado {
            return false;
        }
    }
    true
}

/// Dígitos verificadores de CNPJ: pesos cíclicos de 2 a 9, da direita.
fn cnpj_valido(d: &str) -> bool {
    let n: Vec<u32> = d.chars().filter_map(|c| c.to_digit(10)).collect();
    if n.iter().all(|x| *x == n[0]) {
        return false;
    }
    for tamanho in [12usize, 13] {
        let soma: u32 = n[..tamanho]
            .iter()
            .rev()
            .enumerate()
            .map(|(i, v)| v * (2 + (i as u32 % 8)))
            .sum();
        let resto = soma % 11;
        let esperado = if resto < 2 { 0 } else { 11 - resto };
        if n[tamanho] != esperado {
            return false;
        }
    }
    true
}

pub fn listar(connection: &Connection, actor: &LocalUser) -> AppResult<Vec<Supplier>> {
    require(actor, "suppliers.view")?;
    let mut st = connection.prepare(
        "SELECT s.id, s.name, s.document, s.phone, s.email, s.notes, s.active,
                (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.active = 1),
                (SELECT MAX(m.occurred_at) FROM stock_movements m WHERE m.supplier_id = s.id)
         FROM suppliers s
         ORDER BY s.active DESC, s.name COLLATE NOCASE",
    )?;
    let linhas = st.query_map([], |row| {
        Ok(Supplier {
            id: row.get(0)?,
            name: row.get(1)?,
            document: row.get(2)?,
            phone: row.get(3)?,
            email: row.get(4)?,
            notes: row.get(5)?,
            active: row.get(6)?,
            product_count: row.get(7)?,
            last_purchase_at: row.get(8)?,
        })
    })?;
    linhas.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn validar(input: &SupplierInput) -> AppResult<(String, Option<String>)> {
    let nome = input.name.trim().to_string();
    if nome.chars().count() < 2 {
        return Err(AppError::Validation(
            "o nome do fornecedor precisa de pelo menos 2 caracteres".into(),
        ));
    }
    if nome.chars().count() > 120 {
        return Err(AppError::Validation(
            "o nome do fornecedor é longo demais".into(),
        ));
    }
    let documento = normaliza_documento(input.document.as_deref())?;
    let email = input.email.trim();
    if !email.is_empty() && (!email.contains('@') || email.len() > 160) {
        return Err(AppError::Validation("e-mail inválido".into()));
    }
    Ok((nome, documento))
}

fn conflito(erro: rusqlite::Error) -> AppError {
    match erro {
        rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
            AppError::Conflict("já existe um fornecedor com esse nome ou documento".into())
        }
        outro => AppError::Database(outro),
    }
}

pub fn criar(
    connection: &mut Connection,
    actor: &LocalUser,
    input: SupplierInput,
) -> AppResult<Supplier> {
    require(actor, "suppliers.manage")?;
    let (nome, documento) = validar(&input)?;
    let id = Uuid::new_v4().to_string();
    let agora = Utc::now().to_rfc3339();

    let tx = connection.transaction()?;
    tx.execute(
        "INSERT INTO suppliers (id, name, document, phone, email, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            nome,
            documento,
            input.phone.trim(),
            input.email.trim(),
            input.notes.trim(),
            agora
        ],
    )
    .map_err(conflito)?;
    crate::stock::audit(
        &tx,
        actor,
        "supplier.create",
        &id,
        serde_json::json!({ "name": nome }),
        &agora,
    )?;
    tx.commit()?;

    listar(connection, actor)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(AppError::NotFound)
}

pub fn atualizar(
    connection: &mut Connection,
    actor: &LocalUser,
    id: &str,
    input: SupplierInput,
) -> AppResult<Supplier> {
    require(actor, "suppliers.manage")?;
    let (nome, documento) = validar(&input)?;
    let agora = Utc::now().to_rfc3339();

    let tx = connection.transaction()?;
    let mudou = tx
        .execute(
            "UPDATE suppliers
             SET name = ?1, document = ?2, phone = ?3, email = ?4, notes = ?5,
                 revision = revision + 1, updated_at = ?6
             WHERE id = ?7",
            params![
                nome,
                documento,
                input.phone.trim(),
                input.email.trim(),
                input.notes.trim(),
                agora,
                id
            ],
        )
        .map_err(conflito)?;
    if mudou != 1 {
        return Err(AppError::NotFound);
    }
    crate::stock::audit(
        &tx,
        actor,
        "supplier.update",
        id,
        serde_json::json!({ "name": nome }),
        &agora,
    )?;
    tx.commit()?;

    listar(connection, actor)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(AppError::NotFound)
}

/// Desativa. Nunca apaga: o histórico de compra aponta para o fornecedor, e
/// apagar transformaria a procedência do custo em nada.
pub fn desativar(connection: &mut Connection, actor: &LocalUser, id: &str) -> AppResult<()> {
    require(actor, "suppliers.manage")?;
    let agora = Utc::now().to_rfc3339();

    let tx = connection.transaction()?;
    let em_uso: i64 = tx.query_row(
        "SELECT COUNT(*) FROM products WHERE supplier_id = ?1 AND active = 1",
        params![id],
        |row| row.get(0),
    )?;
    if em_uso > 0 {
        return Err(AppError::Validation(format!(
            "{em_uso} produto(s) ainda apontam para este fornecedor; troque o fornecedor deles primeiro"
        )));
    }
    let mudou = tx.execute(
        "UPDATE suppliers SET active = 0, revision = revision + 1, updated_at = ?1 WHERE id = ?2",
        params![agora, id],
    )?;
    if mudou != 1 {
        return Err(AppError::NotFound);
    }
    crate::stock::audit(
        &tx,
        actor,
        "supplier.deactivate",
        id,
        serde_json::json!({}),
        &agora,
    )?;
    tx.commit()?;
    Ok(())
}

/// Reativa um fornecedor desativado. Voltar a comprar de quem já se comprou é
/// rotina; obrigar a recadastrar criaria duas fichas para a mesma empresa.
pub fn reativar(connection: &mut Connection, actor: &LocalUser, id: &str) -> AppResult<()> {
    require(actor, "suppliers.manage")?;
    let agora = Utc::now().to_rfc3339();
    let tx = connection.transaction()?;
    let mudou = tx.execute(
        "UPDATE suppliers SET active = 1, revision = revision + 1, updated_at = ?1 WHERE id = ?2",
        params![agora, id],
    )?;
    if mudou != 1 {
        return Err(AppError::NotFound);
    }
    crate::stock::audit(
        &tx,
        actor,
        "supplier.reactivate",
        id,
        serde_json::json!({}),
        &agora,
    )?;
    tx.commit()?;
    Ok(())
}

/// Histórico de compras de um fornecedor: o que entrou, quando e por quanto.
pub fn compras(
    connection: &Connection,
    actor: &LocalUser,
    supplier_id: &str,
    limite: i64,
) -> AppResult<Vec<SupplierPurchase>> {
    require(actor, "suppliers.view")?;
    let mut st = connection.prepare(
        "SELECT m.occurred_at, p.name, p.variant_name, m.delta, m.unit_cost_cents,
                m.reason, m.actor_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.supplier_id = ?1 AND m.delta > 0
         ORDER BY m.occurred_at DESC
         LIMIT ?2",
    )?;
    let linhas = st.query_map(params![supplier_id, limite.clamp(1, 500)], |row| {
        Ok(SupplierPurchase {
            occurred_at: row.get(0)?,
            product_name: row.get(1)?,
            variant_name: row.get(2)?,
            quantity: row.get(3)?,
            unit_cost_cents: row.get(4)?,
            reason: row.get(5)?,
            actor_name: row.get(6)?,
        })
    })?;
    linhas.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn ator(permissoes: &[&str]) -> LocalUser {
        LocalUser {
            id: "u1".into(),
            username: "teste".into(),
            full_name: "Teste".into(),
            role: "gerente".into(),
            whatsapp: None,
            permissions: permissoes.iter().map(|p| p.to_string()).collect(),
            must_change_password: false,
        }
    }

    /// A auditoria referencia `users(id)`; sem a conta o INSERT viola a FK.
    fn com_usuario() -> Connection {
        let c = db::open_in_memory().unwrap();
        let agora = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at)
             VALUES ('u1', 'teste', 'x', 'Teste', 'gerente', ?1, ?1)",
            params![agora],
        )
        .unwrap();
        c
    }

    fn entrada(nome: &str) -> SupplierInput {
        SupplierInput {
            name: nome.into(),
            document: None,
            phone: String::new(),
            email: String::new(),
            notes: String::new(),
        }
    }

    #[test]
    fn cnpj_e_cpf_validos_passam_e_invalidos_sao_recusados() {
        // CNPJ e CPF com dígito verificador correto.
        assert_eq!(
            normaliza_documento(Some("11.222.333/0001-81")).unwrap().as_deref(),
            Some("11222333000181")
        );
        assert_eq!(
            normaliza_documento(Some("529.982.247-25")).unwrap().as_deref(),
            Some("52998224725")
        );
        // Último dígito trocado.
        assert!(normaliza_documento(Some("11222333000182")).is_err());
        assert!(normaliza_documento(Some("52998224726")).is_err());
        // Todos iguais nunca é documento real, mesmo fechando a conta.
        assert!(normaliza_documento(Some("11111111111")).is_err());
        // Comprimento fora de 11 e 14.
        assert!(normaliza_documento(Some("123")).is_err());
        // Vazio é ausência, não erro.
        assert_eq!(normaliza_documento(Some("  ")).unwrap(), None);
        assert_eq!(normaliza_documento(None).unwrap(), None);
    }

    #[test]
    fn criar_exige_permissao_de_gestao() {
        let mut c = db::open_in_memory().unwrap();
        let so_leitura = ator(&["suppliers.view"]);
        assert!(matches!(
            criar(&mut c, &so_leitura, entrada("Alfa")),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn listar_exige_permissao_de_leitura() {
        let c = db::open_in_memory().unwrap();
        assert!(matches!(listar(&c, &ator(&[])), Err(AppError::Forbidden)));
    }

    #[test]
    fn nome_repetido_e_recusado_como_conflito() {
        let mut c = com_usuario();
        let a = ator(&["suppliers.view", "suppliers.manage"]);
        criar(&mut c, &a, entrada("Distribuidora Alfa")).unwrap();
        // O índice é COLLATE NOCASE: caixa diferente é o mesmo fornecedor.
        assert!(matches!(
            criar(&mut c, &a, entrada("distribuidora alfa")),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn nome_curto_e_email_invalido_sao_recusados() {
        let mut c = com_usuario();
        let a = ator(&["suppliers.view", "suppliers.manage"]);
        assert!(criar(&mut c, &a, entrada("A")).is_err());
        let mut com_email = entrada("Beta");
        com_email.email = "sem-arroba".into();
        assert!(criar(&mut c, &a, com_email).is_err());
    }

    #[test]
    fn desativar_e_recusado_enquanto_houver_produto_apontando() {
        let mut c = com_usuario();
        let a = ator(&["suppliers.view", "suppliers.manage"]);
        let f = criar(&mut c, &a, entrada("Alfa")).unwrap();
        let agora = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO products (id, code, name, category, price_cents, supplier_id, created_at, updated_at)
             VALUES ('p1', 'P1', 'Gel', 'Eróticos', 1000, ?1, ?2, ?2)",
            params![f.id, agora],
        )
        .unwrap();

        assert!(matches!(
            desativar(&mut c, &a, &f.id),
            Err(AppError::Validation(_))
        ));

        c.execute("UPDATE products SET supplier_id = NULL WHERE id = 'p1'", [])
            .unwrap();
        desativar(&mut c, &a, &f.id).unwrap();
        let ativo: i64 = c
            .query_row("SELECT active FROM suppliers WHERE id = ?1", params![f.id], |r| r.get(0))
            .unwrap();
        assert_eq!(ativo, 0);

        reativar(&mut c, &a, &f.id).unwrap();
        let ativo: i64 = c
            .query_row("SELECT active FROM suppliers WHERE id = ?1", params![f.id], |r| r.get(0))
            .unwrap();
        assert_eq!(ativo, 1);
    }
}
