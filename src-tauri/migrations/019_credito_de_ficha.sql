BEGIN IMMEDIATE;

-- ============================================================
-- Crédito de ficha: o cliente paga agora e retira depois.
--
-- Compra cinco cervejas, leva uma de cada vez. O dinheiro entra na venda; a
-- mercadoria sai da geladeira só na retirada.
--
-- Por que o estoque NÃO baixa na venda: enquanto a garrafa está na geladeira,
-- ela existe fisicamente. Baixar na venda faria a contagem de inventário
-- acusar sobra e o controle de validade descrever mercadoria que já saiu. A
-- receita é reconhecida na venda, a baixa acontece na entrega — são livros
-- diferentes, e cada um fica certo.
-- ============================================================
CREATE TABLE credit_vouchers (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  -- Como o cliente é chamado no balcão. Sem cadastro: é um apelido de fila.
  customer_name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  -- Preenchido quando a última unidade é retirada.
  settled_at TEXT
) STRICT;

CREATE INDEX idx_credit_vouchers_nome ON credit_vouchers(customer_name);
CREATE INDEX idx_credit_vouchers_aberto ON credit_vouchers(settled_at) WHERE settled_at IS NULL;

CREATE TABLE credit_voucher_items (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL REFERENCES credit_vouchers(id),
  product_id TEXT REFERENCES products(id),
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  taken_quantity INTEGER NOT NULL DEFAULT 0 CHECK (taken_quantity >= 0),
  CHECK (taken_quantity <= quantity)
) STRICT;

CREATE INDEX idx_credit_items_voucher ON credit_voucher_items(voucher_id);

CREATE TABLE credit_withdrawals (
  id TEXT PRIMARY KEY,
  voucher_item_id TEXT NOT NULL REFERENCES credit_voucher_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  -- Idempotência: dois cliques retiram uma vez só.
  client_withdrawal_id TEXT,
  actor_id TEXT REFERENCES users(id),
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_credit_withdrawals_cliente
  ON credit_withdrawals(client_withdrawal_id) WHERE client_withdrawal_id IS NOT NULL;

INSERT INTO permissions (key, grupo, rotulo, descricao, sort_order) VALUES
  ('credit.sell',    'Caixa', 'Vender por ficha',   'Cobrar agora e o cliente retirar depois.', 15),
  ('credit.withdraw','Caixa', 'Entregar ficha',     'Dar baixa na retirada de um crédito em aberto.', 16);

-- Quem opera o balcão precisa das duas: quem vende a ficha é quem entrega.
INSERT INTO role_permissions (role_key, permission)
SELECT papel, chave FROM (
  SELECT 'gerente' AS papel, 'credit.sell' AS chave UNION ALL
  SELECT 'gerente', 'credit.withdraw' UNION ALL
  SELECT 'supervisor', 'credit.sell' UNION ALL
  SELECT 'supervisor', 'credit.withdraw' UNION ALL
  SELECT 'atendente', 'credit.sell' UNION ALL
  SELECT 'atendente', 'credit.withdraw'
);

PRAGMA user_version = 19;

COMMIT;
