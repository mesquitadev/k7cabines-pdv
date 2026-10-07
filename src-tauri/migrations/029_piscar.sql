BEGIN IMMEDIATE;

-- ============================================================
-- "Piscar": destaque na tela de venda (pedido do cliente em 24/09/2026).
--
-- A pulseira já fazia a tela piscar por ser o item que libera a cabine.
-- Agora o dono escolhe: liga no produto, ou na categoria para valer em
-- todos os produtos dela. Pulseiras nasce ligada, para nada mudar hoje.
-- ============================================================
ALTER TABLE products ADD COLUMN highlight INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN highlight INTEGER NOT NULL DEFAULT 0;

UPDATE categories SET highlight = 1
 WHERE parent_id IS NULL AND lower(name) LIKE '%pulseira%';

PRAGMA user_version = 29;

COMMIT;
