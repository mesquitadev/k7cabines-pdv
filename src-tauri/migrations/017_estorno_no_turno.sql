BEGIN IMMEDIATE;

-- ============================================================
-- Estorno pertence ao turno em que o dinheiro saiu.
--
-- A conferência somava os estornos pelo turno da VENDA. Devolver hoje uma
-- compra de ontem tirava dinheiro real da gaveta de hoje e mexia no esperado
-- de um turno já fechado — o caixa de hoje fechava sobrando e o de ontem,
-- faltando, sem ninguém entender por quê.
--
-- Linhas antigas ficam com NULL: a leitura cai no turno da venda para elas,
-- que é o comportamento que já existia e o único palpite honesto sobre o
-- passado.
-- ============================================================
ALTER TABLE sale_returns ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id);

CREATE INDEX idx_sale_returns_turno
  ON sale_returns(cash_session_id) WHERE cash_session_id IS NOT NULL;

PRAGMA user_version = 17;

COMMIT;
