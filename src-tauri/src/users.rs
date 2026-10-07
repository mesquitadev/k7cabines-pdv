use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::{
    auth,
    error::{AppError, AppResult},
    models::{
        CreateUserInput, LocalUser, ManagedUser, PermissionInfo, Role, RoleInput, UpdateUserInput,
    },
};

/// As 16 permissões do legado, na ordem em que a tela as exibe.
/// A chave da esquerda é o nome usado no React (`access_*`).
pub const ACCESS_MAP: &[(&str, &str)] = &[
    ("access_pdv", "pdv.use"),
    ("access_estoque", "stock.view"),
    ("access_relatorios", "reports.view"),
    ("access_impressora", "printer.manage"),
    ("access_usuarios", "users.manage"),
    ("access_rel_vendas", "reports.sales"),
    ("access_rel_hora", "reports.hourly"),
    ("access_rel_categorias", "reports.categories"),
    ("access_rel_estoque", "reports.stock"),
    ("access_rel_fechamento", "reports.closing"),
    ("access_est_lotes", "stock.batches"),
    ("access_est_novo", "stock.create"),
    ("access_est_add", "stock.add"),
    ("access_est_remove", "stock.remove"),
    ("access_est_edit", "stock.edit"),
    ("access_est_delete", "stock.delete"),
];

/// Gerir contas é exclusivo de quem tem a permissão, que por padrão só o
/// papel master carrega. Não há cadastro self-service em lugar nenhum.
fn require_manager(actor: &LocalUser) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == "users.manage") {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

pub fn list_roles(connection: &Connection) -> AppResult<Vec<Role>> {
    let mut statement = connection.prepare(
        "SELECT key, name, description, is_system, is_master, history_days FROM roles ORDER BY sort_order, name",
    )?;
    let base = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut out = Vec::with_capacity(base.len());
    for (key, name, description, is_system, is_master, history_days) in base {
        // O master carrega o catálogo inteiro; os demais, o que o papel concede.
        let sql = if is_master {
            "SELECT key FROM permissions ORDER BY key"
        } else {
            "SELECT permission FROM role_permissions WHERE role_key = ?1 ORDER BY permission"
        };
        let mut ps = connection.prepare(sql)?;
        let permissions = if is_master {
            ps.query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            ps.query_map(params![key], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        let user_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM users WHERE role = ?1 AND active = 1",
            params![key],
            |row| row.get(0),
        )?;
        out.push(Role { key, name, description, is_system, is_master, permissions, user_count, history_days });
    }
    Ok(out)
}

/// Chave a partir do nome: minúscula, sem acento, com hífen.
///
/// A chave é o que fica gravado em `users.role` e no histórico, então ela nasce
/// do nome e nunca muda depois — renomear "Conferente" para "Estoquista" não
/// pode reescrever o passado de quem já era conferente.
fn chave_de(nome: &str) -> String {
    let sem_acento: String = nome
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'ê' | 'ë' => 'e',
            'í' | 'ï' => 'i',
            'ó' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ü' => 'u',
            'ç' => 'c',
            outro => outro,
        })
        .collect();
    let bruta: String = sem_acento
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    bruta
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(40)
        .collect()
}

fn valida_papel(connection: &Connection, input: &RoleInput) -> AppResult<String> {
    let nome = input.name.trim();
    if nome.chars().count() < 3 {
        return Err(AppError::Validation(
            "o nome do perfil precisa de pelo menos 3 caracteres".into(),
        ));
    }
    if nome.chars().count() > 40 {
        return Err(AppError::Validation("o nome do perfil é longo demais".into()));
    }
    if input.permissions.is_empty() {
        return Err(AppError::Validation(
            "um perfil sem nenhuma permissão não deixa a pessoa fazer nada; marque ao menos uma"
                .into(),
        ));
    }
    // Permissão inventada não entra: o banco aceitaria a linha e a chave nunca
    // casaria com nada no código.
    let mut st = connection.prepare("SELECT key FROM permissions")?;
    let catalogo: Vec<String> = st
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    if let Some(desconhecida) = input.permissions.iter().find(|p| !catalogo.contains(p)) {
        return Err(AppError::Validation(format!(
            "permissão desconhecida: {desconhecida}"
        )));
    }
    Ok(nome.to_string())
}

/// Grava o conjunto de permissões do papel, substituindo o que havia.
fn grava_permissoes(
    transaction: &rusqlite::Transaction<'_>,
    chave: &str,
    permissoes: &[String],
) -> AppResult<()> {
    transaction.execute(
        "DELETE FROM role_permissions WHERE role_key = ?1",
        params![chave],
    )?;
    for permissao in permissoes {
        transaction.execute(
            "INSERT OR IGNORE INTO role_permissions (role_key, permission) VALUES (?1, ?2)",
            params![chave, permissao],
        )?;
    }
    Ok(())
}

/// Dias de histórico: 0 é "tudo"; acima de 10 anos não faz sentido no balcão.
fn valida_historico(dias: i64) -> AppResult<i64> {
    if !(0..=3650).contains(&dias) {
        return Err(AppError::Validation(
            "dias de histórico deve ficar entre 0 (tudo) e 3650".into(),
        ));
    }
    Ok(dias)
}

