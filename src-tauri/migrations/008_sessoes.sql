BEGIN IMMEDIATE;

-- ============================================================
-- Sessões persistidas.
--
-- Antes elas viviam só em memória, então fechar o aplicativo — ou uma
-- recompilação em desenvolvimento — derrubava o operador no meio do turno.
-- Guardamos o SHA-256 do token, nunca o token: quem lê o banco não
-- consegue se passar por ninguém.
-- ============================================================
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_sessions_expiracao ON sessions(expires_at);

PRAGMA user_version = 8;
COMMIT;
