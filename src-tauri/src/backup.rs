use std::{fs, path::{Path, PathBuf}};

use chrono::{DateTime, Duration, Local, Utc};
use rusqlite::{params, Connection, OpenFlags};
use uuid::Uuid;

use crate::{
    db,
    error::{AppError, AppResult},
    models::{BackupFile, LocalUser},
};

/// Padrão de retenção quando o parâmetro não pôde ser lido.
const RETENTION_PADRAO: i64 = 15;

pub fn backup_dir(app_data: &Path) -> PathBuf {
    app_data.join("backups")
}

/// Backup é governado pela permissão, nunca pelo nome do papel.
///
/// Checar `role == "gerente"` deixava o **master** de fora — e numa instalação
/// nova o master costuma ser o único administrador. A loja recém-instalada
/// ficava sem poder fazer nem restaurar backup.
fn require_manager(actor: &LocalUser) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == "backup.manage") {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn io(error: std::io::Error) -> AppError {
    AppError::Internal(error.to_string())
}

/// Cópia consistente usando `VACUUM INTO`, que respeita a transação em curso.
/// Copiar o arquivo com o banco aberto poderia gravar um estado quebrado.
/// Grava uma cópia consistente onde o usuário escolher — tipicamente um
/// pendrive.
///
/// É a única proteção real contra perder o computador: o backup automático
/// mora na mesma máquina e vai junto num roubo ou num disco queimado.
///
/// Usa `VACUUM INTO` como o backup normal. Copiar o arquivo `.sqlite3` na mão
/// perderia o que ainda está no WAL.
pub fn exportar(connection: &Connection, destino: &Path) -> AppResult<BackupFile> {
    if destino.as_os_str().is_empty() {
        return Err(AppError::Validation("escolha onde salvar a cópia".into()));
    }
    if let Some(pai) = destino.parent() {
        if !pai.as_os_str().is_empty() && !pai.exists() {
            return Err(AppError::Validation(
                "a pasta escolhida não existe; o pendrive pode ter sido removido".into(),
            ));
        }
    }
    if destino.exists() {
        fs::remove_file(destino).map_err(io)?;
    }

    let alvo = destino.to_string_lossy().replace('\'', "''");
    connection.execute_batch(&format!("VACUUM INTO '{alvo}'"))?;

    let size = fs::metadata(destino).map_err(io)?.len() as i64;
    Ok(BackupFile {
        path: destino.to_string_lossy().to_string(),
        file_name: destino
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        size_bytes: size,
        created_at: Utc::now().to_rfc3339(),
    })
}

pub fn create(
    connection: &Connection,
    app_data: &Path,
    kind: &str,
) -> AppResult<BackupFile> {
    let dir = backup_dir(app_data);
    fs::create_dir_all(&dir).map_err(io)?;

    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("k7-{kind}-{stamp}.sqlite3"));
    if path.exists() {
        fs::remove_file(&path).map_err(io)?;
    }

    let destino = path.to_string_lossy().replace('\'', "''");
    connection.execute_batch(&format!("VACUUM INTO '{destino}'"))?;

    let size = fs::metadata(&path).map_err(io)?.len() as i64;
    Ok(BackupFile {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        size_bytes: size,
        created_at: Utc::now().to_rfc3339(),
    })
}