pub fn create_role(
    connection: &mut Connection,
    actor: &LocalUser,
    input: RoleInput,
) -> AppResult<Role> {
    require_manager(actor)?;
    let nome = valida_papel(connection, &input)?;
    let history_days = valida_historico(input.history_days)?;
    let chave = chave_de(&nome);
    if chave.is_empty() {
        return Err(AppError::Validation(
            "o nome do perfil precisa ter letras ou números".into(),
        ));
    }
    let agora = Utc::now().to_rfc3339();

    let transaction = connection.transaction()?;
    let ordem: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(sort_order), 100) + 10 FROM roles",
        [],
        |row| row.get(0),
    )?;
    transaction
        .execute(
            "INSERT INTO roles (key, name, description, is_system, is_master, sort_order, created_at, history_days)
             VALUES (?1, ?2, ?3, 0, 0, ?4, ?5, ?6)",
            params![chave, nome, input.description.trim(), ordem, agora, history_days],
        )
        .map_err(|erro| match erro {
            rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 1555 => {
                AppError::Conflict("já existe um perfil com esse nome".into())
            }
            outro => AppError::Database(outro),
        })?;
    grava_permissoes(&transaction, &chave, &input.permissions)?;
    crate::stock::audit(
        &transaction,
        actor,
        "role.create",
        &chave,
        serde_json::json!({ "name": nome, "permissions": input.permissions }),
        &agora,
    )?;
    transaction.commit()?;

    list_roles(connection)?
        .into_iter()
        .find(|r| r.key == chave)
        .ok_or(AppError::NotFound)
}

