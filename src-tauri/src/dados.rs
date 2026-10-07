//! Dados por área: exportar, importar e limpar.
//!
//! O backup (`backup.rs`) é o banco inteiro, para voltar a esta máquina. Aqui é
//! o contrário: o dono separa o que quer levar ou apagar — vendas, estoque ou
//! o resto do sistema — sem mexer nas outras áreas.
//!
//! Pedido do cliente em 24/09/2026: "vendas em uma pasta, estoque em outra;
//! apagar anos antigos de venda sem perder o estoque; escolher o que exportar".
//!
//! Regras:
//! - Exportar e apagar backup: permissão `backup.manage`.
//! - Importar e limpar: só o master. São operações que reescrevem o banco.
//! - Limpar sempre grava um backup `pre-limpeza` antes de apagar qualquer linha.
//! - Dinheiro continua em centavos; o arquivo carrega as linhas como estão.

use std::{fs, path::{Path, PathBuf}};

use chrono::{Local, NaiveDate, Utc};
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    backup, db,
    error::{AppError, AppResult},
    models::{BackupFile, LocalUser},
};

/// Versão do formato do arquivo de área. Sobe quando a estrutura do JSON muda.
const FORMATO: i64 = 1;

/// As áreas e suas tabelas, em ordem de dependência (pai antes do filho).
/// A ordem importa na importação: a linha filha precisa achar a mãe.
const VENDAS: &[&str] = &[
    "cash_sessions",
    "cash_movements",
    "sales",
    "sale_items",
    "sale_item_batches",
    "sale_returns",
    "deleted_sales",
    "credit_vouchers",
    "credit_voucher_items",
    "credit_withdrawals",
    "business_counters",
];
const ESTOQUE: &[&str] = &[
    "suppliers",
    "categories",
    "products",
    "product_batches",
    "stock_movements",
    "inventory_counts",
];
const SISTEMA: &[&str] = &[
    "roles",
    "permissions",
    "role_permissions",
    "users",
    "user_permissions",
    "printer_settings",
    "ticket_settings",
    "system_params",
    "audit_events",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Area {
    Vendas,
    Estoque,
    Sistema,
}

impl Area {
    fn tabelas(self) -> &'static [&'static str] {
        match self {
            Area::Vendas => VENDAS,
            Area::Estoque => ESTOQUE,
            Area::Sistema => SISTEMA,
        }
    }
    fn nome(self) -> &'static str {
        match self {
            Area::Vendas => "vendas",
            Area::Estoque => "estoque",
            Area::Sistema => "sistema",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ArquivoArea {
    pub area: Area,
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub linhas: i64,
}

#[derive(Debug, Serialize)]
pub struct ResumoImportacao {
    pub area: Area,
    pub linhas: i64,
    pub tabelas: i64,
}

#[derive(Debug, Serialize)]
pub struct ResumoLimpeza {
    pub area: Area,
    pub antes_de: String,
    pub apagadas: i64,
    pub backup: BackupFile,
}

fn io(error: std::io::Error) -> AppError {
    AppError::Internal(error.to_string())
}

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Importar e limpar reescrevem o banco: só o master.
fn require_master(connection: &Connection, actor: &LocalUser) -> AppResult<()> {
    let e_master: bool = connection
        .query_row(
            "SELECT is_master FROM roles WHERE key = ?1",
            [&actor.role],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if e_master {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn auditar(
    connection: &Connection,
    actor: &LocalUser,
    action: &str,
    entity_id: &str,
    after: Value,
) -> AppResult<()> {
    connection.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, ?3, 'dados', ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            action,
            entity_id,
            after.to_string(),
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn colunas_da_tabela(connection: &Connection, tabela: &str) -> AppResult<Vec<String>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({tabela})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn valor_para_json(valor: ValueRef<'_>) -> Value {
    match valor {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        // Blob vira hexadecimal com prefixo, para voltar igual na importação.
        ValueRef::Blob(b) => Value::String(format!(
            "hex:{}",
            b.iter().map(|x| format!("{x:02x}")).collect::<String>()
        )),
    }
}

fn json_para_valor(valor: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match valor {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(V::Integer)
            .or_else(|| n.as_f64().map(V::Real))
            .unwrap_or(V::Null),
        Value::String(s) => {
            if let Some(hex) = s.strip_prefix("hex:") {
                let bytes = (0..hex.len())
                    .step_by(2)
                    .filter_map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
                    .collect::<Vec<u8>>();
                V::Blob(bytes)
            } else {
                V::Text(s.clone())
            }
        }
        outro => V::Text(outro.to_string()),
    }
}

// ============================================================
// Exportar
// ============================================================

/// Grava `k7-<area>-<carimbo>.json` na pasta escolhida.
///
/// O arquivo é uma foto das tabelas da área: colunas e linhas, como estão no
/// banco. Não é o backup — é o que o dono leva para outro lugar ou guarda
/// antes de apagar.
pub fn exportar(
    connection: &Connection,
    actor: &LocalUser,
    area: Area,
    pasta: &Path,
) -> AppResult<ArquivoArea> {
    require(actor, "backup.manage")?;
    if pasta.as_os_str().is_empty() {
        return Err(AppError::Validation("escolha a pasta onde salvar".into()));
    }
    if !pasta.is_dir() {
        return Err(AppError::Validation(
            "a pasta escolhida não existe; o pendrive pode ter sido removido".into(),
        ));
    }

    let installation_id: String = connection
        .query_row("SELECT installation_id FROM installation LIMIT 1", [], |r| r.get(0))
        .optional()?
        .unwrap_or_default();

    let mut tabelas = serde_json::Map::new();
    let mut total: i64 = 0;
    for tabela in area.tabelas() {
        let colunas = colunas_da_tabela(connection, tabela)?;
        if colunas.is_empty() {
            continue;
        }
        let mut statement = connection.prepare(&format!("SELECT * FROM {tabela}"))?;
        let n = statement.column_count();
        let mut rows = statement.query([])?;
        let mut linhas = Vec::new();
        while let Some(row) = rows.next()? {
            let mut valores = Vec::with_capacity(n);
            for i in 0..n {
                valores.push(valor_para_json(row.get_ref(i)?));
            }
            linhas.push(Value::Array(valores));
        }
        total += linhas.len() as i64;
        tabelas.insert(
            (*tabela).to_string(),
            json!({ "columns": colunas, "rows": linhas }),
        );
    }

    let documento = json!({
        "k7cabines": {
            "formato": FORMATO,
            "area": area.nome(),
            "schema_version": db::LATEST_SCHEMA_VERSION,
            "installation_id": installation_id,
            "exported_at": Utc::now().to_rfc3339(),
            "exported_by": actor.full_name,
        },
        "tables": Value::Object(tabelas),
    });

    let carimbo = Local::now().format("%Y%m%d-%H%M%S");
    let file_name = format!("k7-{}-{carimbo}.json", area.nome());
    let path: PathBuf = pasta.join(&file_name);
    let texto = serde_json::to_string_pretty(&documento)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    fs::write(&path, texto).map_err(io)?;
    let size_bytes = fs::metadata(&path).map_err(io)?.len() as i64;

    auditar(
        connection,
        actor,
        "dados.export",
        &file_name,
        json!({ "area": area.nome(), "linhas": total, "path": path.to_string_lossy() }),
    )?;

    Ok(ArquivoArea {
        area,
        path: path.to_string_lossy().to_string(),
        file_name,
        size_bytes,
        linhas: total,
    })
}

// ============================================================
// Importar
// ============================================================

#[derive(Debug, Deserialize)]
struct Cabecalho {
    formato: i64,
    area: String,
    schema_version: i64,
}

#[derive(Debug, Deserialize)]
struct Documento {
    k7cabines: Cabecalho,
    tables: serde_json::Map<String, Value>,
}

/// Lê o arquivo e diz qual área ele carrega, sem tocar no banco.
pub fn inspecionar(origem: &Path) -> AppResult<Area> {
    let bruto = fs::read_to_string(origem)
        .map_err(|_| AppError::Validation("arquivo não encontrado".into()))?;
    let documento: Documento = serde_json::from_str(&bruto)
        .map_err(|_| AppError::Validation("o arquivo não é uma exportação de área do K7".into()))?;
    if documento.k7cabines.formato > FORMATO {
        return Err(AppError::Validation(format!(
            "o arquivo usa formato {} e este aplicativo lê até o {FORMATO}",
            documento.k7cabines.formato
        )));
    }
    if documento.k7cabines.schema_version > db::LATEST_SCHEMA_VERSION {
        return Err(AppError::Validation(
            "o arquivo veio de uma versão mais nova do aplicativo; atualize antes de importar".into(),
        ));
    }
    match documento.k7cabines.area.as_str() {
        "vendas" => Ok(Area::Vendas),
        "estoque" => Ok(Area::Estoque),
        "sistema" => Ok(Area::Sistema),
        outro => Err(AppError::Validation(format!("área desconhecida no arquivo: {outro}"))),
    }
}

/// Aplica o arquivo sobre o banco, tabela a tabela, numa única transação.
///
/// Linha com a mesma chave é substituída; o que não existe é criado. Contas
/// (`users`) são a exceção: as que já existem aqui ficam como estão, para
/// ninguém perder a senha local nem o master ser sobrescrito.
///
/// Se o arquivo referenciar algo que este banco não tem (uma venda apontando
/// para um produto que não existe aqui), a transação inteira volta atrás e o
/// erro explica.
pub fn importar(
    connection: &mut Connection,
    actor: &LocalUser,
    origem: &Path,
) -> AppResult<ResumoImportacao> {
    require_master(connection, actor)?;
    let area = inspecionar(origem)?;
    let bruto = fs::read_to_string(origem).map_err(io)?;
    let documento: Documento = serde_json::from_str(&bruto)
        .map_err(|_| AppError::Validation("o arquivo não é uma exportação de área do K7".into()))?;

    let transaction = connection.transaction()?;
    transaction.execute_batch("PRAGMA defer_foreign_keys = ON")?;

    let mut linhas: i64 = 0;
    let mut tabelas: i64 = 0;
    for tabela in area.tabelas() {
        let Some(bloco) = documento.tables.get(*tabela) else { continue };
        let colunas_arquivo: Vec<String> = bloco
            .get("columns")
            .and_then(Value::as_array)
            .map(|c| c.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let rows = bloco.get("rows").and_then(Value::as_array);
        let (Some(rows), false) = (rows, colunas_arquivo.is_empty()) else { continue };

        let colunas_banco = colunas_da_tabela(&transaction, tabela)?;
        // Só as colunas que existem dos dois lados: arquivo antigo não quebra
        // banco novo, e coluna que sumiu é ignorada.
        let indices: Vec<usize> = colunas_arquivo
            .iter()
            .enumerate()
            .filter(|(_, c)| colunas_banco.contains(c))
            .map(|(i, _)| i)
            .collect();
        if indices.is_empty() {
            continue;
        }
        let nomes = indices.iter().map(|i| colunas_arquivo[*i].as_str()).collect::<Vec<_>>();
        let marcadores = (1..=nomes.len()).map(|i| format!("?{i}")).collect::<Vec<_>>();
        let verbo = if *tabela == "users" { "INSERT OR IGNORE" } else { "INSERT OR REPLACE" };
        let sql = format!(
            "{verbo} INTO {tabela} ({}) VALUES ({})",
            nomes.join(", "),
            marcadores.join(", ")
        );
        let mut statement = transaction.prepare(&sql)?;
        for row in rows {
            let Some(valores) = row.as_array() else { continue };
            let params: Vec<rusqlite::types::Value> = indices
                .iter()
                .map(|i| valores.get(*i).map(json_para_valor).unwrap_or(rusqlite::types::Value::Null))
                .collect();
            statement.execute(rusqlite::params_from_iter(params.iter()))?;
            linhas += 1;
        }
        tabelas += 1;
    }

    auditar(
        &transaction,
        actor,
        "dados.import",
        &origem.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        json!({ "area": area.nome(), "linhas": linhas, "tabelas": tabelas }),
    )?;

    transaction.commit().map_err(|e| match e {
        rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 787 => {
            AppError::Validation(
                "o arquivo referencia registros que este banco não tem (produto, usuário ou turno). Importe primeiro a área de que ele depende.".into(),
            )
        }
        outro => AppError::Database(outro),
    })?;

    Ok(ResumoImportacao { area, linhas, tabelas })
}

// ============================================================
// Limpar
// ============================================================

fn data_limite(antes_de: &str) -> AppResult<NaiveDate> {
    let data = NaiveDate::parse_from_str(antes_de.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("data inválida".into()))?;
    let hoje = Local::now().date_naive();
    if data > hoje {
        return Err(AppError::Validation("a data não pode ser no futuro".into()));
    }
    Ok(data)
}

/// Apaga o histórico da área anterior à data. O que fica são os cadastros:
/// produtos, saldos, contas, configurações.
///
/// Antes de apagar, grava um backup `pre-limpeza`. Depois, `VACUUM` devolve o
/// espaço ao disco — que é o motivo de o dono querer limpar.
pub fn limpar(
    connection: &mut Connection,
    actor: &LocalUser,
    area: Area,
    antes_de: &str,
    app_data: &Path,
) -> AppResult<ResumoLimpeza> {
    require_master(connection, actor)?;
    let data = data_limite(antes_de)?;
    let limite = data.format("%Y-%m-%d").to_string();

    let backup = backup::create(connection, app_data, "pre-limpeza")?;

    let apagadas = match area {
        Area::Vendas => limpar_vendas(connection, actor, &limite)?,
        Area::Estoque => limpar_estoque(connection, actor, &limite)?,
        Area::Sistema => {
            return Err(AppError::Validation(
                "a área Sistema não tem histórico para limpar".into(),
            ))
        }
    };

    // Fora da transação: VACUUM não roda dentro de uma.
    connection.execute_batch("VACUUM")?;

    Ok(ResumoLimpeza { area, antes_de: limite, apagadas, backup })
}

fn limpar_vendas(connection: &mut Connection, actor: &LocalUser, limite: &str) -> AppResult<i64> {
    let transaction = connection.transaction()?;

    // Ficha em aberto é mercadoria que o cliente ainda vai buscar: não some.
    let fichas_abertas: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM credit_vouchers v JOIN sales s ON s.id = v.sale_id
         WHERE s.business_date < ?1 AND v.settled_at IS NULL",
        [limite],
        |r| r.get(0),
    )?;
    if fichas_abertas > 0 {
        return Err(AppError::Validation(format!(
            "há {fichas_abertas} ficha(s) em aberto antes dessa data; entregue ou encerre antes de limpar"
        )));
    }
    let turno_aberto: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open' AND substr(opened_at, 1, 10) < ?1",
        [limite],
        |r| r.get(0),
    )?;
    if turno_aberto > 0 {
        return Err(AppError::Validation(
            "há turno aberto antes dessa data; feche o caixa antes de limpar".into(),
        ));
    }

    let apagadas: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM sales WHERE business_date < ?1",
        [limite],
        |r| r.get(0),
    )?;

    transaction.execute(
        "DELETE FROM credit_withdrawals WHERE voucher_item_id IN (
            SELECT i.id FROM credit_voucher_items i
            JOIN credit_vouchers v ON v.id = i.voucher_id
            JOIN sales s ON s.id = v.sale_id WHERE s.business_date < ?1)",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM credit_voucher_items WHERE voucher_id IN (
            SELECT v.id FROM credit_vouchers v JOIN sales s ON s.id = v.sale_id
            WHERE s.business_date < ?1)",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM credit_vouchers WHERE sale_id IN (SELECT id FROM sales WHERE business_date < ?1)",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM sale_returns WHERE sale_id IN (SELECT id FROM sales WHERE business_date < ?1)",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM sale_item_batches WHERE sale_item_id IN (
            SELECT i.id FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.business_date < ?1)",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE business_date < ?1)",
        [limite],
    )?;
    transaction.execute("DELETE FROM deleted_sales WHERE business_date < ?1", [limite])?;
    transaction.execute("DELETE FROM sales WHERE business_date < ?1", [limite])?;
    transaction.execute("DELETE FROM business_counters WHERE business_date < ?1", [limite])?;

    // Turnos fechados antes da data e sem nenhuma venda restante.
    transaction.execute(
        "DELETE FROM cash_movements WHERE session_id IN (
            SELECT id FROM cash_sessions cs WHERE cs.status <> 'open'
              AND substr(COALESCE(cs.closed_at, cs.opened_at), 1, 10) < ?1
              AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.cash_session_id = cs.id)
              AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.cash_session_id = cs.id))",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM cash_sessions WHERE status <> 'open'
           AND substr(COALESCE(closed_at, opened_at), 1, 10) < ?1
           AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.cash_session_id = cash_sessions.id)
           AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.cash_session_id = cash_sessions.id)",
        [limite],
    )?;

    auditar(
        &transaction,
        actor,
        "dados.limpar",
        "vendas",
        json!({ "antes_de": limite, "vendas_apagadas": apagadas }),
    )?;
    transaction.commit()?;
    Ok(apagadas)
}

