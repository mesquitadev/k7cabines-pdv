BEGIN IMMEDIATE;

-- ============================================================
-- Ficha ao portador (pedido do cliente em 24/09/2026).
--
-- A ficha deixa de depender do nome: quem apresenta o papel retira. O que a
-- identifica é um código curto, impresso em corpo grande, único entre todas
-- as fichas. O nome vira opcional — ajuda a achar, não é chave.
-- ============================================================
ALTER TABLE credit_vouchers ADD COLUMN code TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX idx_credit_vouchers_code ON credit_vouchers(code) WHERE code <> '';

PRAGMA user_version = 25;

COMMIT;
