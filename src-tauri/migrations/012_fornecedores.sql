BEGIN IMMEDIATE;

-- ============================================================
-- Fornecedores.
--
-- O produto passa a saber de quem se compra, e cada entrada de estoque passa a
-- registrar de quem veio e por quanto. Sem isso "custo médio" é um número sem
-- procedência: dá para ver que subiu, não dá para ver com quem.
-- ============================================================
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  -- CNPJ ou CPF só com dígitos; validado no Rust, opcional porque muito
  -- fornecedor de sexshop é distribuidor pequeno sem nota.
  document TEXT,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Documento é único quando existe; quem não tem fica livre.
CREATE UNIQUE INDEX idx_suppliers_document ON suppliers(document) WHERE document IS NOT NULL;

ALTER TABLE products ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);
CREATE INDEX idx_products_supplier ON products(supplier_id) WHERE supplier_id IS NOT NULL;

-- A entrada guarda o custo e o fornecedor daquela compra. É o histórico que
-- sustenta "última compra" e a comparação de preço entre fornecedores.
ALTER TABLE stock_movements ADD COLUMN unit_cost_cents INTEGER;
ALTER TABLE stock_movements ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);
CREATE INDEX idx_movements_supplier
  ON stock_movements(supplier_id, occurred_at DESC) WHERE supplier_id IS NOT NULL;

INSERT INTO permissions (key, grupo, rotulo, descricao, sort_order) VALUES
  ('suppliers.view',   'Estoque', 'Ver fornecedores',       'Consultar a lista e o histórico de compras.', 28),
  ('suppliers.manage', 'Estoque', 'Gerir fornecedores',     'Cadastrar, editar e desativar.', 29);

-- Gerente e supervisor cuidam de compra; atendente só enxerga.
INSERT INTO role_permissions (role_key, permission)
SELECT 'gerente', key FROM permissions WHERE key IN ('suppliers.view', 'suppliers.manage');

INSERT INTO role_permissions (role_key, permission)
SELECT 'supervisor', key FROM permissions WHERE key IN ('suppliers.view', 'suppliers.manage');

INSERT INTO role_permissions (role_key, permission)
SELECT 'atendente', key FROM permissions WHERE key = 'suppliers.view';

PRAGMA user_version = 12;

COMMIT;
