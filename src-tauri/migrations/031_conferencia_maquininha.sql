BEGIN IMMEDIATE;

-- ============================================================
-- Conferência da maquininha no fechamento de turno.
--
-- Pedido do cliente em 15/10/2026: só conferir o dinheiro deixa passar venda
-- que não foi cobrada na maquininha. O operador olha o relatório da máquina,
-- digita o total, e o sistema compara com o que as vendas dizem.
-- Turnos já fechados ficam com NULL: ninguém conferiu, não há diferença.
-- ============================================================
ALTER TABLE cash_sessions ADD COLUMN expected_card_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN counted_card_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN card_difference_cents INTEGER;

PRAGMA user_version = 31;

COMMIT;
