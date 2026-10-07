BEGIN IMMEDIATE;

-- "Resultado" entra na lista de Relatórios na mesma ordem das abas da tela:
-- Resultado, Vendas, Hora em hora, Por categoria, Alterações no estoque, Fechamento.
UPDATE permissions SET rotulo = 'Resultado',
       descricao = 'Aba Resultado e os totais do período (total, dinheiro, maquininha, vendas).',
       sort_order = 31
 WHERE key = 'reports.result';
UPDATE permissions SET sort_order = 32 WHERE key = 'reports.sales';
UPDATE permissions SET sort_order = 33 WHERE key = 'reports.hourly';
UPDATE permissions SET sort_order = 34 WHERE key = 'reports.categories';
UPDATE permissions SET sort_order = 35 WHERE key = 'reports.stock';
UPDATE permissions SET sort_order = 36 WHERE key = 'reports.closing';

PRAGMA user_version = 28;

COMMIT;
