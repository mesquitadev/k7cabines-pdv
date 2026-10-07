BEGIN IMMEDIATE;

-- ============================================================
-- Identificação de produto: unidade de medida.
--
-- SKU e GTIN já existem como `code` e `barcode`; o que faltava era validação,
-- que vive no Rust (src/identificacao.rs). Aqui entra só a unidade, que é
-- coluna nova e precisa de padrão para as linhas já cadastradas.
--
-- A transação não é enfeite: sem ela o ALTER pode aplicar e o `user_version`
-- não, e o próximo start tenta criar a coluna de novo e o app não abre.
-- ============================================================
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'UN';

PRAGMA user_version = 11;

COMMIT;
