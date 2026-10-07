BEGIN IMMEDIATE;

-- ============================================================
-- Quantos dias de histórico de vendas cada perfil enxerga nos relatórios.
--
-- Pedido do cliente em 24/09/2026: o dono decide até onde o funcionário
-- olha para trás. 0 = sem limite. O master nunca é limitado.
-- ============================================================
ALTER TABLE roles ADD COLUMN history_days INTEGER NOT NULL DEFAULT 0;

-- O atendente já vinha limitado a 3 dias na tela; agora a regra é dado.
UPDATE roles SET history_days = 3 WHERE key = 'atendente' AND is_master = 0;

PRAGMA user_version = 24;

COMMIT;