pub fn update_role(
    connection: &mut Connection,
    actor: &LocalUser,
    role_key: &str,
    input: RoleInput,
) -> AppResult<Role> {
    require_manager(actor)?;
    let nome = valida_papel(connection, &input)?;
    let history_days = valida_historico(input.history_days)?;
    let agora = Utc::now().to_rfc3339();

    let (is_system, is_master): (bool, bool) = connection
        .query_row(
            "SELECT is_system, is_master FROM roles WHERE key = ?1",
            params![role_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    // O master carrega o catálogo inteiro por definição. Editá-lo seria criar
    // um estado em que a loja pode ficar sem ninguém capaz de administrar.
    if is_master {
        return Err(AppError::Validation(
            "o perfil Master tem todas as permissões por definição e não é editável".into(),
        ));
    }

    let transaction = connection.transaction()?;
    // Papel de sistema mantém nome e descrição; só as permissões mudam.
    if !is_system {
        transaction
            .execute(
                "UPDATE roles SET name = ?1, description = ?2 WHERE key = ?3",
                params![nome, input.description.trim(), role_key],
            )
            .map_err(|erro| match erro {
                rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 1555 => {
                    AppError::Conflict("já existe um perfil com esse nome".into())
                }
                outro => AppError::Database(outro),
            })?;
    }
    // O limite de histórico vale também para papel de sistema (Atendente).
    transaction.execute(
        "UPDATE roles SET history_days = ?1 WHERE key = ?2",
        params![history_days, role_key],
    )?;
    grava_permissoes(&transaction, role_key, &input.permissions)?;
    crate::stock::audit(
        &transaction,
        actor,
        "role.update",
        role_key,
        serde_json::json!({ "permissions": input.permissions, "history_days": history_days }),
        &agora,
    )?;
    transaction.commit()?;

    list_roles(connection)?
        .into_iter()
        .find(|r| r.key == role_key)
        .ok_or(AppError::NotFound)
}

pub fn delete_role(connection: &mut Connection, actor: &LocalUser, role_key: &str) -> AppResult<()> {
    require_manager(actor)?;
    let agora = Utc::now().to_rfc3339();

    let (is_system, is_master): (bool, bool) = connection
        .query_row(
            "SELECT is_system, is_master FROM roles WHERE key = ?1",
            params![role_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    if is_system || is_master {
        return Err(AppError::Validation(
            "perfis de sistema não são excluídos; ajuste as permissões deles".into(),
        ));
    }
    let em_uso: i64 = connection.query_row(
        "SELECT COUNT(*) FROM users WHERE role = ?1 AND active = 1",
        params![role_key],
        |row| row.get(0),
    )?;
    if em_uso > 0 {
        return Err(AppError::Validation(format!(
            "{em_uso} conta(s) usam este perfil; mova essas pessoas para outro antes de excluir"
        )));
    }

    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM role_permissions WHERE role_key = ?1",
        params![role_key],
    )?;
    transaction.execute("DELETE FROM roles WHERE key = ?1", params![role_key])?;
    crate::stock::audit(
        &transaction,
        actor,
        "role.delete",
        role_key,
        serde_json::json!({}),
        &agora,
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn list_permissions(connection: &Connection) -> AppResult<Vec<PermissionInfo>> {
    let mut statement = connection
        .prepare("SELECT key, grupo, rotulo, descricao FROM permissions ORDER BY sort_order, key")?;
    let rows = statement.query_map([], |row| {
        Ok(PermissionInfo {
            key: row.get(0)?,
            grupo: row.get(1)?,
            rotulo: row.get(2)?,
            descricao: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Papel válido é o que existe na tabela `roles`.
///
/// Antes esta função tinha os três nomes do legado escritos à mão, o que fazia
/// qualquer perfil novo ser recusado como "função inválida" na hora de atribuir
/// a um usuário — o cadastro de perfis existiria e não serviria para nada.
///
/// O master fica de fora: é o papel permanente do sistema e não se concede.
fn valid_role<'a>(connection: &Connection, role: &'a str) -> AppResult<&'a str> {
    let existe: Option<bool> = connection
        .query_row(
            "SELECT is_master FROM roles WHERE key = ?1",
            params![role],
            |row| row.get(0),
        )
        .optional()?;
    match existe {
        Some(false) => Ok(role),
        Some(true) => Err(AppError::Validation(
            "o papel master não é atribuído: ele é a conta permanente do sistema".into(),
        )),
        None => Err(AppError::Validation("função inválida".into())),
    }
}

pub fn list(connection: &Connection, actor: &LocalUser) -> AppResult<Vec<ManagedUser>> {
    require_manager(actor)?;
    let mut statement = connection.prepare(
        "SELECT id, username, full_name, whatsapp, role, last_login_at,
                is_permanent, must_change_password
         FROM users WHERE active = 1 ORDER BY full_name COLLATE NOCASE",
    )?;
    let base = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, bool>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut out = Vec::with_capacity(base.len());
    for (id, username, full_name, whatsapp, role, last_login_at, is_permanent, must_change_password) in base {
        let mut permissions = Vec::new();
        let mut perm_stmt =
            connection.prepare("SELECT permission FROM user_permissions WHERE user_id = ?1")?;
        let rows = perm_stmt.query_map(params![id], |row| row.get::<_, String>(0))?;
        for permission in rows {
            permissions.push(permission?);
        }
        out.push(ManagedUser {
            id,
            username,
            full_name,
            whatsapp,
            role,
            last_login_at,
            permissions,
            is_permanent,
            must_change_password,
        });
    }
    Ok(out)
}

pub fn create(
    connection: &mut Connection,
    actor: &LocalUser,
    input: CreateUserInput,
) -> AppResult<ManagedUser> {
    require_manager(actor)?;
    let role = valid_role(connection, input.role.trim())?.to_string();
    let username = input.username.trim().to_string();
    let full_name = input.full_name.trim().to_string();
    if username.len() < 3 || full_name.len() < 2 {
        return Err(AppError::Validation(
            "usuário e nome completo são obrigatórios".into(),
        ));
    }
    if input.password.chars().count() < 6 {
        return Err(AppError::Validation(
            "a senha precisa de ao menos 6 caracteres".into(),
        ));
    }
    let hash = auth::hash_password(&input.password)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let whatsapp = input.whatsapp.filter(|w| !w.trim().is_empty());

    let transaction = connection.transaction()?;
    transaction
        .execute(
            "INSERT INTO users (id, username, password_hash, full_name, whatsapp, role, active,
                                must_change_password, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?7)",
            params![id, username, hash, full_name, whatsapp, role, now],
        )
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(ref inner, _) if inner.extended_code == 2067 => {
                AppError::Conflict("já existe um usuário com esse login".into())
            }
            other => AppError::Database(other),
        })?;

    // A conta nova recebe exatamente o que o perfil concede: nada de exceção
    // por padrão.
    //
    // Antes, toda conta nascia com exceções pessoais para caixa e para TODOS os
    // relatórios, herdadas do legado. O efeito era invisível e grave: tirar
    // "ver relatórios" do perfil Atendente não mudava nada, porque cada pessoa
    // carregava a permissão por fora. O perfil virava decoração.
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'user.create', 'user', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            id,
            serde_json::json!({ "username": username, "role": role }).to_string(),
            now
        ],
    )?;
    transaction.commit()?;

    list(connection, actor)?
        .into_iter()
        .find(|u| u.id == id)
        .ok_or(AppError::NotFound)
}

/// Conta permanente não muda de papel, não é desativada e não é excluída.
fn garante_nao_permanente(connection: &Connection, user_id: &str, acao: &str) -> AppResult<()> {
    let permanente: bool = connection
        .query_row(
            "SELECT is_permanent FROM users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if permanente {
        return Err(AppError::Validation(format!(
            "esta é a conta master permanente do sistema e não pode ser {acao}"
        )));
    }
    Ok(())
}

pub fn update(
    connection: &mut Connection,
    actor: &LocalUser,
    input: UpdateUserInput,
) -> AppResult<ManagedUser> {
    require_manager(actor)?;
    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;

    let role: String = transaction
        .query_row(
            "SELECT role FROM users WHERE id = ?1 AND active = 1",
            params![input.user_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    let role = match input.role.as_deref() {
        Some(novo) => {
            let novo = valid_role(&transaction, novo.trim())?.to_string();
            if novo != role {
                garante_nao_permanente(&transaction, &input.user_id, "rebaixada")?;
            }
            transaction.execute(
                "UPDATE users SET role = ?1, updated_at = ?2 WHERE id = ?3",
                params![novo, now, input.user_id],
            )?;
            novo
        }
        None => role,
    };

    if let Some(ref full_name) = input.full_name {
        let full_name = full_name.trim();
        if full_name.len() < 2 {
            return Err(AppError::Validation("nome completo inválido".into()));
        }
        transaction.execute(
            "UPDATE users SET full_name = ?1, whatsapp = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                full_name,
                input.whatsapp.as_deref().filter(|w| !w.trim().is_empty()),
                now,
                input.user_id
            ],
        )?;
    }

    if let Some(ref permissions) = input.permissions {
        transaction.execute(
            "DELETE FROM user_permissions WHERE user_id = ?1",
            params![input.user_id],
        )?;
        // O catálogo inteiro, não os 16 apelidos do legado: `sale.discount`,
        // `cash.operate`, `stock.inventory`, `suppliers.*` e `backup.manage`
        // existiam, eram exigidos no código e eram silenciosamente descartados
        // aqui — não havia como concedê-los como exceção a ninguém.
        let catalogo: Vec<String> = {
            let mut st = transaction.prepare("SELECT key FROM permissions")?;
            let linhas = st.query_map([], |row| row.get::<_, String>(0))?;
            linhas.collect::<Result<_, _>>()?
        };
        for permission in catalogo {
            // Aceita a chave real e, por compatibilidade, o apelido antigo.
            let apelido = ACCESS_MAP
                .iter()
                .find(|(_, p)| *p == permission)
                .map(|(k, _)| *k);
            let granted = permissions.get(&permission).copied().unwrap_or(false)
                || apelido
                    .and_then(|k| permissions.get(k).copied())
                    .unwrap_or(false);
            if granted {
                transaction.execute(
                    "INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?1, ?2)",
                    params![input.user_id, permission],
                )?;
            }
        }
    }

    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'user.update', 'user', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            input.user_id,
            serde_json::json!({ "role": role }).to_string(),
            now
        ],
    )?;
    // Mudar papel ou permissão derruba a sessão: a autorização em memória é
    // uma foto do login, e sem isto a mudança só valeria no próximo acesso.
    encerrar_sessoes(&transaction, &input.user_id)?;
    transaction.commit()?;

    list(connection, actor)?
        .into_iter()
        .find(|u| u.id == input.user_id)
        .ok_or(AppError::NotFound)
}

pub fn set_password(
    connection: &mut Connection,
    actor: &LocalUser,
    user_id: &str,
    password: &str,
) -> AppResult<()> {
    require_manager(actor)?;
    if password.chars().count() < 6 {
        return Err(AppError::Validation(
            "a senha precisa de ao menos 6 caracteres".into(),
        ));
    }
    let hash = auth::hash_password(password)?;
    let now = Utc::now().to_rfc3339();
    let changed = connection.execute(
        // Senha definida pelo gestor é provisória por natureza: passou por
        // terceiro. A conta só volta a operar depois que a pessoa define a sua.
        "UPDATE users SET password_hash = ?1, must_change_password = 1, updated_at = ?2
         WHERE id = ?3 AND active = 1",
        params![hash, now, user_id],
    )?;
    if changed != 1 {
        return Err(AppError::NotFound);
    }
    // A senha nunca entra na auditoria.
    connection.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, occurred_at)
         VALUES (?1, ?2, 'user.password_reset', 'user', ?3, ?4)",
        params![Uuid::new_v4().to_string(), actor.id, user_id, now],
    )?;
    Ok(())
}

