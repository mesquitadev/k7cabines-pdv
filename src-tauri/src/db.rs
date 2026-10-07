use std::{fs, path::Path};

use rusqlite::{Connection, OpenFlags};

use crate::error::{AppError, AppResult};

const MIGRATION_001: &str = include_str!("../migrations/001_initial.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_parity.sql");
const MIGRATION_003: &str = include_str!("../migrations/003_pdv_completo.sql");
const MIGRATION_004: &str = include_str!("../migrations/004_rbac.sql");
const MIGRATION_005: &str = include_str!("../migrations/005_master_permanente.sql");
const MIGRATION_006: &str = include_str!("../migrations/006_master_generico.sql");
const MIGRATION_007: &str = include_str!("../migrations/007_instalacao.sql");
const MIGRATION_008: &str = include_str!("../migrations/008_sessoes.sql");
const MIGRATION_009: &str = include_str!("../migrations/009_parametros.sql");
const MIGRATION_010: &str = include_str!("../migrations/010_categorias_variacoes.sql");
const MIGRATION_011: &str = include_str!("../migrations/011_identificacao.sql");
const MIGRATION_012: &str = include_str!("../migrations/012_fornecedores.sql");
const MIGRATION_013: &str = include_str!("../migrations/013_impressora.sql");
const MIGRATION_014: &str = include_str!("../migrations/014_custo_na_venda.sql");
const MIGRATION_015: &str = include_str!("../migrations/015_loja.sql");
const MIGRATION_016: &str = include_str!("../migrations/016_virada_de_dia.sql");
const MIGRATION_017: &str = include_str!("../migrations/017_estorno_no_turno.sql");
const MIGRATION_018: &str = include_str!("../migrations/018_devolucao_por_lote.sql");
const MIGRATION_019: &str = include_str!("../migrations/019_credito_de_ficha.sql");
const MIGRATION_020: &str = include_str!("../migrations/020_impressao_automatica.sql");
const MIGRATION_021: &str = include_str!("../migrations/021_fonte_da_interface.sql");
const MIGRATION_022: &str = include_str!("../migrations/022_fonte_maior.sql");
const MIGRATION_023: &str = include_str!("../migrations/023_motivo_do_desconto.sql");
const MIGRATION_024: &str = include_str!("../migrations/024_historico_por_perfil.sql");
const MIGRATION_025: &str = include_str!("../migrations/025_ficha_ao_portador.sql");
const MIGRATION_026: &str = include_str!("../migrations/026_resultado_financeiro.sql");
const MIGRATION_027: &str = include_str!("../migrations/027_cliente_na_venda.sql");
const MIGRATION_028: &str = include_str!("../migrations/028_ordem_resultado.sql");
const MIGRATION_029: &str = include_str!("../migrations/029_piscar.sql");
const MIGRATION_030: &str = include_str!("../migrations/030_assistente_inicial.sql");

pub const LATEST_SCHEMA_VERSION: i64 = 30;

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Internal(error.to_string()))?;
    }

    let mut connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )?;
    configure(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

#[cfg(test)]
pub fn open_in_memory() -> AppResult<Connection> {
    let mut connection = Connection::open_in_memory()?;
    configure(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

fn configure(connection: &Connection) -> AppResult<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

fn migrate(connection: &mut Connection) -> AppResult<()> {
    let current: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(AppError::Internal(format!(
            "banco local usa schema {current}, superior ao suportado {LATEST_SCHEMA_VERSION}"
        )));
    }
    if current < 1 {
        connection.execute_batch(MIGRATION_001)?;
    }
    if current < 2 {
        connection.execute_batch(MIGRATION_002)?;
    }
    if current < 3 {
        connection.execute_batch(MIGRATION_003)?;
    }
    if current < 4 {
        // A 004 reconstrói `users`; o procedimento documentado do SQLite exige
        // as chaves estrangeiras desligadas durante a troca de tabela.
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        let resultado = connection.execute_batch(MIGRATION_004);
        connection.pragma_update(None, "foreign_keys", "ON")?;
        resultado?;
        let quebradas: i64 =
            connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
        if quebradas > 0 {
            return Err(AppError::Internal(format!(
                "migração 004 deixou {quebradas} referências quebradas"
            )));
        }
    }
    if current < 5 {
        connection.execute_batch(MIGRATION_005)?;
    }
    if current < 6 {
        connection.execute_batch(MIGRATION_006)?;
    }
    if current < 7 {
        connection.execute_batch(MIGRATION_007)?;
    }
    if current < 8 {
        connection.execute_batch(MIGRATION_008)?;
    }
    if current < 9 {
        connection.execute_batch(MIGRATION_009)?;
    }
    if current < 10 {
        connection.execute_batch(MIGRATION_010)?;
    }
    if current < 11 {
        connection.execute_batch(MIGRATION_011)?;
    }
    if current < 12 {
        connection.execute_batch(MIGRATION_012)?;
    }
    if current < 13 {
        connection.execute_batch(MIGRATION_013)?;
    }
    if current < 14 {
        connection.execute_batch(MIGRATION_014)?;
    }
    if current < 15 {
        connection.execute_batch(MIGRATION_015)?;
    }
    if current < 16 {
        connection.execute_batch(MIGRATION_016)?;
    }
    if current < 17 {
        connection.execute_batch(MIGRATION_017)?;
    }
    if current < 18 {
        connection.execute_batch(MIGRATION_018)?;
    }
    if current < 19 {
        connection.execute_batch(MIGRATION_019)?;
    }
    if current < 20 {
        connection.execute_batch(MIGRATION_020)?;
    }
    if current < 21 {
        connection.execute_batch(MIGRATION_021)?;
    }
    if current < 22 {
        connection.execute_batch(MIGRATION_022)?;
    }
    if current < 23 {
        connection.execute_batch(MIGRATION_023)?;
    }
    if current < 24 {
        connection.execute_batch(MIGRATION_024)?;
    }
    if current < 25 {
        connection.execute_batch(MIGRATION_025)?;
    }
    if current < 26 {
        connection.execute_batch(MIGRATION_026)?;
    }
    if current < 27 {
        connection.execute_batch(MIGRATION_027)?;
    }
    if current < 28 {
        connection.execute_batch(MIGRATION_028)?;
    }
    if current < 29 {
        connection.execute_batch(MIGRATION_029)?;
    }
    if current < 30 {
        connection.execute_batch(MIGRATION_030)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_creates_expected_schema() {
        let connection = open_in_memory().expect("database should open");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version should exist");
        assert_eq!(version, LATEST_SCHEMA_VERSION);

        for table in [
            "users",
            "products",
            "product_batches",
            "sales",
            "sale_items",
            "stock_movements",
            "audit_events",
            "sync_outbox",
            "deleted_sales",
            "cash_sessions",
            "cash_movements",
            "sale_returns",
            "inventory_counts",
            "roles",
            "role_permissions",
            "permissions",
        ] {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                    [table],
                    |row| row.get(0),
                )
                .expect("table lookup should work");
            assert!(exists, "missing table {table}");
        }
    }
}