pub fn list(app_data: &Path) -> AppResult<Vec<BackupFile>> {
    let dir = backup_dir(app_data);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(io)? {
        let entry = entry.map_err(io)?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("sqlite3") {
            continue;
        }
        let meta = entry.metadata().map_err(io)?;
        let created: DateTime<Utc> = meta.modified().map_err(io)?.into();
        out.push(BackupFile {
            path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            size_bytes: meta.len() as i64,
            created_at: created.to_rfc3339(),
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

fn prune(app_data: &Path, retencao: usize) -> AppResult<()> {
    let arquivos = list(app_data)?;
    for antigo in arquivos.into_iter().skip(retencao) {
        let _ = fs::remove_file(&antigo.path);
    }
    Ok(())
}

/// Backup automático: no máximo um por dia, executado na abertura do app.
pub fn run_automatic(connection: &Connection, app_data: &Path) -> AppResult<Option<BackupFile>> {
    let horas = crate::params::inteiro(connection, "backup.horas_entre_automaticos", 20);
    let retencao = crate::params::inteiro(connection, "backup.retencao", RETENTION_PADRAO);
    let existentes = list(app_data)?;
    let limite = Utc::now() - Duration::hours(horas);
    let recente = existentes.iter().any(|b| {
        DateTime::parse_from_rfc3339(&b.created_at)
            .map(|d| d.with_timezone(&Utc) > limite)
            .unwrap_or(false)
    });
    if recente {
        return Ok(None);
    }
    let feito = create(connection, app_data, "auto")?;
    prune(app_data, retencao.max(1) as usize)?;
    Ok(Some(feito))
}

pub fn create_manual(
    connection: &Connection,
    actor: &LocalUser,
    app_data: &Path,
) -> AppResult<BackupFile> {
    require_manager(actor)?;
    let feito = create(connection, app_data, "manual")?;
    connection.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'backup.create', 'backup', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            feito.file_name,
            serde_json::json!({ "size_bytes": feito.size_bytes }).to_string(),
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(feito)
}

/// Confere que o arquivo é mesmo um banco do K7, íntegro e de versão compatível.
/// Só depois disso o banco ativo pode ser substituído.
pub fn validate(path: &Path) -> AppResult<i64> {
    if !path.exists() {
        return Err(AppError::Validation(
            "arquivo de backup não encontrado".into(),
        ));
    }
    let candidato = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| AppError::Validation("arquivo não é um banco válido".into()))?;

    let integridade: String = candidato
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| AppError::Validation("não foi possível verificar a integridade".into()))?;
    if integridade != "ok" {
        return Err(AppError::Validation(
            "o backup está corrompido e não será restaurado".into(),
        ));
    }

    let versao: i64 = candidato
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| AppError::Validation("versão do backup ilegível".into()))?;
    if versao == 0 || versao > db::LATEST_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "backup usa schema {versao}, incompatível com esta versão do aplicativo"
        )));
    }

    // Precisa ter as tabelas centrais; evita restaurar um SQLite qualquer.
    for tabela in ["users", "products", "sales", "sale_items"] {
        let existe: bool = candidato
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [tabela],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !existe {
            return Err(AppError::Validation(
                "o arquivo não é um backup do K7 Cabines".into(),
            ));
        }
    }
    Ok(versao)
}

