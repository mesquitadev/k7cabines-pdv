BEGIN IMMEDIATE;

-- ============================================================
-- A conta master permanente é do sistema, não de uma pessoa.
--
-- Ela existe para garantir que sempre haja como administrar a
-- instalação, e por isso não deve carregar o nome de ninguém: quem
-- opera o dia a dia usa a própria conta nominal, criada por ela.
-- A senha atual continua valendo; muda apenas a identificação.
-- ============================================================
UPDATE users
SET username = 'master',
    full_name = 'Master do Sistema',
    whatsapp = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_permanent = 1
  AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.username = 'master' AND u2.is_permanent = 0);

PRAGMA user_version = 6;
COMMIT;