fn limpar_estoque(connection: &mut Connection, actor: &LocalUser, limite: &str) -> AppResult<i64> {
    let transaction = connection.transaction()?;
    let movimentos: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM stock_movements WHERE substr(occurred_at, 1, 10) < ?1",
        [limite],
        |r| r.get(0),
    )?;
    transaction.execute(
        "DELETE FROM stock_movements WHERE substr(occurred_at, 1, 10) < ?1",
        [limite],
    )?;
    transaction.execute(
        "DELETE FROM inventory_counts WHERE substr(occurred_at, 1, 10) < ?1",
        [limite],
    )?;
    auditar(
        &transaction,
        actor,
        "dados.limpar",
        "estoque",
        json!({ "antes_de": limite, "movimentos_apagados": movimentos }),
    )?;
    transaction.commit()?;
    Ok(movimentos)
}

// ============================================================
// Apagar backup
// ============================================================

/// Remove uma cópia da pasta de backups. Só aceita arquivo que esteja mesmo
/// dentro da pasta: o caminho vem da interface, e não pode virar um
/// "apague qualquer arquivo do disco".
pub fn apagar_backup(actor: &LocalUser, app_data: &Path, caminho: &Path) -> AppResult<()> {
    require(actor, "backup.manage")?;
    let dir = backup::backup_dir(app_data)
        .canonicalize()
        .map_err(|_| AppError::NotFound)?;
    let alvo = caminho.canonicalize().map_err(|_| AppError::NotFound)?;
    if alvo.parent() != Some(dir.as_path())
        || alvo.extension().and_then(|e| e.to_str()) != Some("sqlite3")
    {
        return Err(AppError::Validation("este arquivo não é uma cópia do sistema".into()));
    }
    fs::remove_file(&alvo).map_err(io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FinalizeSaleInput, SaleItemInput};

    fn master() -> LocalUser {
        LocalUser {
            id: "u-master".into(),
            username: "master".into(),
            full_name: "Master".into(),
            whatsapp: None,
            role: "master".into(),
            permissions: vec!["backup.manage".into(), "pdv.use".into(), "credit.sell".into(), "cash.operate".into()],
            must_change_password: false,
        }
    }

    fn banco() -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute_batch(
            "INSERT INTO users (id, username, full_name, role, password_hash, active, created_at, updated_at)
             VALUES ('u-master', 'master', 'Master', 'master', 'x', 1, 'now', 'now');
             INSERT INTO products (id, code, name, category, subcategory, price_cents, stock_quantity, active, created_at, updated_at)
             VALUES ('p-agua', 'A1', 'Agua', 'Bebidas', '', 500, 100, 1, 'now', 'now');",
        )
        .unwrap();
        c
    }

    fn vende(c: &mut Connection, sufixo: &str) -> String {
        let _ = crate::cash::abrir(c, &master(), 0);
        let venda = crate::sales::finalize(
            c,
            &master(),
            FinalizeSaleInput {
                client_sale_id: format!("v-{sufixo}"),
                items: vec![SaleItemInput { product_id: "p-agua".into(), quantity: 1, credit: false }],
                cash_tendered_cents: 500,
                card_cents: 0,
                pix_cents: 0,
                discount_cents: 0,
                discount_reason: String::new(),
                customer_name: String::new(),
                credit_customer: None,
            },
        )
        .unwrap();
        venda.id
    }

    #[test]
    fn exporta_e_reimporta_a_area_de_estoque() {
        let mut origem = banco();
        let pasta = std::env::temp_dir().join(format!("k7-dados-{}", Uuid::new_v4()));
        fs::create_dir_all(&pasta).unwrap();

        let arquivo = exportar(&origem, &master(), Area::Estoque, &pasta).unwrap();
        assert!(arquivo.linhas >= 1);
        assert_eq!(inspecionar(Path::new(&arquivo.path)).unwrap(), Area::Estoque);

        // Muda o preço aqui, importa, e o preço volta ao do arquivo.
        origem.execute("UPDATE products SET price_cents = 999 WHERE id = 'p-agua'", []).unwrap();
        let resumo = importar(&mut origem, &master(), Path::new(&arquivo.path)).unwrap();
        assert_eq!(resumo.area, Area::Estoque);
        let preco: i64 = origem
            .query_row("SELECT price_cents FROM products WHERE id = 'p-agua'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(preco, 500);
        let _ = fs::remove_dir_all(&pasta);
    }

    #[test]
    fn limpar_vendas_apaga_so_o_que_e_anterior_a_data_e_grava_backup() {
        let mut c = banco();
        let antiga = vende(&mut c, "antiga");
        let recente = vende(&mut c, "recente");
        c.execute("UPDATE sales SET business_date = '2020-01-10' WHERE id = ?1", [&antiga]).unwrap();

        let app_data = std::env::temp_dir().join(format!("k7-app-{}", Uuid::new_v4()));
        fs::create_dir_all(&app_data).unwrap();

        let resumo = limpar(&mut c, &master(), Area::Vendas, "2021-01-01", &app_data).unwrap();
        assert_eq!(resumo.apagadas, 1);
        assert!(Path::new(&resumo.backup.path).exists(), "backup pre-limpeza gravado");

        let restam: Vec<String> = c
            .prepare("SELECT id FROM sales")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(restam, vec![recente]);
        let itens: i64 = c.query_row("SELECT COUNT(*) FROM sale_items", [], |r| r.get(0)).unwrap();
        assert_eq!(itens, 1, "itens da venda antiga foram junto");
        let _ = fs::remove_dir_all(&app_data);
    }

    #[test]
    fn quem_nao_e_master_nao_limpa_nem_importa() {
        let mut c = banco();
        let mut gerente = master();
        gerente.role = "gerente".into();
        let app_data = std::env::temp_dir();
        assert!(matches!(
            limpar(&mut c, &gerente, Area::Vendas, "2021-01-01", &app_data),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn so_apaga_backup_de_dentro_da_pasta() {
        let app_data = std::env::temp_dir().join(format!("k7-bk-{}", Uuid::new_v4()));
        fs::create_dir_all(backup::backup_dir(&app_data)).unwrap();
        let fora = app_data.join("outro.sqlite3");
        fs::write(&fora, b"x").unwrap();
        assert!(apagar_backup(&master(), &app_data, &fora).is_err());
        assert!(fora.exists());

        let dentro = backup::backup_dir(&app_data).join("k7-manual-1.sqlite3");
        fs::write(&dentro, b"x").unwrap();
        apagar_backup(&master(), &app_data, &dentro).unwrap();
        assert!(!dentro.exists());
        let _ = fs::remove_dir_all(&app_data);
    }
}
