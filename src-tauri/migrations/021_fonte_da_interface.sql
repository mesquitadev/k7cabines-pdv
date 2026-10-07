BEGIN IMMEDIATE;

-- ============================================================
-- Tamanho da letra da interface.
--
-- A tela é lida em pé, a um braço de distância, por gente diferente a cada
-- turno. Um número fixo no código serve a uma pessoa e atrapalha a outra —
-- e trocar a fonte não é decisão de desenvolvedor, é de quem opera.
--
-- É percentual sobre a base do sistema: 100 é o tamanho padrão, e tudo escala
-- junto (rótulo, campo, tabela) em vez de crescerem partes soltas.
-- ============================================================
INSERT INTO system_params (key, value, tipo, grupo, rotulo, descricao, minimo, maximo, sort_order)
VALUES ('interface.fonte', '106', 'inteiro', 'Interface', 'Tamanho da letra (%)',
        'Vale só nesta máquina e muda na hora. 100 é o padrão; acima de 130 os textos longos começam a quebrar.',
        85, 150, 40);

PRAGMA user_version = 21;

COMMIT;
