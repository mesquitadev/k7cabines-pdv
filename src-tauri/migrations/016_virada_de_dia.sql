BEGIN IMMEDIATE;

-- ============================================================
-- Virada de dia com turno esquecido aberto.
--
-- Quando ninguém fecha à noite, o dia seguinte cai na conferência de ontem e a
-- diferença apurada deixa de significar qualquer coisa. A saída não pode ser
-- fechar sozinho inventando um valor contado: conferência é contar dinheiro.
--
-- Então existe um encerramento SEM conferência: grava o esperado, deixa o
-- contado nulo e marca a sessão. O relatório de fechamento passa a distinguir
-- "conferido, diferença X" de "encerrado sem contagem" — o segundo é um alerta
-- de processo, não um número.
-- ============================================================
ALTER TABLE cash_sessions
  ADD COLUMN closed_without_count INTEGER NOT NULL DEFAULT 0
  CHECK (closed_without_count IN (0, 1));

PRAGMA user_version = 16;

COMMIT;
