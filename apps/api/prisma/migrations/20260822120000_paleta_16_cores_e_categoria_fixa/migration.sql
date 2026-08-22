-- Duas mudanças na categoria: a paleta encolheu de 24 para 16 cores, e cada
-- categoria passa a declarar se é fixa ou variável.

-- ---------------------------------------------------------------------------
-- Paleta: 24 → 16, reordenada pelo círculo cromático
--
-- As chaves de cor são posicionais ("7" era Índigo, agora é Ciano), então
-- reordenar a paleta obriga a reescrever o que está gravado — sem isto toda
-- categoria trocaria de cor sozinha, e as oito chaves removidas cairiam no
-- fallback, deixando metade das categorias verdes.
--
-- O mapa abaixo leva cada chave antiga à sobrevivente mais próxima em matiz:
-- Esmeralda e Floresta viram Verde, Terracota vira Laranja, Mostarda vira
-- Âmbar, Oliva vira Lima, Petróleo vira Ciano, Marinho vira Azul, Ardósia vira
-- Grafite e Vinho vira Carmim. A ordem do CASE importa: é uma tradução de
-- valores antigos para novos, feita de uma vez só, e não uma sequência de
-- UPDATEs que se atropelariam (5 → 13 e depois 13 → 1).
UPDATE "Category" SET "colorKey" = CASE "colorKey"
  WHEN '1'  THEN '5'   -- Esmeralda  → Verde
  WHEN '2'  THEN '8'   -- Azul Real  → Azul
  WHEN '3'  THEN '10'  -- Roxo       → Roxo
  WHEN '4'  THEN '3'   -- Âmbar      → Âmbar
  WHEN '5'  THEN '13'  -- Carmim     → Carmim
  WHEN '6'  THEN '6'   -- Turquesa   → Turquesa
  WHEN '7'  THEN '9'   -- Índigo     → Índigo
  WHEN '8'  THEN '12'  -- Pink       → Pink
  WHEN '9'  THEN '2'   -- Laranja    → Laranja
  WHEN '10' THEN '7'   -- Ciano      → Ciano
  WHEN '11' THEN '4'   -- Lima       → Lima
  WHEN '12' THEN '16'  -- Grafite    → Grafite
  WHEN '13' THEN '1'   -- Vermelho   → Vermelho
  WHEN '14' THEN '2'   -- Terracota  → Laranja
  WHEN '15' THEN '14'  -- Café       → Café
  WHEN '16' THEN '3'   -- Mostarda   → Âmbar
  WHEN '17' THEN '4'   -- Oliva      → Lima
  WHEN '18' THEN '5'   -- Floresta   → Verde
  WHEN '19' THEN '15'  -- Sálvia     → Sálvia
  WHEN '20' THEN '7'   -- Petróleo   → Ciano
  WHEN '21' THEN '8'   -- Marinho    → Azul
  WHEN '22' THEN '16'  -- Ardósia    → Grafite
  WHEN '23' THEN '11'  -- Fúcsia     → Fúcsia
  WHEN '24' THEN '13'  -- Vinho      → Carmim
  ELSE '5'             -- chave desconhecida: o mesmo verde do fallback do app
END;

-- ---------------------------------------------------------------------------
-- Fixa ou variável
--
-- Nasce toda variável de propósito: fixa é a afirmação forte ("isto se repete
-- com o mesmo valor todo mês"), e adivinhá-la a partir do histórico daria um
-- relatório que mente com confiança. Quem sabe quais são as suas fixas é o
-- usuário, e marcar meia dúzia de categorias é trabalho de um minuto.
CREATE TYPE "CategoryKind" AS ENUM ('FIXED', 'VARIABLE');

ALTER TABLE "Category"
  ADD COLUMN "kind" "CategoryKind" NOT NULL DEFAULT 'VARIABLE';
