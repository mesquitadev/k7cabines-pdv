BEGIN IMMEDIATE;

-- ============================================================
-- Devolução: rastro por lote e proteção contra repetição.
--
-- 1. `returned_quantity` no vínculo item×lote.
--
--    A recomposição relia o consumo ORIGINAL a cada devolução e sempre
--    começava pelo último lote. Duas devoluções parciais do mesmo item
--    devolviam a mesma unidade ao mesmo lote duas vezes: o total do produto
--    batia, mas uma unidade migrava de um lote que vence em janeiro para um
--    que vence em junho. Ela seria vendida depois de vencida, e o alerta de
--    validade não a veria — grave em produto perecível.
--
-- 2. `client_return_id` único.
--
--    A devolução não tinha chave de idempotência: dois cliques devolviam duas
--    vezes, repunham estoque duas vezes e estornavam dinheiro duas vezes.
--    Mesma proteção que a venda já tem com `client_sale_id`.
-- ============================================================
ALTER TABLE sale_item_batches
  ADD COLUMN returned_quantity INTEGER NOT NULL DEFAULT 0
  CHECK (returned_quantity >= 0);

ALTER TABLE sale_returns ADD COLUMN client_return_id TEXT;

CREATE UNIQUE INDEX idx_sale_returns_cliente
  ON sale_returns(client_return_id) WHERE client_return_id IS NOT NULL;

PRAGMA user_version = 18;

COMMIT;
