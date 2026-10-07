use std::{fs, path::Path};

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{LocalUser, TemplateResumo},
};

/// Formato do arquivo. Subir a versão obriga a tratar compatibilidade na leitura.
const FORMATO: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct Modelo {
    pub formato: u32,
    pub exportado_em: String,
    pub origem_instalacao: String,
    pub origem_loja: String,
    pub produtos: Vec<ProdutoModelo>,
    /// Categorias e subcategorias com cor, ordem e "piscar". Ausente em
    /// modelos antigos: aí o importador só cria o que o produto cita.
    #[serde(default)]
    pub categorias: Vec<CategoriaModelo>,
    pub cupom: CupomModelo,
    pub papeis: Vec<PapelModelo>,
    pub usuarios: Vec<UsuarioModelo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProdutoModelo {
    pub code: String,
    pub name: String,
    pub category: String,
    pub subcategory: String,
    pub price_cents: i64,
    pub cost_cents: i64,
    pub barcode: Option<String>,
    pub min_stock: i64,
    /// Unidade de medida. Modelo antigo não traz: fica "UN".
    #[serde(default = "unidade_padrao")]
    pub unit: String,
    /// Piscar na venda, ligado no próprio produto.
    #[serde(default)]
    pub highlight: bool,
}

fn unidade_padrao() -> String {
    "UN".into()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategoriaModelo {
    pub name: String,
    /// Nome da categoria mãe, quando é subcategoria.
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub highlight: bool,
}

/// Só o que é igual em toda loja. Nome, cidade e chave PIX ficam de fora
/// de propósito: são a identidade de cada uma.
#[derive(Debug, Serialize, Deserialize)]
pub struct CupomModelo {
    pub fiscal_label: String,
    pub footer_message: String,
    pub show_chapelaria: bool,
    pub chapelaria_label: String,
    pub show_datetime: bool,
    pub show_operator: bool,
    pub operator_label: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PapelModelo {
    pub key: String,
    pub name: String,
    pub description: String,
    pub is_system: bool,
    pub is_master: bool,
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsuarioModelo {
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub password_hash: String,
    pub permissions: Vec<String>,
}

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn io(error: std::io::Error) -> AppError {
    AppError::Internal(error.to_string())
}

/// Exporta o que é comum a todas as lojas.
///
/// Não leva venda, caixa, estoque, lote nem auditoria: esses são a operação de
/// cada loja e misturá-los faria uma loja exibir o faturamento da outra.
/// O que levar para a outra loja.
///
/// Nem toda loja irmã quer o mesmo: às vezes só o catálogo, às vezes só os
/// perfis de acesso. Exportar tudo sempre obrigava a apagar à mão o que não
/// devia viajar.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Selecao {
    #[serde(default = "sim")]
    pub produtos: bool,
    #[serde(default = "sim")]
    pub cupom: bool,
    #[serde(default = "sim")]
    pub papeis: bool,
    #[serde(default = "sim")]
    pub usuarios: bool,
}

fn sim() -> bool {
    true
}

impl Default for Selecao {
    fn default() -> Self {
        Self { produtos: true, cupom: true, papeis: true, usuarios: true }
    }
}

impl Selecao {
    fn vazia(&self) -> bool {
        !self.produtos && !self.cupom && !self.papeis && !self.usuarios
    }
}

pub fn exportar(connection: &Connection, actor: &LocalUser, destino: &Path) -> AppResult<Modelo> {
    exportar_selecao(connection, actor, destino, Selecao::default())
}

pub fn exportar_selecao(
    connection: &Connection,
    actor: &LocalUser,
    destino: &Path,
    selecao: Selecao,
) -> AppResult<Modelo> {
    if selecao.vazia() {
        return Err(AppError::Validation(
            "escolha ao menos uma parte para exportar".into(),
        ));
    }
    exportar_interno(connection, actor, destino, selecao)
}

fn exportar_interno(
    connection: &Connection,
    actor: &LocalUser,
    destino: &Path,
    selecao: Selecao,
) -> AppResult<Modelo> {
    require(actor, "users.manage")?;

    let (origem_instalacao, origem_loja): (String, String) = connection.query_row(
        "SELECT installation_id, store_name FROM installation WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let produtos = if !selecao.produtos { Vec::new() } else {
        let mut st = connection.prepare(
            "SELECT code, name, category, subcategory, price_cents, cost_cents, barcode, min_stock,
                    unit, highlight
             FROM products WHERE active = 1 ORDER BY code",
        )?;
        let linhas = st.query_map([], |row| {
            Ok(ProdutoModelo {
                code: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                subcategory: row.get(3)?,
                price_cents: row.get(4)?,
                cost_cents: row.get(5)?,
                barcode: row.get(6)?,
                min_stock: row.get(7)?,
                unit: row.get(8)?,
                highlight: row.get(9)?,
            })
        })?;
        linhas.collect::<Result<Vec<_>, _>>()?
    };

    let categorias = if !selecao.produtos { Vec::new() } else {
        let mut st = connection.prepare(
            "SELECT c.name, pai.name, c.color, c.sort_order, c.highlight
             FROM categories c LEFT JOIN categories pai ON pai.id = c.parent_id
             WHERE c.active = 1
             ORDER BY c.parent_id IS NOT NULL, c.sort_order, c.name COLLATE NOCASE",
        )?;
        let linhas = st.query_map([], |row| {
            Ok(CategoriaModelo {
                name: row.get(0)?,
                parent: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get(3)?,
                highlight: row.get(4)?,
            })
        })?;
        linhas.collect::<Result<Vec<_>, _>>()?
    };

    // Cupom não selecionado viaja como o padrão de fábrica, que a loja destino
    // simplesmente não aplica: o importador só grava o que veio preenchido.
    let cupom = if !selecao.cupom {
        CupomModelo {
            fiscal_label: String::new(),
            footer_message: String::new(),
            show_chapelaria: true,
            chapelaria_label: String::new(),
            show_datetime: true,
            show_operator: true,
            operator_label: String::new(),
        }
    } else {
        connection.query_row(
        "SELECT fiscal_label, footer_message, show_chapelaria, chapelaria_label,
                show_datetime, show_operator, operator_label
         FROM ticket_settings WHERE id = 1",
        [],
        |row| {
            Ok(CupomModelo {
                fiscal_label: row.get(0)?,
                footer_message: row.get(1)?,
                show_chapelaria: row.get(2)?,
                chapelaria_label: row.get(3)?,
                show_datetime: row.get(4)?,
                show_operator: row.get(5)?,
                operator_label: row.get(6)?,
            })
        },
        )?
    };

    let papeis = if !selecao.papeis { Vec::new() } else {
        let mut st = connection
            .prepare("SELECT key, name, description, is_system, is_master FROM roles ORDER BY key")?;
        let base = st
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for (key, name, description, is_system, is_master) in base {
            let mut ps = connection
                .prepare("SELECT permission FROM role_permissions WHERE role_key = ?1 ORDER BY 1")?;
            let permissions = ps
                .query_map(params![key], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            out.push(PapelModelo { key, name, description, is_system, is_master, permissions });
        }
        out
    };

    // A conta permanente de cada loja é dela: nunca viaja.
    let usuarios = if !selecao.usuarios { Vec::new() } else {
        let mut st = connection.prepare(
            "SELECT id, username, full_name, role, password_hash
             FROM users WHERE active = 1 AND is_permanent = 0 ORDER BY username",
        )?;
        let base = st
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for (id, username, full_name, role, password_hash) in base {
            let mut ps = connection
                .prepare("SELECT permission FROM user_permissions WHERE user_id = ?1 ORDER BY 1")?;
            let permissions = ps
                .query_map(params![id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            out.push(UsuarioModelo { username, full_name, role, password_hash, permissions });
        }
        out
    };

    let modelo = Modelo {
        formato: FORMATO,
        exportado_em: Utc::now().to_rfc3339(),
        origem_instalacao,
        origem_loja,
        produtos,
        categorias,
        cupom,
        papeis,
        usuarios,
    };

    // TOML porque este arquivo é para pessoa: quem leva o catálogo para outra
    // loja costuma querer abrir e conferir antes. Aceita comentário — o
    // cabeçalho abaixo explica o arquivo dentro dele mesmo — e uma linha
    // alterada aparece sozinha num diff, ao contrário do JSON de uma linha só.
    //
    // O backup continua sendo o SQLite copiado com VACUUM INTO: lá o que
    // importa é integridade verificável, não leitura humana.
    let corpo = toml::to_string_pretty(&modelo)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let cabecalho = format!(
        "# Modelo de loja do K7Cabines PDV\n\
         #\n\
         # Leva catálogo, cupom, perfis e contas para outra loja.\n\
         # NÃO leva vendas, turnos, estoque nem lotes: cada loja é independente.\n\
         #\n\
         # Exportado da loja \"{}\" em {}.\n\
         # Dá para editar à mão antes de importar; mantenha o campo `formato`.\n\n",
        modelo.origem_loja, modelo.exportado_em
    );

    if let Some(pai) = destino.parent() {
        fs::create_dir_all(pai).map_err(io)?;
    }
    fs::write(destino, format!("{cabecalho}{corpo}")).map_err(io)?;
    Ok(modelo)
}

pub fn ler(origem: &Path) -> AppResult<Modelo> {
    let bruto = fs::read_to_string(origem)
        .map_err(|_| AppError::Validation("arquivo de modelo não encontrado".into()))?;
    // Modelos exportados antes da mudança são JSON. Ler os dois evita obrigar
    // quem já exportou a refazer o arquivo.
    let modelo: Modelo = match toml::from_str(&bruto) {
        Ok(m) => m,
        Err(erro_toml) => serde_json::from_str(&bruto).map_err(|_| {
            AppError::Validation(format!(
                "o arquivo não é um modelo de loja válido: {}",
                erro_toml.message()
            ))
        })?,
    };
    if modelo.formato > FORMATO {
        return Err(AppError::Validation(format!(
            "o modelo usa formato {} e este aplicativo lê até o {FORMATO}",
            modelo.formato
        )));
    }
    Ok(modelo)
}

/// Aplica o modelo mesclando por código.
///
/// Produto que já existe é atualizado; o que falta é criado com estoque zero.
/// Saldo de estoque e lotes nunca são tocados — são a contagem física desta
/// loja, e um arquivo vindo de fora não pode alterá-la.
pub fn importar(
    connection: &mut Connection,
    actor: &LocalUser,
    origem: &Path,
) -> AppResult<TemplateResumo> {
    require(actor, "users.manage")?;
    let modelo = ler(origem)?;
    let now = Utc::now().to_rfc3339();

    let mut criados = 0i64;
    let mut atualizados = 0i64;
    let mut contas = 0i64;
    let mut papeis_aplicados = 0i64;

    let transaction = connection.transaction()?;

    // Categorias primeiro: raízes, depois subcategorias, para a mãe já existir.
    for c in modelo.categorias.iter().filter(|c| c.parent.is_none())
        .chain(modelo.categorias.iter().filter(|c| c.parent.is_some()))
    {
        let pai_id: Option<String> = match &c.parent {
            Some(nome_pai) => transaction
                .query_row(
                    "SELECT id FROM categories WHERE parent_id IS NULL AND name = ?1 COLLATE NOCASE",
                    params![nome_pai],
                    |row| row.get(0),
                )
                .ok(),
            None => None,
        };
        let existente: Option<String> = transaction
            .query_row(
                "SELECT id FROM categories WHERE name = ?1 COLLATE NOCASE
                   AND ((?2 IS NULL AND parent_id IS NULL) OR parent_id = ?2)",
                params![c.name, pai_id],
                |row| row.get(0),
            )
            .ok();
        match existente {
            Some(id) => {
                transaction.execute(
                    "UPDATE categories SET color = ?1, sort_order = ?2, highlight = ?3, active = 1,
                            updated_at = ?4 WHERE id = ?5",
                    params![c.color, c.sort_order, c.highlight, now, id],
                )?;
            }
            None => {
                transaction.execute(
                    "INSERT INTO categories (id, name, parent_id, color, sort_order, active, highlight,
                                             created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?7)",
                    params![Uuid::new_v4().to_string(), c.name, pai_id, c.color, c.sort_order,
                            c.highlight, now],
                )?;
            }
        }
    }

    for p in &modelo.produtos {
        let categoria_id: Option<String> = transaction
            .query_row(
                "SELECT id FROM categories WHERE parent_id IS NULL AND name = ?1 COLLATE NOCASE",
                params![p.category],
                |row| row.get(0),
            )
            .ok();
        let existente: Option<String> = transaction
            .query_row(
                "SELECT id FROM products WHERE code = ?1 COLLATE NOCASE",
                params![p.code],
                |row| row.get(0),
            )
            .ok();

        match existente {
            Some(id) => {
                transaction.execute(
                    "UPDATE products
                     SET name = ?1, category = ?2, subcategory = ?3, price_cents = ?4,
                         cost_cents = ?5, barcode = COALESCE(?6, barcode), min_stock = ?7,
                         unit = ?10, highlight = ?11, category_id = COALESCE(?12, category_id),
                         active = 1, revision = revision + 1, updated_at = ?8
                     WHERE id = ?9",
                    params![
                        p.name, p.category, p.subcategory, p.price_cents, p.cost_cents,
                        p.barcode, p.min_stock, now, id, p.unit, p.highlight, categoria_id
                    ],
                )?;
                atualizados += 1;
            }
            None => {
                transaction.execute(
                    "INSERT INTO products (id, code, name, category, subcategory, price_cents,
                                           cost_cents, barcode, min_stock, stock_quantity, active,
                                           unit, highlight, category_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 1, ?11, ?12, ?13, ?10, ?10)",
                    params![
                        Uuid::new_v4().to_string(), p.code, p.name, p.category, p.subcategory,
                        p.price_cents, p.cost_cents, p.barcode, p.min_stock, now,
                        p.unit, p.highlight, categoria_id
                    ],
                )?;
                criados += 1;
            }
        }
    }

    // Cupom: só o que é comum. Nome da loja e endereço seguem sendo desta loja.
    //
    // Modelo exportado sem o cupom chega com os rótulos vazios; aplicá-los
    // apagaria os da loja destino, então nesse caso o bloco é pulado.
    let traz_cupom = !modelo.cupom.fiscal_label.trim().is_empty()
        || !modelo.cupom.footer_message.trim().is_empty()
        || !modelo.cupom.chapelaria_label.trim().is_empty()
        || !modelo.cupom.operator_label.trim().is_empty();
    if traz_cupom {
    transaction.execute(
        "UPDATE ticket_settings
         SET fiscal_label = ?1, footer_message = ?2, show_chapelaria = ?3, chapelaria_label = ?4,
             show_datetime = ?5, show_operator = ?6, operator_label = ?7, updated_at = ?8
         WHERE id = 1",
        params![
            modelo.cupom.fiscal_label, modelo.cupom.footer_message, modelo.cupom.show_chapelaria,
            modelo.cupom.chapelaria_label, modelo.cupom.show_datetime, modelo.cupom.show_operator,
            modelo.cupom.operator_label, now
        ],
    )?;
    }

    for papel in &modelo.papeis {
        transaction.execute(
            "INSERT INTO roles (key, name, description, is_system, is_master, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 100, ?6)
             ON CONFLICT(key) DO UPDATE SET name = ?2, description = ?3",
            params![papel.key, papel.name, papel.description, papel.is_system, papel.is_master, now],
        )?;
        transaction.execute(
            "DELETE FROM role_permissions WHERE role_key = ?1",
            params![papel.key],
        )?;
        for perm in &papel.permissions {
            transaction.execute(
                "INSERT OR IGNORE INTO role_permissions (role_key, permission) VALUES (?1, ?2)",
                params![papel.key, perm],
            )?;
        }
        papeis_aplicados += 1;
    }

    for u in &modelo.usuarios {
        // Conta já existente nesta loja não é sobrescrita: a senha local vale.
        let ja_existe: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = ?1 COLLATE NOCASE)",
            params![u.username],
            |row| row.get(0),
        )?;
        if ja_existe {
            continue;
        }
        let id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO users (id, username, password_hash, full_name, whatsapp, role, active,
                                is_permanent, must_change_password, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, 1, 0, 1, ?6, ?6)",
            params![id, u.username, u.password_hash, u.full_name, u.role, now],
        )?;
        for perm in &u.permissions {
            transaction.execute(
                "INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?1, ?2)",
                params![id, perm],
            )?;
        }
        contas += 1;
    }

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'template.import', 'installation', '1', ?3, ?4)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            serde_json::json!({
                "origem_loja": modelo.origem_loja,
                "origem_instalacao": modelo.origem_instalacao,
                "produtos_criados": criados,
                "produtos_atualizados": atualizados,
                "contas_criadas": contas,
            })
            .to_string(),
            now
        ],
    )?;

    transaction.commit()?;

    Ok(TemplateResumo {
        origem_loja: modelo.origem_loja,
        produtos_criados: criados,
        produtos_atualizados: atualizados,
        contas_criadas: contas,
        papeis_aplicados,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

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

    fn loja(nome: &str) -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute("UPDATE installation SET store_name = ?1, setup_completed = 1", params![nome])
            .unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, is_permanent, created_at, updated_at)
             VALUES ('m1','master','hash-master','Master','master',1,1,'now','now')", []).unwrap();
        c
    }

    #[test]
    fn modelo_leva_catalogo_e_nao_leva_operacao() {
        let origem = loja("Loja A");
        origem.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents,
                                   stock_quantity, min_stock, active, created_at, updated_at)
             VALUES ('p1','258','Brahma','Bebidas','Brahma',1000,600,219,10,1,'now','now')", []).unwrap();
        origem.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, is_permanent, created_at, updated_at)
             VALUES ('u1','joao','hash-joao','João','atendente',1,0,'now','now')", []).unwrap();

        let dir = tempdir().unwrap();
        let arquivo = dir.path().join("modelo.json");
        let modelo = exportar(&origem, &master(), &arquivo).unwrap();

        assert_eq!(modelo.produtos.len(), 1);
        assert_eq!(modelo.produtos[0].cost_cents, 600);
        assert_eq!(modelo.usuarios.len(), 1, "a conta permanente não viaja");
        assert_eq!(modelo.usuarios[0].username, "joao");

        let bruto = fs::read_to_string(&arquivo).unwrap();
        assert!(!bruto.contains("219"), "saldo de estoque não entra no modelo");
        // O arquivo é TOML comentado: quem abre precisa entender o que é.
        assert!(bruto.starts_with("# Modelo de loja"));
        assert!(bruto.contains("NÃO leva vendas"));
        assert!(!bruto.trim_start().starts_with('{'), "não é mais JSON");
        // E volta a ser lido como modelo.
        let relido = ler(&arquivo).unwrap();
        assert_eq!(relido.produtos.len(), 1);
        assert_eq!(relido.produtos[0].code, modelo.produtos[0].code);
        assert_eq!(relido.formato, modelo.formato);
        drop(origem);
    }

    /// Exportar só o catálogo não pode levar contas nem perfis junto.
    #[test]
    fn exportacao_seletiva_leva_so_o_que_foi_escolhido() {
        let origem = loja("Loja A");
        origem.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents,
                                   stock_quantity, min_stock, active, created_at, updated_at)
             VALUES ('p1','258','Brahma','Bebidas','',1200,600,9,0,1,'now','now')", []).unwrap();
        origem.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, is_permanent, created_at, updated_at)
             VALUES ('u1','joao','hash','João','atendente',1,0,'now','now')", []).unwrap();

        let dir = tempdir().unwrap();
        let arquivo = dir.path().join("so-catalogo.toml");
        let modelo = exportar_selecao(&origem, &master(), &arquivo, Selecao {
            produtos: true, cupom: false, papeis: false, usuarios: false,
        }).unwrap();

        assert_eq!(modelo.produtos.len(), 1);
        assert!(modelo.usuarios.is_empty(), "conta não pode viajar sem ser pedida");
        assert!(modelo.papeis.is_empty());
        assert!(modelo.cupom.fiscal_label.is_empty());
        drop(origem);
    }

    /// Sem cupom no modelo, o cupom da loja destino fica como estava.
    #[test]
    fn importar_modelo_sem_cupom_preserva_o_cupom_da_loja() {
        let origem = loja("Loja A");
        let dir = tempdir().unwrap();
        let arquivo = dir.path().join("sem-cupom.toml");
        exportar_selecao(&origem, &master(), &arquivo, Selecao {
            produtos: true, cupom: false, papeis: false, usuarios: false,
        }).unwrap();

        let mut destino = loja("Loja B");
        destino.execute(
            "UPDATE ticket_settings SET footer_message = 'Volte sempre, Loja B'", []).unwrap();
        importar(&mut destino, &master(), &arquivo).unwrap();

        let rodape: String = destino.query_row(
            "SELECT footer_message FROM ticket_settings WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(rodape, "Volte sempre, Loja B");
        drop(origem);
    }

    /// Modelo exportado antes da mudança de formato continua importável.
    #[test]
    fn modelo_antigo_em_json_ainda_e_lido() {
        let origem = loja("Loja A");
        origem.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents,
                                   stock_quantity, min_stock, active, created_at, updated_at)
             VALUES ('p1','258','Brahma','Bebidas','',1200,600,9,0,1,'now','now')", []).unwrap();
        let dir = tempdir().unwrap();
        let toml_path = dir.path().join("modelo.toml");
        let modelo = exportar(&origem, &master(), &toml_path).unwrap();

        let json_path = dir.path().join("antigo.json");
        fs::write(&json_path, serde_json::to_string_pretty(&modelo).unwrap()).unwrap();

        let relido = ler(&json_path).unwrap();
        assert_eq!(relido.produtos.len(), 1);
        assert_eq!(relido.produtos[0].code, "258");
        drop(origem);
    }

    #[test]
    fn arquivo_que_nao_e_modelo_explica_o_erro() {
        let dir = tempdir().unwrap();
        let lixo = dir.path().join("qualquer.toml");
        fs::write(&lixo, "isto = \"nao e um modelo\"").unwrap();
        assert!(matches!(ler(&lixo), Err(AppError::Validation(_))));
    }

    #[test]
    fn importar_mescla_por_codigo_sem_tocar_no_estoque() {
        let origem = loja("Loja A");
        origem.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents,
                                   stock_quantity, min_stock, active, created_at, updated_at)
             VALUES ('p1','258','Brahma Latão','Bebidas','Brahma',1200,700,50,10,1,'now','now'),
                    ('p2','999','Novidade','Bebidas','',500,300,7,0,1,'now','now')", []).unwrap();
        let dir = tempdir().unwrap();
        let arquivo = dir.path().join("modelo.json");
        exportar(&origem, &master(), &arquivo).unwrap();

        let mut destino = loja("Loja B");
        destino.execute(
            "INSERT INTO products (id, code, name, category, subcategory, price_cents, cost_cents,
                                   stock_quantity, min_stock, active, created_at, updated_at)
             VALUES ('x1','258','Brahma','Bebidas','',1000,0,88,0,1,'now','now'),
                    ('x2','777','Só da Loja B','Bebidas','',300,0,12,0,1,'now','now')", []).unwrap();

        let resumo = importar(&mut destino, &master(), &arquivo).unwrap();
        assert_eq!(resumo.produtos_atualizados, 1);
        assert_eq!(resumo.produtos_criados, 1);

        // O produto comum recebeu preço e custo, mas manteve o estoque da loja.
        let (preco, custo, estoque): (i64, i64, i64) = destino.query_row(
            "SELECT price_cents, cost_cents, stock_quantity FROM products WHERE code='258'", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((preco, custo, estoque), (1200, 700, 88));

        // O que só existe na loja de destino permanece.
        let sobrou: i64 = destino.query_row(
            "SELECT stock_quantity FROM products WHERE code='777'", [], |r| r.get(0)).unwrap();
        assert_eq!(sobrou, 12);

        // O produto novo entra zerado: quem conta o físico é a loja.
        let novo: i64 = destino.query_row(
            "SELECT stock_quantity FROM products WHERE code='999'", [], |r| r.get(0)).unwrap();
        assert_eq!(novo, 0);
    }

    #[test]
    fn importar_nao_sobrescreve_conta_existente_nem_o_master_local() {
        let origem = loja("Loja A");
        origem.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, is_permanent, created_at, updated_at)
             VALUES ('u1','joao','hash-A','João da Loja A','atendente',1,0,'now','now')", []).unwrap();
        let dir = tempdir().unwrap();
        let arquivo = dir.path().join("modelo.json");
        exportar(&origem, &master(), &arquivo).unwrap();

        let mut destino = loja("Loja B");
        destino.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, is_permanent, created_at, updated_at)
             VALUES ('u9','joao','hash-B','João da Loja B','atendente',1,0,'now','now')", []).unwrap();

        importar(&mut destino, &master(), &arquivo).unwrap();

        let hash: String = destino.query_row(
            "SELECT password_hash FROM users WHERE username='joao'", [], |r| r.get(0)).unwrap();
        assert_eq!(hash, "hash-B", "a senha local nunca é sobrescrita");

        let master_hash: String = destino.query_row(
            "SELECT password_hash FROM users WHERE username='master'", [], |r| r.get(0)).unwrap();
        assert_eq!(master_hash, "hash-master", "o master da loja continua o dela");
    }

    #[test]
    fn recusa_arquivo_invalido_e_exige_permissao() {
        let dir = tempdir().unwrap();
        let lixo = dir.path().join("qualquer.json");
        fs::write(&lixo, "{\"isto\": \"não é um modelo\"}").unwrap();
        assert!(matches!(ler(&lixo), Err(AppError::Validation(_))));

        let mut destino = loja("Loja B");
        let mut sem = master();
        sem.permissions.clear();
        assert!(matches!(
            importar(&mut destino, &sem, &lixo),
            Err(AppError::Forbidden)
        ));
    }
}
