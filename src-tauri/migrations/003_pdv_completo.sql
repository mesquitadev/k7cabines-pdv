BEGIN IMMEDIATE;

-- ============================================================
-- Sessão de caixa: sem ela não há como saber se falta dinheiro
-- na gaveta. Toda venda passa a pertencer a uma sessão.
-- ============================================================
CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_by_name TEXT NOT NULL,
  opening_float_cents INTEGER NOT NULL CHECK (opening_float_cents >= 0),
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_by_name TEXT,
  -- Conferência: o que o sistema espera e o que o operador contou.
  expected_cash_cents INTEGER,
  counted_cash_cents INTEGER,
  difference_cents INTEGER,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('aberta', 'fechada')),
  created_at TEXT NOT NULL
) STRICT;

-- Só uma sessão aberta por vez: o índice parcial garante isso no banco.
CREATE UNIQUE INDEX idx_cash_session_unica_aberta
  ON cash_sessions(status) WHERE status = 'aberta';

-- Sangria (retirada) e suprimento (reforço) durante o turno.
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('sangria', 'suprimento')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_cash_movements_sessao ON cash_movements(session_id, occurred_at);

-- ============================================================
-- Venda: PIX, desconto e vínculo com a sessão de caixa.
-- ============================================================
ALTER TABLE sales ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id);
ALTER TABLE sales ADD COLUMN pix_cents INTEGER NOT NULL DEFAULT 0 CHECK (pix_cents >= 0);
ALTER TABLE sales ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE sales ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0);

CREATE INDEX idx_sales_sessao ON sales(cash_session_id);

-- Quantidade já devolvida, para permitir devolução parcial e impedir
-- devolver mais do que foi vendido.
ALTER TABLE sale_items ADD COLUMN returned_quantity INTEGER NOT NULL DEFAULT 0
  CHECK (returned_quantity >= 0);
ALTER TABLE sale_items ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0
  CHECK (discount_cents >= 0);

-- ============================================================
-- Devolução de item de venda fechada.
-- ============================================================
CREATE TABLE sale_returns (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  refund_kind TEXT NOT NULL CHECK (refund_kind IN ('dinheiro', 'cartao', 'pix', 'sem_estorno')),
  reason TEXT NOT NULL,
  restocked INTEGER NOT NULL DEFAULT 1 CHECK (restocked IN (0, 1)),
  actor_id TEXT REFERENCES users(id),
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_sale_returns_venda ON sale_returns(sale_id, occurred_at DESC);

-- ============================================================
-- Produto: custo, código de barras e estoque mínimo.
-- ============================================================
ALTER TABLE products ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0);
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0);

-- Código de barras é único quando existe; produtos sem EAN ficam livres.
CREATE UNIQUE INDEX idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- ============================================================
-- Inventário: conferência de físico contra sistema.
-- ============================================================
CREATE TABLE inventory_counts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  system_quantity INTEGER NOT NULL,
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  difference INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_inventory_produto ON inventory_counts(product_id, occurred_at DESC);

-- ============================================================
-- PIX: chave estática para gerar o BR Code offline, sem internet.
-- ============================================================
ALTER TABLE ticket_settings ADD COLUMN pix_key TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN pix_merchant_name TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN pix_merchant_city TEXT NOT NULL DEFAULT '';

-- Permissões novas, concedidas a quem já administra o sistema.
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'cash.manage' FROM user_permissions WHERE permission = 'users.manage';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'sale.discount' FROM user_permissions WHERE permission = 'users.manage';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'sale.return' FROM user_permissions WHERE permission = 'users.manage';
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'stock.inventory' FROM user_permissions WHERE permission = 'users.manage';
-- Operador de caixa precisa poder abrir e sangrar o próprio turno.
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT user_id, 'cash.operate' FROM user_permissions WHERE permission = 'pdv.use';

PRAGMA user_version = 3;
COMMIT;
