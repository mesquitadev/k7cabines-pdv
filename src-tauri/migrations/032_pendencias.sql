BEGIN IMMEDIATE;

-- ============================================================
-- Pendência: a ficha ao contrário (pedido do cliente em 15/10/2026).
--
-- Na ficha o cliente paga agora e retira depois. Na pendência ele leva agora
-- (a bolsa fica no guarda-volume) e paga na retirada. Mesmo papel, mesmo
-- código K7-XXXX, mesma regra de um item por papel. O que fica em aberto é o
-- dinheiro: a venda nasce com `pending_cents` e só entra no caixa ao pagar.
-- ============================================================
ALTER TABLE credit_vouchers ADD COLUMN kind TEXT NOT NULL DEFAULT 'ficha'
  CHECK (kind IN ('ficha', 'pendencia'));

ALTER TABLE sales ADD COLUMN pending_cents INTEGER NOT NULL DEFAULT 0
  CHECK (pending_cents >= 0);

PRAGMA user_version = 32;

COMMIT;
