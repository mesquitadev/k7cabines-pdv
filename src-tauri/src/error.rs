use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("acesso não autorizado")]
    Unauthorized,
    #[error("operação não permitida")]
    Forbidden,
    #[error("{0}")]
    Validation(String),
    #[error("registro não encontrado")]
    NotFound,
    #[error("conflito: {0}")]
    Conflict(String),
    #[error("falha de banco de dados")]
    Database(#[from] rusqlite::Error),
    #[error("falha ao proteger a senha")]
    PasswordHash,
    #[error("falha interna: {0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}
