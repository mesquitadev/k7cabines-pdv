use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{LocalUser, SystemParam},
};

/// Lê um parâmetro inteiro, caindo no padrão quando ele não existe ou é inválido.
/// O sistema nunca deve parar por causa de um parâmetro mal preenchido.
pub fn inteiro(connection: &Connection, key: &str, padrao: i64) -> i64 {
    connection
        .query_row(
            "SELECT value FROM system_params WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(padrao)
}

pub fn booleano(connection: &Connection, key: &str, padrao: bool) -> bool {
    connection
        .query_row(
            "SELECT value FROM system_params WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(padrao)
}

pub fn listar(connection: &Connection) -> AppResult<Vec<SystemParam>> {
    let mut st = connection.prepare(
        "SELECT key, value, tipo, grupo, rotulo, descricao, minimo, maximo
         FROM system_params ORDER BY sort_order, key",
    )?;
    let linhas = st.query_map([], |row| {
        Ok(SystemParam {
            key: row.get(0)?,
            value: row.get(1)?,
            tipo: row.get(2)?,
            grupo: row.get(3)?,
            rotulo: row.get(4)?,
            descricao: row.get(5)?,
            minimo: row.get(6)?,
            maximo: row.get(7)?,
        })
    })?;
    linhas.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Grava um parâmetro validando faixa e tipo, para que a interface não consiga
/// gravar algo que quebre a operação depois.
pub fn definir(
    connection: &mut Connection,
    actor: &LocalUser,
    key: &str,
    value: &str,
) -> AppResult<()> {
    if !actor.permissions.iter().any(|p| p == "users.manage") {
        return Err(AppError::Forbidden);
    }

    let (tipo, minimo, maximo, rotulo): (String, Option<i64>, Option<i64>, String) = connection
        .query_row(
            "SELECT tipo, minimo, maximo, rotulo FROM system_params WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| AppError::Validation("parâmetro desconhecido".into()))?;

    let valor_normalizado = match tipo.as_str() {
        "inteiro" => {
            let n: i64 = value
                .trim()
                .parse()
                .map_err(|_| AppError::Validation(format!("{rotulo}: informe um número inteiro")))?;
            if let Some(min) = minimo {
                if n < min {
                    return Err(AppError::Validation(format!("{rotulo}: mínimo é {min}")));
                }
            }
            if let Some(max) = maximo {
                if n > max {
                    return Err(AppError::Validation(format!("{rotulo}: máximo é {max}")));
                }
            }
            n.to_string()
        }
        "booleano" => {
            if value == "1" || value.eq_ignore_ascii_case("true") {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        _ => {
            if value.chars().count() > 200 {
                return Err(AppError::Validation(format!("{rotulo}: texto longo demais")));
            }
            value.trim().to_string()
        }
    };

    connection.execute(
        "UPDATE system_params SET value = ?1 WHERE key = ?2",
        params![valor_normalizado, key],
    )?;
    connection.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'params.update', 'system_param', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            key,
            serde_json::json!({ "value": valor_normalizado }).to_string(),
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn master() -> LocalUser {
        LocalUser {
            id: "m1".into(),
            username: "master".into(),
            full_name: "Master".into(),
            whatsapp: None,
            role: "master".into(),
            permissions: vec!["users.manage".into()],
            must_change_password: false,
        }
    }

    fn base() -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('m1','master','x','Master','master',1,'now','now')", []).unwrap();
        c
    }

    #[test]
    fn le_o_padrao_quando_o_parametro_nao_existe() {
        let c = base();
        assert_eq!(inteiro(&c, "nao.existe", 7), 7);
        assert_eq!(inteiro(&c, "backup.retencao", 99), 15, "usa o valor gravado");
    }

    #[test]
    fn respeita_a_faixa_declarada() {
        let mut c = base();
        assert!(matches!(
            definir(&mut c, &master(), "backup.retencao", "1"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            definir(&mut c, &master(), "backup.retencao", "abc"),
            Err(AppError::Validation(_))
        ));
        definir(&mut c, &master(), "backup.retencao", "30").unwrap();
        assert_eq!(inteiro(&c, "backup.retencao", 15), 30);
    }

    #[test]
    fn booleano_normaliza_e_exige_permissao() {
        let mut c = base();
        definir(&mut c, &master(), "venda.exige_caixa_aberto", "false").unwrap();
        assert!(!booleano(&c, "venda.exige_caixa_aberto", true));

        let mut sem = master();
        sem.permissions.clear();
        assert!(matches!(
            definir(&mut c, &sem, "backup.retencao", "20"),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn recusa_parametro_desconhecido() {
        let mut c = base();
        assert!(matches!(
            definir(&mut c, &master(), "inventado.qualquer", "1"),
            Err(AppError::Validation(_))
        ));
    }
}
