BEGIN IMMEDIATE;

-- ============================================================
-- Categorias como entidade.
--
-- Antes eram texto digitado a cada produto, o que gerava "Bebidas",
-- "bebidas" e "Bebida" convivendo. Agora existem de verdade, com cor e
-- ordem próprias — o caixa deixa de ter as cores fixas no código.
-- ============================================================
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  color TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Nome único dentro do mesmo pai. COALESCE porque no SQLite dois NULL
-- não colidem num índice único.
CREATE UNIQUE INDEX idx_categories_nome
  ON categories(COALESCE(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX idx_categories_pai ON categories(parent_id, sort_order);

-- Categorias existentes, extraídas do que já está nos produtos.
INSERT INTO categories (id, name, parent_id, color, sort_order, active, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  TRIM(category),
  NULL,
  CASE
    WHEN lower(TRIM(category)) LIKE '%pulseira%' THEN 'var(--linha-pulseira)'
    WHEN lower(TRIM(category)) LIKE '%bebida%'   THEN 'var(--linha-bebida)'
    WHEN lower(TRIM(category)) LIKE '%erotic%'   THEN 'var(--linha-erotico)'
    WHEN lower(TRIM(category)) LIKE '%er_tic%'   THEN 'var(--linha-erotico)'
    ELSE 'var(--linha-outro)'
  END,
  CASE
    WHEN lower(TRIM(category)) LIKE '%pulseira%' THEN 0
    WHEN lower(TRIM(category)) LIKE '%erotic%'   THEN 20
    WHEN lower(TRIM(category)) LIKE '%er_tic%'   THEN 20
    ELSE 10
  END,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT DISTINCT TRIM(category) AS category FROM products WHERE TRIM(category) <> '')
ORDER BY category;

-- Subcategorias existentes viram filhas da sua categoria.
INSERT INTO categories (id, name, parent_id, color, sort_order, active, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  TRIM(p.subcategory),
  c.id,
  '',
  100,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT DISTINCT TRIM(category) AS category, TRIM(subcategory) AS subcategory
      FROM products WHERE TRIM(COALESCE(subcategory, '')) <> '') p
JOIN categories c ON c.name = p.category AND c.parent_id IS NULL;

-- ============================================================
-- Produto: vínculo com categoria e variações de um nível.
--
-- A variação é o item vendido: tem preço, custo, código de barras,
-- estoque e lotes próprios. O produto pai só agrupa — e por isso não
-- aparece no caixa quando tem filhos.
-- ============================================================
ALTER TABLE products ADD COLUMN category_id TEXT REFERENCES categories(id);
ALTER TABLE products ADD COLUMN parent_id TEXT REFERENCES products(id);
ALTER TABLE products ADD COLUMN variant_name TEXT NOT NULL DEFAULT '';

UPDATE products
SET category_id = (
  SELECT c.id FROM categories c
  WHERE c.parent_id IS NULL AND c.name = TRIM(products.category)
);

CREATE INDEX idx_products_categoria ON products(category_id);
CREATE INDEX idx_products_pai ON products(parent_id);

PRAGMA user_version = 10;
COMMIT;
