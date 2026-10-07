BEGIN IMMEDIATE;

-- ============================================================
-- Assistente de configuração inicial.
--
-- Depois de nomear a loja e criar o master, a instalação nova passa por um
-- roteiro: dados do cupom, impressora, parâmetros e catálogo. Instalações que
-- já existem entram como concluídas — ninguém é mandado de volta ao começo.
-- ============================================================
ALTER TABLE installation ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1
  CHECK (onboarding_completed IN (0, 1));

PRAGMA user_version = 30;

COMMIT;
