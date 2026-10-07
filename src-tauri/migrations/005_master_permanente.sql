BEGIN IMMEDIATE;

-- ============================================================
-- Master permanente.
--
-- Uma conta marcada como permanente não pode ser excluída, desativada
-- nem rebaixada de papel — nem por ela mesma, nem por outro master.
-- É o que garante que sempre exista alguém capaz de administrar o
-- sistema num aplicativo offline, onde não há suporte remoto para
-- destravar ninguém. A senha continua trocável: o que é imutável é a
-- existência da conta, não a credencial.
-- ============================================================
ALTER TABLE users ADD COLUMN is_permanent INTEGER NOT NULL DEFAULT 0
  CHECK (is_permanent IN (0, 1));

-- O master mais antigo da instalação é o permanente.
UPDATE users
SET is_permanent = 1
WHERE id = (
  SELECT id FROM users
  WHERE role = 'master' AND active = 1
  ORDER BY created_at
  LIMIT 1
);

PRAGMA user_version = 5;
COMMIT;
