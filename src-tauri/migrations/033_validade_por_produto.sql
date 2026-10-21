BEGIN IMMEDIATE;

-- ============================================================
-- Controle de validade por produto (pedido do cliente em 15/10/2026):
-- "nem todos os produtos eróticos têm data de validade". A regra deixa de
-- ser por categoria e passa a ser do produto. Pulseiras nascem sem controle.
-- ============================================================
ALTER TABLE products ADD COLUMN tracks_expiry INTEGER NOT NULL DEFAULT 1
  CHECK (tracks_expiry IN (0, 1));

UPDATE products SET tracks_expiry = 0 WHERE lower(category) LIKE '%pulseira%';

PRAGMA user_version = 33;

COMMIT;