/// Remove as exceções pessoais: a conta passa a valer exatamente o perfil.
///
/// Existe porque exceção é fácil de criar e difícil de perceber. Sem uma forma
/// de zerar, "tirei a permissão do perfil e a pessoa continua vendo" vira um
/// mistério — a permissão estava na pessoa, não no perfil.
pub fn limpar_excecoes(
    connection: &mut Connection,
    actor: &LocalUser,
    user_id: &str,
) -> AppResult<ManagedUser> {
    require_manager(actor)?;
    let agora = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM user_permissions WHERE user_id = ?1",
        params![user_id],
    )?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after_json, occurred_at)
         VALUES (?1, ?2, 'user.clear_exceptions', 'user', ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            actor.id,
            user_id,
            serde_json::json!({}).to_string(),
            agora
        ],
    )?;
    encerrar_sessoes(&transaction, user_id)?;
    transaction.commit()?;

    list(connection, actor)?
        .into_iter()
        .find(|u| u.id == user_id)
        .ok_or(AppError::NotFound)
}

/// Derruba todas as sessões de um usuário.
///
/// Sem isto, demitir alguém não tinha efeito enquanto o app ficasse aberto: a
/// sessão em memória é uma foto do login, e o atendente demitido continuava
/// vendendo até alguém fechar o aplicativo.
pub(crate) fn encerrar_sessoes(
    transaction: &rusqlite::Transaction<'_>,
    user_id: &str,
) -> AppResult<()> {
    transaction.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

pub fn delete(connection: &mut Connection, actor: &LocalUser, user_id: &str) -> AppResult<()> {
    require_manager(actor)?;
    if actor.id == user_id {
        return Err(AppError::Validation(
            "você não pode excluir o próprio usuário".into(),
        ));
    }
    garante_nao_permanente(connection, user_id, "excluída")?;

    let outros_masters: i64 = connection.query_row(
        "SELECT COUNT(*) FROM users WHERE active = 1 AND role = 'master' AND id <> ?1",
        params![user_id],
        |row| row.get(0),
    )?;
    let alvo_e_master: bool = connection
        .query_row(
            "SELECT role = 'master' FROM users WHERE id = ?1 AND active = 1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    if alvo_e_master && outros_masters == 0 {
        return Err(AppError::Validation(
            "o sistema precisa de pelo menos um master".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE users SET active = 0, updated_at = ?1 WHERE id = ?2",
        params![now, user_id],
    )?;
    transaction.execute(
        "DELETE FROM user_permissions WHERE user_id = ?1",
        params![user_id],
    )?;
    encerrar_sessoes(&transaction, user_id)?;
    transaction.execute(
        "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, occurred_at)
         VALUES (?1, ?2, 'user.delete', 'user', ?3, ?4)",
        params![Uuid::new_v4().to_string(), actor.id, user_id, now],
    )?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests_catalogo {
    use crate::db;

    /// Toda permissão exigida no código precisa existir no catálogo.
    ///
    /// Existe porque o erro é silencioso e caro: dá para escrever
    /// `require(actor, "suppliers.manage")` e esquecer de inserir a chave na
    /// migration. Aí a tela de Usuários nunca oferece a permissão, ninguém
    /// consegue conceder, e o recurso fica inacessível sem nenhuma mensagem —
    /// só um "operação não permitida" que não explica nada.
    #[test]
    fn toda_permissao_exigida_no_codigo_existe_no_catalogo() {
        let connection = db::open_in_memory().unwrap();
        let mut statement = connection.prepare("SELECT key FROM permissions").unwrap();
        let catalogo: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        let diretorio = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut exigidas: Vec<(String, String)> = Vec::new();

        for entrada in std::fs::read_dir(&diretorio).unwrap() {
            let caminho = entrada.unwrap().path();
            if caminho.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let arquivo = caminho.file_name().unwrap().to_string_lossy().to_string();
            let codigo = std::fs::read_to_string(&caminho).unwrap();

            for chamada in ["require(actor, \"", "require_permission(actor, \""] {
                let mut resto = codigo.as_str();
                while let Some(inicio) = resto.find(chamada) {
                    resto = &resto[inicio + chamada.len()..];
                    if let Some(fim) = resto.find('"') {
                        exigidas.push((arquivo.clone(), resto[..fim].to_string()));
                    }
                }
            }
        }

        assert!(
            exigidas.len() > 20,
            "a varredura não encontrou as permissões; o padrão de chamada mudou"
        );

        let faltando: Vec<String> = exigidas
            .iter()
            .filter(|(_, chave)| !catalogo.contains(chave))
            .map(|(arquivo, chave)| format!("{arquivo}: {chave}"))
            .collect();

        assert!(
            faltando.is_empty(),
            "permissões exigidas no código e ausentes da tabela `permissions`, \
             logo impossíveis de conceder na tela de Usuários: {faltando:?}"
        );
    }

    /// Nenhum papel de sistema pode ficar sem as permissões novas por
    /// esquecimento: quem cuida de estoque precisa enxergar fornecedor.
    #[test]
    fn papeis_de_sistema_recebem_as_permissoes_de_fornecedor() {
        let connection = db::open_in_memory().unwrap();
        for (papel, chave) in [
            ("gerente", "suppliers.view"),
            ("gerente", "suppliers.manage"),
            ("supervisor", "suppliers.manage"),
            ("atendente", "suppliers.view"),
        ] {
            let tem: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM role_permissions WHERE role_key = ?1 AND permission = ?2",
                    rusqlite::params![papel, chave],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(tem, 1, "{papel} deveria ter {chave}");
        }

        // Atendente vê, mas não gere: gestão de compra não é função de balcão.
        let indevida: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM role_permissions
                 WHERE role_key = 'atendente' AND permission = 'suppliers.manage'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indevida, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::collections::HashMap;

    fn gerente() -> LocalUser {
        LocalUser {
            id: "g1".into(),
            username: "gerente".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["users.manage".into()],
        must_change_password: false,
        }
    }

    fn base() -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1', 'gerente', 'x', 'Gerente', 'gerente', 1, 'now', 'now')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO user_permissions (user_id, permission) VALUES ('g1', 'users.manage')",
            [],
        ).unwrap();
        c
    }

    fn perms(map: &[(&str, bool)]) -> HashMap<String, bool> {
        map.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    /// A conta nova segue o perfil, e só ele.
    ///
    /// Antes toda conta nascia com exceções pessoais para caixa e para todos os
    /// relatórios, herdadas do legado. O efeito era invisível: mexer no perfil
    /// não mudava nada, porque cada pessoa carregava a permissão por fora.
    #[test]
    fn conta_nova_segue_o_perfil_e_nao_ganha_excecao() {
        let mut c = base();
        let novo = create(&mut c, &gerente(), CreateUserInput {
            username: "atendente1".into(), password: "123456".into(),
            full_name: "Atendente Um".into(), whatsapp: None, role: "atendente".into(),
        }).unwrap();

        let excecoes: i64 = c.query_row(
            "SELECT COUNT(*) FROM user_permissions WHERE user_id = ?1",
            params![novo.id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(excecoes, 0, "o perfil precisa ser a única fonte da permissão");

        assert!(
            novo.permissions.is_empty(),
            "`ManagedUser.permissions` lista exceções, e não deve haver nenhuma"
        );

        // O que a conta pode de fato vem do perfil, resolvido no login.
        let efetivas = crate::auth::load_user(&c, &novo.id).unwrap().unwrap();
        assert!(efetivas.permissions.contains(&"pdv.use".to_string()));
        assert!(!efetivas.permissions.contains(&"stock.add".to_string()));
    }

    /// A exceção concede o que o gestor marcou, independentemente do papel.
    ///
    /// Antes havia uma regra fixa do legado que descartava em silêncio estoque
    /// para atendente e `stock.delete` para supervisor, mesmo marcados de
    /// propósito. Isso torna a exceção mentirosa: a tela mostrava a caixa
    /// marcada e o banco guardava outra coisa. Quem decide é quem tem
    /// `users.manage`; o papel é o padrão, não um teto.
    #[test]
    fn excecao_concede_o_que_foi_marcado_seja_qual_for_o_papel() {
        let mut c = base();
        let novo = create(&mut c, &gerente(), CreateUserInput {
            username: "atendente1".into(), password: "123456".into(),
            full_name: "Atendente Um".into(), whatsapp: None, role: "atendente".into(),
        }).unwrap();

        let atualizado = update(&mut c, &gerente(), UpdateUserInput {
            user_id: novo.id.clone(), full_name: None, whatsapp: None, role: None,
            permissions: Some(perms(&[("access_pdv", true), ("access_est_add", true)])),
        }).unwrap();
        assert!(atualizado.permissions.contains(&"pdv.use".to_string()));
        assert!(
            atualizado.permissions.contains(&"stock.add".to_string()),
            "o atendente de confiança que repõe a geladeira precisa disso"
        );
    }

    /// O que não foi marcado continua fora: exceção não é tudo ou nada.
    #[test]
    fn o_que_nao_foi_marcado_nao_e_concedido() {
        let mut c = base();
        let novo = create(&mut c, &gerente(), CreateUserInput {
            username: "sup".into(), password: "123456".into(),
            full_name: "Supervisor".into(), whatsapp: None, role: "supervisor".into(),
        }).unwrap();
        let atualizado = update(&mut c, &gerente(), UpdateUserInput {
            user_id: novo.id, full_name: None, whatsapp: None, role: None,
            permissions: Some(perms(&[("access_est_add", true)])),
        }).unwrap();
        assert!(atualizado.permissions.contains(&"stock.add".to_string()));
        assert!(!atualizado.permissions.contains(&"stock.delete".to_string()));
    }

    #[test]
    fn conta_master_permanente_nao_pode_ser_excluida_nem_rebaixada() {
        let mut c = base();
        // Marca o master como permanente, como a migração faz na instalação.
        c.execute("UPDATE users SET is_permanent = 1 WHERE id = 'g1'", []).unwrap();

        let excluir = delete(&mut c, &gerente(), "g1");
        assert!(matches!(excluir, Err(AppError::Validation(_))));

        let rebaixar = update(&mut c, &gerente(), UpdateUserInput {
            user_id: "g1".into(), full_name: None, whatsapp: None,
            role: Some("atendente".into()), permissions: None,
        });
        assert!(matches!(rebaixar, Err(AppError::Validation(_))));

        // A senha continua trocável: o que é imutável é a conta, não a credencial.
        set_password(&mut c, &gerente(), "g1", "outra-senha-forte").unwrap();
        assert_eq!(list(&c, &gerente()).unwrap().len(), 1);
    }

    #[test]
    fn conta_criada_pelo_master_nasce_com_senha_provisoria() {
        let mut c = base();
        let novo = create(&mut c, &gerente(), CreateUserInput {
            username: "aux1".into(), password: "provisoria123".into(),
            full_name: "Atendente".into(), whatsapp: None, role: "atendente".into(),
        }).unwrap();
        assert!(novo.must_change_password, "obriga a trocar no primeiro acesso");
        assert!(!novo.is_permanent);
    }

    #[test]
    fn nao_deixa_o_sistema_sem_master() {
        let mut c = base();
        let outro = create(&mut c, &gerente(), CreateUserInput {
            username: "aux1".into(), password: "123456".into(),
            full_name: "Atendente".into(), whatsapp: None, role: "atendente".into(),
        }).unwrap();
        // o gerente não pode excluir a si mesmo, nem deixar o sistema sem gerente
        assert!(matches!(delete(&mut c, &gerente(), "g1"), Err(AppError::Validation(_))));
        // um atendente pode ser excluído
        delete(&mut c, &gerente(), &outro.id).unwrap();
        assert_eq!(list(&c, &gerente()).unwrap().len(), 1);
    }

    #[test]
    fn troca_senha_com_minimo_de_caracteres_e_sem_vazar_na_auditoria() {
        let mut c = base();
        let novo = create(&mut c, &gerente(), CreateUserInput {
            username: "aux1".into(), password: "123456".into(),
            full_name: "Atendente".into(), whatsapp: None, role: "atendente".into(),
        }).unwrap();
        assert!(matches!(set_password(&mut c, &gerente(), &novo.id, "123"), Err(AppError::Validation(_))));
        set_password(&mut c, &gerente(), &novo.id, "novasenha").unwrap();

        let vazou: i64 = c.query_row(
            "SELECT COUNT(*) FROM audit_events WHERE COALESCE(after_json,'') LIKE '%novasenha%'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(vazou, 0);
    }

    #[test]
    fn so_quem_tem_a_permissao_gerencia_usuarios() {
        let mut c = base();
        let mut atendente = gerente();
        atendente.role = "atendente".into();
        // Papel sem a permissão: é a permissão que decide, não o nome do papel.
        atendente.permissions.clear();
        assert!(matches!(list(&c, &atendente), Err(AppError::Forbidden)));
        assert!(matches!(create(&mut c, &atendente, CreateUserInput {
            username: "x".into(), password: "123456".into(),
            full_name: "X".into(), whatsapp: None, role: "atendente".into(),
        }), Err(AppError::Forbidden)));
    }
}


#[cfg(test)]
mod tests_sessao {
    use super::*;
    use crate::db;

    fn master() -> LocalUser {
        LocalUser {
            id: "u-master".into(),
            username: "master".into(),
            full_name: "Master".into(),
            whatsapp: None,
            role: "master".into(),
            permissions: vec!["users.manage".into()],
            must_change_password: false,
        }
    }

    fn com_master_e_conta() -> (Connection, String) {
        let mut c = db::open_in_memory().unwrap();
        let agora = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at)
             VALUES ('u-master','master','x','Master','master',?1,?1)",
            params![agora],
        )
        .unwrap();
        let novo = create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "senha123".into(),
                role: "atendente".into(),
                whatsapp: None,
            },
        )
        .unwrap();
        c.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
             VALUES ('hash-joao', ?1, ?2, ?2, '2099-01-01T00:00:00Z')",
            params![novo.id, agora],
        )
        .unwrap();
        (c, novo.id)
    }

    fn sessoes_de(c: &Connection, user_id: &str) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM sessions WHERE user_id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Demitir alguém precisa valer na hora, não no próximo reinício do app.
    #[test]
    fn excluir_conta_derruba_a_sessao_aberta() {
        let (mut c, id) = com_master_e_conta();
        assert_eq!(sessoes_de(&c, &id), 1);
        delete(&mut c, &master(), &id).unwrap();
        assert_eq!(
            sessoes_de(&c, &id),
            0,
            "o demitido continuaria vendendo com o app aberto"
        );
    }

    /// Tirar permissão de alguém também precisa valer na hora.
    #[test]
    fn mudar_papel_derruba_a_sessao_aberta() {
        let (mut c, id) = com_master_e_conta();
        update(
            &mut c,
            &master(),
            UpdateUserInput {
                user_id: id.clone(),
                full_name: None,
                whatsapp: None,
                role: Some("supervisor".into()),
                permissions: None,
            },
        )
        .unwrap();
        assert_eq!(sessoes_de(&c, &id), 0);
    }
}

#[cfg(test)]
#[cfg(test)]
mod tests_perfis {
    use super::*;
    use crate::db;

    fn master() -> LocalUser {
        LocalUser {
            id: "u-master".into(),
            username: "master".into(),
            full_name: "Master".into(),
            whatsapp: None,
            role: "master".into(),
            permissions: vec!["users.manage".into()],
            must_change_password: false,
        }
    }

    fn com_master() -> Connection {
        let c = db::open_in_memory().unwrap();
        let agora = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at)
             VALUES ('u-master', 'master', 'x', 'Master', 'master', ?1, ?1)",
            params![agora],
        )
        .unwrap();
        c
    }

    fn entrada(nome: &str, permissoes: &[&str]) -> RoleInput {
        RoleInput {
            name: nome.into(),
            description: String::new(),
            permissions: permissoes.iter().map(|p| p.to_string()).collect(), history_days: 0,
        }
    }

    #[test]
    fn chave_nasce_do_nome_sem_acento_nem_simbolo() {
        assert_eq!(chave_de("Conferente de Estoque"), "conferente-de-estoque");
        assert_eq!(chave_de("Caixa / Balcão"), "caixa-balcao");
        assert_eq!(chave_de("   "), "");
    }

    #[test]
    fn cria_perfil_com_permissoes_e_conta_zero_usuarios() {
        let mut c = com_master();
        let papel = create_role(
            &mut c,
            &master(),
            entrada("Conferente", &["stock.view", "stock.inventory"]),
        )
        .unwrap();
        assert_eq!(papel.key, "conferente");
        assert_eq!(papel.user_count, 0);
        assert!(!papel.is_system);
        assert_eq!(papel.permissions.len(), 2);
    }

    #[test]
    fn perfil_novo_pode_ser_atribuido_a_um_usuario() {
        // Era o defeito: `valid_role` só aceitava os três nomes do legado, então
        // o perfil recém-criado era recusado como "função inválida".
        let mut c = com_master();
        create_role(&mut c, &master(), entrada("Conferente", &["stock.view"])).unwrap();
        let criado = create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "senha123".into(),
                role: "conferente".into(),
                whatsapp: None,
            },
        )
        .unwrap();
        assert_eq!(criado.role, "conferente");

        let papel = list_roles(&c)
            .unwrap()
            .into_iter()
            .find(|r| r.key == "conferente")
            .unwrap();
        assert_eq!(papel.user_count, 1, "o perfil passa a contar uma conta");
    }

    #[test]
    fn perfil_em_uso_nao_e_excluido_e_o_de_sistema_tambem_nao() {
        let mut c = com_master();
        create_role(&mut c, &master(), entrada("Conferente", &["stock.view"])).unwrap();
        create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "senha123".into(),
                role: "conferente".into(),
                whatsapp: None,
            },
        )
        .unwrap();

        assert!(matches!(
            delete_role(&mut c, &master(), "conferente"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            delete_role(&mut c, &master(), "gerente"),
            Err(AppError::Validation(_))
        ));

        // Movida a pessoa para outro perfil, sai.
        c.execute(
            "UPDATE users SET role = 'atendente' WHERE username = 'joao'",
            [],
        )
        .unwrap();
        delete_role(&mut c, &master(), "conferente").unwrap();
        assert!(list_roles(&c).unwrap().iter().all(|r| r.key != "conferente"));
    }

    #[test]
    fn master_nunca_e_editado_nem_atribuido() {
        let mut c = com_master();
        assert!(matches!(
            update_role(&mut c, &master(), "master", entrada("Master", &["pdv.use"])),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            valid_role(&c, "master"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn papel_de_sistema_muda_permissao_mas_nao_muda_de_nome() {
        let mut c = com_master();
        let antes = list_roles(&c)
            .unwrap()
            .into_iter()
            .find(|r| r.key == "atendente")
            .unwrap();
        let depois = update_role(
            &mut c,
            &master(),
            "atendente",
            entrada("Outro Nome", &["pdv.use", "stock.view"]),
        )
        .unwrap();
        assert_eq!(depois.name, antes.name, "nome de papel de sistema é fixo");
        assert_eq!(depois.permissions, vec!["pdv.use", "stock.view"]);
    }

    #[test]
    fn perfil_sem_permissao_ou_com_permissao_inventada_e_recusado() {
        let mut c = com_master();
        assert!(create_role(&mut c, &master(), entrada("Vazio", &[])).is_err());
        assert!(create_role(&mut c, &master(), entrada("Fantasma", &["nao.existe"])).is_err());
        assert!(create_role(&mut c, &master(), entrada("AB", &["pdv.use"])).is_err());
    }

    #[test]
    fn excecao_por_usuario_aceita_permissao_fora_do_mapa_legado() {
        // Era o segundo defeito: `ACCESS_MAP` tinha 16 apelidos do legado, e
        // tudo fora dele — desconto, sangria, inventário, fornecedores, backup —
        // era descartado em silêncio ao salvar.
        let mut c = com_master();
        let usuario = create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "senha123".into(),
                role: "atendente".into(),
                whatsapp: None,
            },
        )
        .unwrap();

        let mut marcadas = std::collections::HashMap::new();
        for chave in ["sale.discount", "suppliers.manage", "stock.inventory", "backup.manage"] {
            marcadas.insert(chave.to_string(), true);
        }
        update(
            &mut c,
            &master(),
            UpdateUserInput {
                user_id: usuario.id.clone(),
                full_name: None,
                whatsapp: None,
                role: None,
                permissions: Some(marcadas),
            },
        )
        .unwrap();

        let mut st = c
            .prepare("SELECT permission FROM user_permissions WHERE user_id = ?1 ORDER BY permission")
            .unwrap();
        let gravadas: Vec<String> = st
            .query_map(params![usuario.id], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            gravadas,
            vec!["backup.manage", "sale.discount", "stock.inventory", "suppliers.manage"]
        );
    }
}

#[cfg(test)]
mod tests_senha_provisoria {
    use super::*;
    use crate::db;

    fn master() -> LocalUser {
        LocalUser {
            id: "u-master".into(),
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
        let agora = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, must_change_password, created_at, updated_at)
             VALUES ('u-master','master','x','Master','master',0,?1,?1)",
            params![agora],
        )
        .unwrap();
        c
    }

    fn flag(c: &Connection, id: &str) -> bool {
        c.query_row(
            "SELECT must_change_password FROM users WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Conta nova nasce obrigada a trocar: a senha foi digitada por terceiro.
    #[test]
    fn conta_nova_nasce_com_senha_provisoria() {
        let mut c = base();
        let novo = create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "provisoria1".into(),
                role: "atendente".into(),
                whatsapp: None,
            },
        )
        .unwrap();
        assert!(flag(&c, &novo.id), "a troca precisa ser exigida");
    }

    /// Reset feito pelo gestor volta a exigir a troca.
    ///
    /// Era o furo: a senha que o gestor entrega no papel valia para sempre.
    #[test]
    fn reset_do_gestor_reexige_a_troca() {
        let mut c = base();
        let novo = create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "provisoria1".into(),
                role: "atendente".into(),
                whatsapp: None,
            },
        )
        .unwrap();
        // A pessoa definiu a própria senha e passou a operar.
        crate::auth::change_own_password(&mut c, &novo.id, "provisoria1", "minhasenha123").unwrap();
        assert!(!flag(&c, &novo.id));

        // O gestor reseta: volta a ser provisória.
        set_password(&mut c, &master(), &novo.id, "outraprovisoria").unwrap();
        assert!(
            flag(&c, &novo.id),
            "senha entregue por terceiro não pode valer para sempre"
        );
    }

    /// Trocar a própria senha libera a conta.
    #[test]
    fn trocar_a_propria_senha_libera_a_conta() {
        let mut c = base();
        let novo = create(
            &mut c,
            &master(),
            CreateUserInput {
                username: "joao".into(),
                full_name: "João Pedro".into(),
                password: "provisoria1".into(),
                role: "atendente".into(),
                whatsapp: None,
            },
        )
        .unwrap();
        crate::auth::change_own_password(&mut c, &novo.id, "provisoria1", "minhasenha123").unwrap();
        assert!(!flag(&c, &novo.id));
    }
}

