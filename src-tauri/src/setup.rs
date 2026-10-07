use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::{
    auth::{self, MASTER_FULL_NAME, MASTER_USERNAME},
    error::{AppError, AppResult},
    models::{LocalUser, SetupInput, SetupStatus},
};

/// Estado da instalação. A tela de entrada consulta isto para decidir entre
/// mostrar o assistente de implantação ou o acesso normal.
pub fn status(connection: &Connection) -> AppResult<SetupStatus> {
    let (setup_completed, installation_id, store_name, store_city, onboarding_completed) =
        connection.query_row(
            "SELECT setup_completed, installation_id, store_name, store_city, onboarding_completed
             FROM installation WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            },
        )?;
    Ok(SetupStatus {
        setup_completed,
        onboarding_completed,
        installation_id,
        store_name,
        store_city,
    })
}

/// Implantação numa loja: nomeia a instalação e cria a conta master permanente.
///
/// Roda uma vez só, numa transação: ou a loja fica pronta por inteiro, ou nada
/// é gravado. Sem internet e sem vínculo com outras instalações.
pub fn complete(
    connection: &mut Connection,
    input: SetupInput,
    app_version: &str,
) -> AppResult<LocalUser> {
    let store_name = input.store_name.trim().to_string();
    let store_city = input.store_city.trim().to_string();
    if store_name.chars().count() < 2 {
        return Err(AppError::Validation("informe o nome da loja".into()));
    }
    if store_name.chars().count() > 80 || store_city.chars().count() > 60 {
        return Err(AppError::Validation("nome ou cidade longos demais".into()));
    }
    auth::validate_password(&input.master_password)?;

    let ja_feito: bool = connection.query_row(
        "SELECT setup_completed FROM installation WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    if ja_feito {
        return Err(AppError::Conflict(
            "esta instalação já foi configurada".into(),
        ));
    }

    let id = Uuid::new_v4().to_string();
    let password_hash = auth::hash_password(&input.master_password)?;
    let now = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;

    // A conta master pertence à instalação, não a uma pessoa: nome fixo,
    // permanente, e sem dados pessoais.
    transaction.execute(
        "INSERT INTO users (id, username, password_hash, full_name, whatsapp, role, active,
                            is_permanent, must_change_password, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, 'master', 1, 1, 0, ?5, ?5)",
        params![id, MASTER_USERNAME, password_hash, MASTER_FULL_NAME, now],
    )?;

    transaction.execute(
        "UPDATE installation
         SET store_name = ?1, store_city = ?2, setup_completed = 1, onboarding_completed = 0,
             setup_at = ?3, app_version = ?4
         WHERE id = 1",
        params![store_name, store_city, now, app_version],
    )?;

    // O nome da loja alimenta o cabeçalho do cupom e a cidade entra no PIX.
    transaction.execute(
        "UPDATE ticket_settings
         SET store_name = ?1, pix_merchant_city = ?2, updated_at = ?3
         WHERE id = 1",
        params![store_name, store_city, now],
    )?;

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'installation.setup', 'installation', '1', ?3, ?4)",
        params![
            Uuid::new_v4().to_string(),
            id,
            serde_json::json!({ "store_name": store_name, "store_city": store_city }).to_string(),
            now
        ],
    )?;

    transaction.commit()?;
    auth::load_user(connection, &id)?.ok_or(AppError::NotFound)
}

/// Fecha (ou reabre) o roteiro de configuração inicial. Só o master: é quem
/// responde pelo que a loja imprime e por onde o backup fica.
pub fn set_onboarding(
    connection: &Connection,
    actor: &LocalUser,
    completed: bool,
) -> AppResult<SetupStatus> {
    let e_master: bool = connection
        .query_row(
            "SELECT is_master FROM roles WHERE key = ?1",
            [&actor.role],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !e_master {
        return Err(AppError::Forbidden);
    }
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE installation SET onboarding_completed = ?1 WHERE id = 1",
        params![completed],
    )?;
    connection.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'installation.onboarding', 'installation', '1', ?3, ?4)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            serde_json::json!({ "completed": completed }).to_string(),
            now
        ],
    )?;
    status(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn entrada() -> SetupInput {
        SetupInput {
            store_name: "K7 Cabines Pavuna".into(),
            store_city: "Rio de Janeiro".into(),
            master_password: "senha-forte-123".into(),
        }
    }

    #[test]
    fn instalacao_nova_comeca_sem_setup_e_com_identificador_proprio() {
        let c = db::open_in_memory().unwrap();
        let s = status(&c).unwrap();
        assert!(!s.setup_completed);
        assert_eq!(s.installation_id.len(), 32, "identificador aleatório por loja");
    }

    #[test]
    fn setup_cria_master_permanente_e_nomeia_a_loja() {
        let mut c = db::open_in_memory().unwrap();
        let master = complete(&mut c, entrada(), "0.1.0").unwrap();

        assert_eq!(master.username, "master", "a conta é do sistema, não de uma pessoa");
        assert_eq!(master.role, "master");
        assert!(!master.must_change_password);
        assert!(master.permissions.contains(&"users.manage".to_string()));

        let s = status(&c).unwrap();
        assert!(s.setup_completed);
        assert!(!s.onboarding_completed, "instalação nova ainda passa pelo roteiro");
        assert_eq!(s.store_name, "K7 Cabines Pavuna");

        // O master fecha o roteiro; outro papel não consegue.
        let mut outro = master.clone();
        outro.role = "gerente".into();
        assert!(matches!(set_onboarding(&c, &outro, true), Err(AppError::Forbidden)));
        assert!(set_onboarding(&c, &master, true).unwrap().onboarding_completed);

        // O cupom já sai com o nome da loja configurado.
        let cupom: String = c
            .query_row("SELECT store_name FROM ticket_settings WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cupom, "K7 Cabines Pavuna");

        let permanente: bool = c
            .query_row("SELECT is_permanent FROM users WHERE username = 'master'", [], |r| r.get(0))
            .unwrap();
        assert!(permanente);
    }

    #[test]
    fn setup_roda_uma_vez_so() {
        let mut c = db::open_in_memory().unwrap();
        complete(&mut c, entrada(), "0.1.0").unwrap();
        assert!(matches!(complete(&mut c, entrada(), "0.1.0"), Err(AppError::Conflict(_))));
    }

    #[test]
    fn setup_exige_loja_e_senha_forte() {
        let mut c = db::open_in_memory().unwrap();
        let sem_loja = complete(&mut c, SetupInput { store_name: " ".into(), ..entrada() }, "0.1.0");
        assert!(matches!(sem_loja, Err(AppError::Validation(_))));

        let senha_curta = complete(
            &mut c,
            SetupInput { master_password: "123".into(), ..entrada() },
            "0.1.0",
        );
        assert!(matches!(senha_curta, Err(AppError::Validation(_))));

        // Nada foi gravado pela metade.
        assert!(!status(&c).unwrap().setup_completed);
        let contas: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
        assert_eq!(contas, 0);
    }
}
