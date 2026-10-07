BEGIN IMMEDIATE;

-- ============================================================
-- Impressão automática.
--
-- O cupom da venda já saía sozinho, por decisão fixa no código. Agora é
-- parâmetro: há balcão que imprime tudo e há balcão que só imprime quando o
-- cliente pede, para não gastar bobina.
--
-- A ficha ganha impressão própria. Ela é um comprovante diferente do cupom:
-- o cupom prova o que foi pago, a ficha prova o que ainda há para retirar —
-- e é ela que o cliente leva no bolso e apresenta na volta.
-- ============================================================
ALTER TABLE printer_settings
  ADD COLUMN auto_print_sale INTEGER NOT NULL DEFAULT 1
  CHECK (auto_print_sale IN (0, 1));

ALTER TABLE printer_settings
  ADD COLUMN auto_print_credit INTEGER NOT NULL DEFAULT 1
  CHECK (auto_print_credit IN (0, 1));

-- Vias da ficha: uma para o cliente, outra para ficar no balcão, se a loja quiser.
ALTER TABLE printer_settings
  ADD COLUMN credit_copies INTEGER NOT NULL DEFAULT 1
  CHECK (credit_copies BETWEEN 1 AND 3);

PRAGMA user_version = 20;

COMMIT;
