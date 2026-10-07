use std::{collections::HashMap, path::PathBuf, sync::Mutex};

use chrono::{Duration, Utc};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

use crate::{
    error::{AppError, AppResult},
    models::LocalUser,
};

pub struct AppState {
    pub database: Mutex<Connection>,
    pub app_data: PathBuf,
    pub db_path: PathBuf,
    /// Token → (usuário autorizado, quando a sessão vence).
    sessions: Mutex<HashMap<String, (LocalUser, String)>>,
}

impl AppState {
    pub fn new(database: Connection, app_data: PathBuf, db_path: PathBuf) -> Self {
        Self {
            database: Mutex::new(database),
            app_data,
            db_path,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Padrão de duração da sessão quando o parâmetro não pôde ser lido.
    const DURACAO_HORAS_PADRAO: i64 = 16;

    fn hash(token: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Cria a sessão em memória e no banco, para sobreviver ao fechamento do app.
    pub fn create_session(&self, user: LocalUser, database: &Connection) -> AppResult<String> {
        let token = uuid::Uuid::new_v4().to_string();
        let agora = Utc::now();
        let horas = crate::params::inteiro(database, "sessao.horas", Self::DURACAO_HORAS_PADRAO);
        let expira = agora + Duration::hours(horas.max(1));

        database.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?3)",
            params![
                Self::hash(&token),
                user.id,
                agora.to_rfc3339(),
                expira.to_rfc3339()
            ],
        )?;
        // Aproveita para limpar o que já venceu.
        let _ = database.execute(
            "DELETE FROM sessions WHERE expires_at < ?1",
            params![agora.to_rfc3339()],
        );

        self.sessions
            .lock()
            .map_err(|_| AppError::Internal("sessões indisponíveis".into()))?
            .insert(token.clone(), (user, expira.to_rfc3339()));
        Ok(token)
    }

    /// O usuário da sessão, **exigindo** que a senha provisória já tenha sido
    /// trocada.
    ///
    /// É o que todo comando usa. Senha provisória é senha que passou por
    /// terceiro — foi digitada pelo gestor e entregue no papel ou pelo
    /// WhatsApp. Enquanto não for trocada, a conta não opera: bloquear só na
    /// tela deixaria o caminho aberto para qualquer chamada direta.
    ///
    /// Os três comandos que precisam funcionar nesse estado — ver a sessão,
    /// trocar a própria senha e sair — usam `sessao_bruta`.
    pub fn user_for(&self, token: &str) -> AppResult<LocalUser> {
        let user = self.sessao_bruta(token)?;
        if user.must_change_password {
            return Err(AppError::Validation(
                "defina uma senha própria antes de usar o sistema".into(),
            ));
        }
        Ok(user)
    }

    /// A sessão como está, sem exigir a troca de senha.
    pub fn sessao_bruta(&self, token: &str) -> AppResult<LocalUser> {
        let agora = Utc::now().to_rfc3339();
        let mut sessoes = self
            .sessions
            .lock()
            .map_err(|_| AppError::Internal("sessões indisponíveis".into()))?;
        // A expiração era conferida só ao reabrir o aplicativo. Num PDV que
        // fica ligado a semana inteira isso nunca acontecia, e o parâmetro de
        // duração da sessão era decorativo.
        if let Some((_, vence_em)) = sessoes.get(token) {
            if *vence_em <= agora {
                sessoes.remove(token);
                return Err(AppError::Unauthorized);
            }
        }
        sessoes
            .get(token)
            .map(|(user, _)| user.clone())
            .ok_or(AppError::Unauthorized)
    }

    /// Derruba, na memória, todas as sessões de um usuário.
    ///
    /// A linha em `sessions` é apagada pelo módulo de usuários, mas a
    /// autorização de quem já está logado vive neste mapa: sem isto, demitir
    /// alguém ou tirar uma permissão só valeria no próximo reinício do app.
    pub fn revogar_usuario(&self, user_id: &str) {
        if let Ok(mut sessoes) = self.sessions.lock() {
            sessoes.retain(|_, (user, _)| user.id != user_id);
        }
    }

    /// Retoma uma sessão gravada no banco depois de o aplicativo reabrir.
    /// Token vencido é recusado e removido.
    pub fn resume_session(&self, token: &str, database: &Connection) -> AppResult<LocalUser> {
        if let Ok(user) = self.user_for(token) {
            return Ok(user);
        }
        let hash = Self::hash(token);
        let agora = Utc::now().to_rfc3339();

        let linha: Option<(String, String)> = database
            .query_row(
                "SELECT user_id, expires_at FROM sessions
                 WHERE token_hash = ?1 AND expires_at > ?2",
                params![hash, agora],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let Some((user_id, expira)) = linha else {
            let _ = database.execute("DELETE FROM sessions WHERE token_hash = ?1", params![hash]);
            return Err(AppError::Unauthorized);
        };

        let user = crate::auth::load_user(database, &user_id)?.ok_or(AppError::Unauthorized)?;
        database.execute(
            "UPDATE sessions SET last_seen_at = ?1 WHERE token_hash = ?2",
            params![agora, hash],
        )?;
        self.sessions
            .lock()
            .map_err(|_| AppError::Internal("sessões indisponíveis".into()))?
            .insert(token.to_string(), (user.clone(), expira));
        Ok(user)
    }

    /// Recarrega o usuário da sessão a partir do banco, depois de mudanças
    /// que afetam permissões ou o estado da senha.
    pub fn refresh_session(&self, token: &str, database: &Connection) -> AppResult<()> {
        let atual = self.sessao_bruta(token)?;
        let novo = crate::auth::load_user(database, &atual.id)?.ok_or(AppError::Unauthorized)?;
        let mut sessoes = self
            .sessions
            .lock()
            .map_err(|_| AppError::Internal("sessões indisponíveis".into()))?;
        let vence = sessoes
            .get(token)
            .map(|(_, v)| v.clone())
            .unwrap_or_default();
        sessoes.insert(token.to_string(), (novo, vence));
        Ok(())
    }

    pub fn remove_session(&self, token: &str, database: &Connection) -> AppResult<()> {
        let _ = database.execute(
            "DELETE FROM sessions WHERE token_hash = ?1",
            params![Self::hash(token)],
        );
        self.sessions
            .lock()
            .map_err(|_| AppError::Internal("sessões indisponíveis".into()))?
            .remove(token);
        Ok(())
    }
}