#[cfg(test)]
mod tests_excecoes {
    use super::*;
    use crate::db;

    fn master() -> LocalUser {
        LocalUser {
            id: "u-master".into(),
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
        let agora = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at)
             VALUES ('u-master','master','x','Master','master',?1,?1)",
            params![agora],
        )
        .unwrap();
        c
    }

    fn nova_conta(c: &mut Connection) -> ManagedUser {
        create(
            c,
            &master(),
            CreateUserInput {
                username: "balcao".into(),
                full_name: "Balcão".into(),
                password: "provisoria1".into(),
                role: "atendente".into(),
                whatsapp: None,
            },
        )
        .unwrap()
    }

    fn excecoes(c: &Connection, id: &str) -> Vec<String> {
        let mut st = c
            .prepare("SELECT permission FROM user_permissions WHERE user_id = ?1 ORDER BY permission")
            .unwrap();
        st.query_map(params![id], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    /// Conta nova não nasce com permissão por fora do perfil.
    ///
    /// Era o defeito: toda conta ganhava exceções para caixa e para todos os
    /// relatórios. Tirar "ver relatórios" do perfil Atendente não surtia efeito
    /// nenhum, porque cada pessoa carregava a permissão individualmente.
    #[test]
    fn conta_nova_nao_ganha_excecao_nenhuma() {
        let mut c = base();
        let nova = nova_conta(&mut c);
        assert!(
            excecoes(&c, &nova.id).is_empty(),
            "o perfil precisa ser a única fonte da permissão"
        );
    }

    /// Tirar a permissão do perfil precisa valer para quem tem só o perfil.
    #[test]
    fn tirar_do_perfil_tira_de_quem_nao_tem_excecao() {
        let mut c = base();
        let nova = nova_conta(&mut c);
        c.execute(
            "INSERT OR IGNORE INTO role_permissions (role_key, permission)
             VALUES ('atendente','reports.view')",
            [],
        )
        .unwrap();
        let com = crate::auth::load_user(&c, &nova.id).unwrap().unwrap();
        assert!(com.permissions.iter().any(|p| p == "reports.view"));

        c.execute(
            "DELETE FROM role_permissions WHERE role_key='atendente' AND permission='reports.view'",
            [],
        )
        .unwrap();
        let sem = crate::auth::load_user(&c, &nova.id).unwrap().unwrap();
        assert!(!sem.permissions.iter().any(|p| p == "reports.view"));
    }

    /// Zerar exceções devolve a conta ao que o perfil diz.
    #[test]
    fn limpar_excecoes_devolve_a_conta_ao_perfil() {
        let mut c = base();
        let nova = nova_conta(&mut c);
        // `reports.stock` e `stock.delete` não pertencem ao perfil Atendente:
        // se sobrarem depois da limpeza, é porque vieram da exceção.
        c.execute(
            "INSERT INTO user_permissions (user_id, permission)
             VALUES (?1, 'reports.stock'), (?1, 'stock.delete')",
            params![nova.id],
        )
        .unwrap();
        assert_eq!(excecoes(&c, &nova.id).len(), 2);
        let antes = crate::auth::load_user(&c, &nova.id).unwrap().unwrap();
        assert!(antes.permissions.iter().any(|p| p == "stock.delete"));

        limpar_excecoes(&mut c, &master(), &nova.id).unwrap();
        assert!(excecoes(&c, &nova.id).is_empty());

        let depois = crate::auth::load_user(&c, &nova.id).unwrap().unwrap();
        assert!(!depois.permissions.iter().any(|p| p == "stock.delete"));
        assert!(!depois.permissions.iter().any(|p| p == "reports.stock"));
        // O que o perfil concede continua valendo.
        assert!(depois.permissions.iter().any(|p| p == "pdv.use"));
    }
}
