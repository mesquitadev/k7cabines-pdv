BEGIN IMMEDIATE;

-- ============================================================
-- Custo no item vendido.
--
-- Sem isto não existe CMV: o custo do produto muda a cada compra, então
-- calcular a margem de uma venda de março com o custo de hoje inventa um
-- número. O custo é congelado no momento da venda, como o preço já era.
--
-- Vendas anteriores ficam com NULL de propósito. O relatório conta quantas são
-- e avisa, em vez de fingir que sabe.
-- ============================================================
ALTER TABLE sale_items ADD COLUMN unit_cost_cents INTEGER;

PRAGMA user_version = 14;

COMMIT;
