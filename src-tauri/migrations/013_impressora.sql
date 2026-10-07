BEGIN IMMEDIATE;

-- ============================================================
-- Impressora: configuração local da estação.
--
-- Fica fora de `ticket_settings` de propósito. O conteúdo do cupom é da loja e
-- viaja no template entre lojas; a impressora é da máquina — nome do
-- dispositivo, largura do papel, se corta, se abre a gaveta. Misturar os dois
-- faria a exportação de template levar o nome de uma impressora que só existe
-- num balcão.
-- ============================================================
CREATE TABLE printer_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Nome no sistema operacional. Vazio = usar o diálogo do navegador.
  printer_name TEXT NOT NULL DEFAULT '',
  -- 58 ou 80 mm; define quantas colunas cabem.
  paper_width_mm INTEGER NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  columns INTEGER NOT NULL DEFAULT 48 CHECK (columns BETWEEN 24 AND 64),
  copies INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 5),
  -- Linhas em branco antes do corte, para o papel passar da serrilha.
  feed_lines INTEGER NOT NULL DEFAULT 4 CHECK (feed_lines BETWEEN 0 AND 12),
  cut_paper INTEGER NOT NULL DEFAULT 1 CHECK (cut_paper IN (0, 1)),
  open_drawer INTEGER NOT NULL DEFAULT 0 CHECK (open_drawer IN (0, 1)),
  -- ESC/POS bruto quando a impressora é térmica; texto quando é comum.
  mode TEXT NOT NULL DEFAULT 'escpos' CHECK (mode IN ('escpos', 'texto', 'navegador')),
  -- Página de código do fabricante para acentos. 16 = WPC1252 na maioria.
  codepage INTEGER NOT NULL DEFAULT 16 CHECK (codepage BETWEEN 0 AND 255),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO printer_settings (id, updated_at) VALUES (1, datetime('now'));

INSERT INTO permissions (key, grupo, rotulo, descricao, sort_order) VALUES
  ('printer.configure', 'Sistema', 'Configurar impressora',
   'Escolher o dispositivo, ajustar papel e imprimir teste.', 43);

INSERT INTO role_permissions (role_key, permission)
SELECT 'gerente', 'printer.configure';

PRAGMA user_version = 13;

COMMIT;
