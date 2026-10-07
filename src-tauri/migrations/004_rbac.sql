BEGIN IMMEDIATE;

-- ============================================================
-- RBAC: papéis como dado, não como constante no código.
-- ============================================================
CREATE TABLE roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Papel de sistema não pode ser renomeado nem excluído.
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  -- O master carrega todas as permissões por definição, sempre.
  is_master INTEGER NOT NULL DEFAULT 0 CHECK (is_master IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE role_permissions (
  role_key TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_key, permission)
) STRICT;

-- Catálogo de permissões: a tela de usuários se desenha a partir daqui,
-- em vez de repetir a lista no código do React.
CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  grupo TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100
) STRICT;

INSERT INTO roles (key, name, description, is_system, is_master, sort_order, created_at) VALUES
  ('master', 'Master', 'Administra contas, permissões, backup e configuração. Tem tudo, sempre.', 1, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('gerente', 'Gerente', 'Opera e administra a loja, sem gerir contas do sistema.', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('supervisor', 'Supervisor', 'Caixa, estoque e relatórios. Não exclui produto nem fecha caixa.', 1, 0, 2, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('atendente', 'Atendente', 'Opera o caixa.', 1, 0, 3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO permissions (key, grupo, rotulo, descricao, sort_order) VALUES
  ('pdv.use',            'Caixa',      'Operar o caixa',            'Registrar vendas e imprimir cupom.', 10),
  ('sale.discount',      'Caixa',      'Conceder desconto',         'Aplicar desconto em item ou no total.', 11),
  ('sale.return',        'Caixa',      'Devolver e estornar',       'Devolver item de venda fechada.', 12),
  ('cash.operate',       'Caixa',      'Abrir caixa e sangrar',     'Abrir o turno, fazer sangria e suprimento.', 13),
  ('cash.manage',        'Caixa',      'Fechar o caixa',            'Conferir a gaveta e fechar o turno.', 14),
  ('stock.view',         'Estoque',    'Ver estoque',               'Consultar produtos e lotes.', 20),
  ('stock.create',       'Estoque',    'Cadastrar produto',         '', 21),
  ('stock.edit',         'Estoque',    'Editar produto',            '', 22),
  ('stock.add',          'Estoque',    'Adicionar estoque',         'Entrada com lote e validade.', 23),
  ('stock.remove',       'Estoque',    'Remover estoque',           'Saída manual e descarte de lote.', 24),
  ('stock.batches',      'Estoque',    'Gerenciar lotes',           '', 25),
  ('stock.inventory',    'Estoque',    'Fazer inventário',          'Conferir físico contra sistema e ajustar.', 26),
  ('stock.delete',       'Estoque',    'Excluir produto',           'Exclusão lógica, preserva o histórico.', 27),
  ('reports.view',       'Relatórios', 'Acessar relatórios',        '', 30),
  ('reports.sales',      'Relatórios', 'Vendas',                    'Inclui excluir venda com motivo.', 31),
  ('reports.hourly',     'Relatórios', 'Hora em hora',              '', 32),
  ('reports.categories', 'Relatórios', 'Por categoria',             '', 33),
  ('reports.stock',      'Relatórios', 'Alterações no estoque',     '', 34),
  ('reports.closing',    'Relatórios', 'Fechamento',                '', 35),
  ('printer.manage',     'Sistema',    'Configurar cupom',          'Layout do cupom e chave PIX.', 40),
  ('users.manage',       'Sistema',    'Gerir usuários',            'Criar contas, papéis e permissões.', 41),
  ('backup.manage',      'Sistema',    'Backup e restauração',      '', 42);

-- Permissões padrão de cada papel de sistema. Master não entra: tem tudo por definição.
INSERT INTO role_permissions (role_key, permission)
SELECT 'gerente', key FROM permissions WHERE key <> 'users.manage';

INSERT INTO role_permissions (role_key, permission)
SELECT 'supervisor', key FROM permissions
WHERE key IN ('pdv.use', 'sale.discount', 'cash.operate',
              'stock.view', 'stock.create', 'stock.edit', 'stock.add', 'stock.remove',
              'stock.batches', 'stock.inventory',
              'reports.view', 'reports.sales', 'reports.hourly', 'reports.categories',
              'reports.stock', 'reports.closing');

INSERT INTO role_permissions (role_key, permission)
SELECT 'atendente', key FROM permissions
WHERE key IN ('pdv.use', 'cash.operate', 'stock.view',
              'reports.view', 'reports.sales', 'reports.hourly', 'reports.categories');

-- ============================================================
-- users: a restrição antiga só aceitava três papéis. Reconstrução
-- para referenciar roles(key) e ganhar a troca de senha obrigatória.
-- ============================================================
CREATE TABLE users_novo (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  whatsapp TEXT,
  role TEXT NOT NULL REFERENCES roles(key),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO users_novo (id, username, password_hash, full_name, whatsapp, role, active,
                        must_change_password, last_login_at, created_at, updated_at)
SELECT id, username, password_hash, full_name, whatsapp, role, active,
       0, last_login_at, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_novo RENAME TO users;

-- O primeiro gerente da instalação vira master: é a única conta administrativa
-- existente e ficar sem master trancaria o dono fora do próprio sistema.
UPDATE users
SET role = 'master'
WHERE id = (SELECT id FROM users WHERE role = 'gerente' AND active = 1
            ORDER BY created_at LIMIT 1);

-- As permissões por usuário passam a ser exceções sobre o papel, não a fonte.
INSERT OR IGNORE INTO user_permissions (user_id, permission)
SELECT id, 'backup.manage' FROM users WHERE role IN ('master', 'gerente');

PRAGMA user_version = 4;
COMMIT;
