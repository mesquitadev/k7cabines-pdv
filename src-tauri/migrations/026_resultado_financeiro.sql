BEGIN IMMEDIATE;

-- ============================================================
-- Pedido do cliente em 24/09/2026: o resultado financeiro (aba Resultado e
-- os cards de total, dinheiro, maquininha e vendas) é coisa do dono. Vira
-- permissão própria, para o funcionário ver só as outras abas.
-- Master tem tudo por definição; gerente ganha por padrão.
-- ============================================================
INSERT INTO permissions (key, grupo, rotulo, descricao, sort_order) VALUES
  ('reports.result', 'Relatórios', 'Resultado financeiro',
   'Aba Resultado e os totais do período (total, dinheiro, maquininha, vendas).', 36);

INSERT INTO role_permissions (role_key, permission)
SELECT 'gerente', 'reports.result'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions WHERE role_key = 'gerente' AND permission = 'reports.result'
);

PRAGMA user_version = 26;

COMMIT;
