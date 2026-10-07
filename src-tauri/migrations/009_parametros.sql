BEGIN IMMEDIATE;

-- ============================================================
-- Parâmetros do sistema.
--
-- Valores que estavam fixos no código e que cada loja tem motivo para
-- ajustar. Ficam como dado para poderem ser alterados sem recompilar e
-- para viajarem no modelo de loja.
-- ============================================================
CREATE TABLE system_params (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('inteiro', 'texto', 'booleano')),
  grupo TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  minimo INTEGER,
  maximo INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100
) STRICT;

INSERT INTO system_params (key, value, tipo, grupo, rotulo, descricao, minimo, maximo, sort_order) VALUES
  ('estoque.minimo_alerta', '5', 'inteiro', 'Estoque', 'Estoque baixo a partir de',
   'Abaixo desta quantidade o produto aparece em alerta no caixa e no estoque.', 0, 999, 10),
  ('estoque.dias_validade_alerta', '45', 'inteiro', 'Estoque', 'Avisar validade com antecedência de',
   'Dias antes do vencimento em que o lote passa a aparecer como "vencendo".', 1, 365, 11),
  ('venda.numero_maximo', '999', 'inteiro', 'Venda', 'Número de pedido vai até',
   'A numeração da chapelaria cicla de 0 até este valor.', 9, 99999, 20),
  ('venda.exige_caixa_aberto', '1', 'booleano', 'Venda', 'Exigir caixa aberto para vender',
   'Impede vender sem turno aberto, o que inviabilizaria a conferência da gaveta.', NULL, NULL, 21),
  ('backup.retencao', '15', 'inteiro', 'Backup', 'Backups mantidos',
   'Quantidade de cópias guardadas antes de descartar as mais antigas.', 3, 200, 30),
  ('backup.horas_entre_automaticos', '20', 'inteiro', 'Backup', 'Intervalo do backup automático (horas)',
   'Tempo mínimo entre duas cópias automáticas na abertura do sistema.', 1, 168, 31),
  ('sessao.horas', '16', 'inteiro', 'Acesso', 'Sessão expira após (horas)',
   'Tempo que o operador permanece logado sem precisar digitar a senha de novo.', 1, 72, 40),
  ('lista.itens_por_pagina', '12', 'inteiro', 'Interface', 'Itens por página nas listas',
   'Quantas linhas aparecem por página no estoque e nos relatórios.', 5, 100, 50);

PRAGMA user_version = 9;
COMMIT;