/// Substitui o banco ativo pelo backup. O chamador precisa entregar a conexão
/// atual para que ela seja fechada antes da troca de arquivos.
pub fn restore(
    conexao_atual: Connection,
    db_path: &Path,
    app_data: &Path,
    backup_path: &Path,
) -> AppResult<Connection> {
    validate(backup_path)?;

    // Salvaguarda: guarda o estado atual antes de sobrescrever.
    let _ = create(&conexao_atual, app_data, "pre-restauracao");

    // Fecha a conexão para que o WAL seja consolidado e o arquivo liberado.
    conexao_atual
        .close()
        .map_err(|(_, error)| AppError::Database(error))?;

    for sufixo in ["-wal", "-shm"] {
        let extra = PathBuf::from(format!("{}{}", db_path.to_string_lossy(), sufixo));
        let _ = fs::remove_file(extra);
    }
    fs::copy(backup_path, db_path).map_err(io)?;

    db::open(db_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn gerente() -> LocalUser {
        LocalUser {
            id: "g1".into(),
            username: "g".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["users.manage".into()],
        must_change_password: false,
        }
    }

    fn banco_com_dado(path: &Path) -> Connection {
        let c = db::open(path).unwrap();
        c.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p1', 'B1', 'Coca', 'Bebidas', '', 700, 5, 1, 'now', 'now')",
            [],
        ).unwrap();
        c
    }

    #[test]
    fn cria_backup_consistente_e_lista() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("k7.sqlite3");
        let c = banco_com_dado(&db_path);

        let feito = create(&c, dir.path(), "manual").unwrap();
        assert!(feito.size_bytes > 0);
        assert!(Path::new(&feito.path).exists());

        let lista = list(dir.path()).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].file_name, feito.file_name);
    }

    #[test]
    fn backup_recusa_arquivo_que_nao_e_do_k7() {
        let dir = tempdir().unwrap();
        let falso = dir.path().join("qualquer.sqlite3");
        let outro = Connection::open(&falso).unwrap();
        outro.execute("CREATE TABLE bobagem (id INTEGER)", []).unwrap();
        outro.pragma_update(None, "user_version", 1).unwrap();
        drop(outro);

        let r = validate(&falso);
        assert!(matches!(r, Err(AppError::Validation(_))));
    }

    #[test]
    fn backup_recusa_arquivo_inexistente_ou_nao_sqlite() {
        let dir = tempdir().unwrap();
        assert!(matches!(validate(&dir.path().join("nao-existe.sqlite3")), Err(AppError::Validation(_))));

        let texto = dir.path().join("texto.sqlite3");
        fs::write(&texto, b"isto nao e um banco de dados").unwrap();
        assert!(matches!(validate(&texto), Err(AppError::Validation(_))));
    }

    #[test]
    fn exportar_grava_copia_valida_no_destino_escolhido() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("k7.sqlite3");
        let c = banco_com_dado(&db_path);

        let destino = dir.path().join("pendrive").join("copia.sqlite3");
        fs::create_dir_all(destino.parent().unwrap()).unwrap();

        let arquivo = exportar(&c, &destino).unwrap();
        assert!(destino.exists());
        assert!(arquivo.size_bytes > 0);
        // A cópia precisa ser um banco íntegro, não um arquivo qualquer.
        assert!(validate(&destino).is_ok());
    }

    #[test]
    fn exportar_para_pasta_inexistente_explica_em_vez_de_falhar_seco() {
        let dir = tempdir().unwrap();
        let c = banco_com_dado(&dir.path().join("k7.sqlite3"));
        let erro = exportar(&c, &dir.path().join("pendrive-removido").join("c.sqlite3"));
        assert!(matches!(erro, Err(AppError::Validation(_))));
    }

    #[test]
    fn restaura_devolvendo_o_banco_ao_estado_do_backup() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("k7.sqlite3");
        let c = banco_com_dado(&db_path);

        let backup = create(&c, dir.path(), "manual").unwrap();

        // Muda o banco depois do backup.
        c.execute("UPDATE products SET stock_quantity = 999 WHERE id = 'p1'", []).unwrap();
        let antes: i64 = c.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(antes, 999);

        let restaurado = restore(c, &db_path, dir.path(), Path::new(&backup.path)).unwrap();
        let depois: i64 = restaurado.query_row("SELECT stock_quantity FROM products WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(depois, 5, "o estoque volta ao valor do backup");

        // A salvaguarda pré-restauração também foi gravada.
        assert!(list(dir.path()).unwrap().iter().any(|b| b.file_name.contains("pre-restauracao")));
    }

    #[test]
    fn automatico_roda_uma_vez_por_dia() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("k7.sqlite3");
        let c = banco_com_dado(&db_path);

        assert!(run_automatic(&c, dir.path()).unwrap().is_some(), "primeiro backup do dia");
        assert!(run_automatic(&c, dir.path()).unwrap().is_none(), "não repete no mesmo dia");
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn backup_manual_exige_gerente() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("k7.sqlite3");
        let c = banco_com_dado(&db_path);
        let mut atendente = gerente();
        atendente.role = "atendente".into();
        assert!(matches!(create_manual(&c, &atendente, dir.path()), Err(AppError::Forbidden)));
    }
}
