use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::LocalUser,
};


pub fn touch_last_login(connection: &Connection, user_id: &str) -> AppResult<()> {
    connection.execute(
        "UPDATE users SET last_login_at = ?1 WHERE id = ?2",
        params![Utc::now().to_rfc3339(), user_id],
    )?;
    Ok(())
}


/// Primeira execução: cria a conta master permanente do sistema.
///
/// O nome de usuário é fixo (`master`) de propósito — a conta pertence à
/// instalação, não a uma pessoa. Quem opera cria a própria conta nominal
/// depois, por dentro do sistema.
pub const MASTER_USERNAME: &str = "master";
pub const MASTER_FULL_NAME: &str = "Master do Sistema";


/// Autenticação por nome de usuário. A mensagem de erro é a mesma para conta
/// inexistente e senha errada, para não revelar quais contas existem.
pub fn authenticate(
    connection: &Connection,
    username: &str,
    password: &str,
) -> AppResult<LocalUser> {
    let username = normalize_username(username);
    let record = connection
        .query_row(
            "SELECT id, password_hash FROM users WHERE username = ?1 AND active = 1",
            [&username],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((id, hash)) = record else {
        // Verifica um hash descartável mesmo sem usuário, para que o tempo de
        // resposta não denuncie a existência da conta.
        let _ = hash_password(password);
        return Err(AppError::Unauthorized);
    };
    let parsed = PasswordHash::new(&hash).map_err(|_| AppError::PasswordHash)?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| AppError::Unauthorized)?;
    load_user(connection, &id)?.ok_or(AppError::Unauthorized)
}

/// Troca da própria senha. É o caminho obrigatório de quem entra com senha
/// provisória definida pelo master.
pub fn change_own_password(
    connection: &mut Connection,
    user_id: &str,
    senha_atual: &str,
    nova_senha: &str,
) -> AppResult<()> {
    validate_password(nova_senha)?;
    if senha_atual == nova_senha {
        return Err(AppError::Validation(
            "a nova senha precisa ser diferente da atual".into(),
        ));
    }
    let hash: String = connection
        .query_row(
            "SELECT password_hash FROM users WHERE id = ?1 AND active = 1",
            [user_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AppError::Unauthorized)?;
    let parsed = PasswordHash::new(&hash).map_err(|_| AppError::PasswordHash)?;
    Argon2::default()
        .verify_password(senha_atual.as_bytes(), &parsed)
        .map_err(|_| AppError::Unauthorized)?;

    let novo_hash = hash_password(nova_senha)?;
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE users SET password_hash = ?1, must_change_password = 0, updated_at = ?2
         WHERE id = ?3",
        params![novo_hash, now, user_id],
    )?;
    // A senha nunca entra na auditoria, só o fato da troca.
    connection.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, occurred_at)
         VALUES (?1, ?2, 'user.password_changed', 'user', ?2, ?3)",
        params![Uuid::new_v4().to_string(), user_id, now],
    )?;
    Ok(())
}

pub fn load_user(connection: &Connection, user_id: &str) -> AppResult<Option<LocalUser>> {
    let base = connection
        .query_row(
            "SELECT id, username, full_name, whatsapp, role, must_change_password
             FROM users WHERE id = ?1 AND active = 1",
            [user_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((id, username, full_name, whatsapp, role, must_change_password)) = base else {
        return Ok(None);
    };
    // Permissão efetiva = as do papel, mais as exceções concedidas ao usuário.
    // O master carrega o catálogo inteiro por definição: é o que impede o
    // sistema de ficar sem ninguém capaz de administrá-lo.
    let e_master: bool = connection
        .query_row(
            "SELECT is_master FROM roles WHERE key = ?1",
            [&role],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false);

    let permissions = if e_master {
        let mut statement = connection.prepare("SELECT key FROM permissions ORDER BY key")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    } else {
        let mut statement = connection.prepare(
            "SELECT permission FROM role_permissions WHERE role_key = ?1
             UNION
             SELECT permission FROM user_permissions WHERE user_id = ?2
             ORDER BY 1",
        )?;
        let rows = statement.query_map(params![role, id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    Ok(Some(LocalUser {
        id,
        username,
        full_name,
        whatsapp,
        role,
        permissions,
        must_change_password,
    }))
}


/// Regra única de senha do sistema, usada na criação, na troca e no reset.
pub fn validate_password(password: &str) -> AppResult<()> {
    if password.chars().count() < 8 {
        return Err(AppError::Validation(
            "a senha deve possuir ao menos 8 caracteres".into(),
        ));
    }
    if password.chars().count() > 128 {
        return Err(AppError::Validation("senha longa demais".into()));
    }
    Ok(())
}

pub fn normalize_username(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| AppError::PasswordHash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn login_nao_revela_se_a_conta_existe() {
        let connection = db::open_in_memory().expect("database should open");
        let r = authenticate(&connection, "nao-existe", "qualquer-coisa");
        assert!(matches!(r, Err(AppError::Unauthorized)));
    }


    #[test]
    fn autentica_senha_correta_e_recusa_a_errada() {
        let mut connection = db::open_in_memory().expect("database should open");
        let user = crate::setup::complete(
            &mut connection,
            crate::models::SetupInput {
                store_name: "Loja Teste".into(),
                store_city: "Rio de Janeiro".into(),
                master_password: "senha-segura-123".into(),
            },
            "0.1.0",
        )
        .expect("setup should work");

        assert!(authenticate(&connection, &user.username, "senha-segura-123").is_ok());
        assert!(matches!(
            authenticate(&connection, &user.username, "errada"),
            Err(AppError::Unauthorized)
        ));
        // O nome de usuário não diferencia maiúsculas.
        assert!(authenticate(&connection, "MASTER", "senha-segura-123").is_ok());
    }
}
