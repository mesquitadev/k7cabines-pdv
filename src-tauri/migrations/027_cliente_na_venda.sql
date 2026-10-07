BEGIN IMMEDIATE;

-- Pedido do cliente em 24/09/2026: no fechamento, cada desconto sai com
-- usuário, cliente, produto e motivo. O nome do cliente passa a viver na
-- venda (opcional); a ficha continua guardando o seu.
ALTER TABLE sales ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';

PRAGMA user_version = 27;

COMMIT;
