BEGIN IMMEDIATE;

-- Pedido do cliente em 24/09/2026: desconto não pede senha, pede motivo por
-- escrito, e o motivo sai no relatório de fechamento.
ALTER TABLE sales ADD COLUMN discount_reason TEXT NOT NULL DEFAULT '';

PRAGMA user_version = 23;

COMMIT;
