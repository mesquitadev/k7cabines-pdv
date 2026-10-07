BEGIN IMMEDIATE;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  whatsapp TEXT,
  role TEXT NOT NULL CHECK (role IN ('gerente', 'supervisor', 'atendente')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  subcategory TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE product_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  expiry_date TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, expiry_date)
) STRICT;

CREATE TABLE business_counters (
  business_date TEXT PRIMARY KEY,
  next_sale_number INTEGER NOT NULL CHECK (next_sale_number > 0)
) STRICT;

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  client_sale_id TEXT NOT NULL UNIQUE,
  sale_number INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  cash_tendered_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_tendered_cents >= 0),
  card_cents INTEGER NOT NULL DEFAULT 0 CHECK (card_cents >= 0),
  change_cents INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  operator_id TEXT REFERENCES users(id),
  operator_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id),
  cancel_reason TEXT,
  UNIQUE (business_date, sale_number)
) STRICT;

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT REFERENCES products(id),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0)
) STRICT;

CREATE TABLE sale_item_batches (
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  batch_id TEXT NOT NULL REFERENCES product_batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (sale_item_id, batch_id)
) STRICT;

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES product_batches(id),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  actor_id TEXT REFERENCES users(id),
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE ticket_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT '',
  fiscal_label TEXT NOT NULL DEFAULT 'NÃO É DOCUMENTO FISCAL',
  footer_message TEXT NOT NULL DEFAULT 'Obrigado pela preferência!',
  show_chapelaria INTEGER NOT NULL DEFAULT 1 CHECK (show_chapelaria IN (0, 1)),
  chapelaria_label TEXT NOT NULL DEFAULT 'NÚMERO DO PEDIDO',
  show_datetime INTEGER NOT NULL DEFAULT 1 CHECK (show_datetime IN (0, 1)),
  show_operator INTEGER NOT NULL DEFAULT 1 CHECK (show_operator IN (0, 1)),
  operator_label TEXT NOT NULL DEFAULT 'Atendente',
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  correlation_id TEXT,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  exported_at TEXT
) STRICT;

CREATE INDEX idx_batches_product_expiry ON product_batches(product_id, expiry_date, id);
CREATE INDEX idx_sales_business_date ON sales(business_date, sale_number DESC);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_movements_product_time ON stock_movements(product_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_outbox_pending ON sync_outbox(exported_at, occurred_at);

INSERT INTO ticket_settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 1;
COMMIT;
