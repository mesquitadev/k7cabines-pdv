BEGIN IMMEDIATE;

-- ============================================================
-- Instalação.
--
-- Cada loja recebe uma instalação independente: banco próprio, contas
-- próprias, nenhuma ligação com as outras. O identificador existe para
-- distinguir backups e cupons de lojas diferentes quando eles chegam
-- juntos ao suporte — nunca para comunicar uma instalação com a outra.
-- ============================================================
CREATE TABLE installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  store_city TEXT NOT NULL DEFAULT '',
  setup_completed INTEGER NOT NULL DEFAULT 0 CHECK (setup_completed IN (0, 1)),
  setup_at TEXT,
  app_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

-- Instalações que já existiam (upgrade) entram como configuradas, herdando
-- o nome da loja que já estava no cupom.
INSERT INTO installation (id, installation_id, store_name, store_city, setup_completed, setup_at, created_at)
SELECT
  1,
  lower(hex(randomblob(16))),
  COALESCE((SELECT NULLIF(TRIM(store_name), '') FROM ticket_settings WHERE id = 1), ''),
  '',
  CASE WHEN EXISTS (SELECT 1 FROM users WHERE active = 1) THEN 1 ELSE 0 END,
  CASE WHEN EXISTS (SELECT 1 FROM users WHERE active = 1)
       THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

PRAGMA user_version = 7;
COMMIT;
