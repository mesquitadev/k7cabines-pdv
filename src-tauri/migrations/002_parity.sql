BEGIN IMMEDIATE;

-- Vendas excluídas: o legado guarda o registro da exclusão para o fechamento.
CREATE TABLE deleted_sales (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  sale_number INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  sale_created_at TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  deleted_by TEXT REFERENCES users(id),
  deleted_by_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  deleted_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_deleted_sales_date ON deleted_sales(business_date, deleted_at DESC);

-- Último acesso, exibido na tela de usuários do legado.
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- Permissões granulares equivalentes às 16 do legado. Quem já tinha
-- "reports.view" recebe as cinco permissões de relatório correspondentes.
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'reports.sales' FROM user_permissions WHERE permission = 'reports.view';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'reports.hourly' FROM user_permissions WHERE permission = 'reports.view';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'reports.categories' FROM user_permissions WHERE permission = 'reports.view';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'reports.stock' FROM user_permissions WHERE permission = 'reports.view';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'reports.closing' FROM user_permissions WHERE permission = 'reports.view';

PRAGMA user_version = 2;
COMMIT;
