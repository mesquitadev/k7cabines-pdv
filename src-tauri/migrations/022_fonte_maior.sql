BEGIN IMMEDIATE;

-- Pedido do cliente em 24/09/2026: letra maior por padrão. Só mexe em quem
-- ainda está no valor de fábrica antigo; quem já ajustou mantém o seu.
UPDATE system_params SET value = '115' WHERE key = 'interface.fonte' AND value = '106';

PRAGMA user_version = 22;

COMMIT;
