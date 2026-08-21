-- "Sem categoria" deixa de ser duas categorias.
--
-- A separação por tipo (`UNCATEGORIZED_EXPENSE` / `UNCATEGORIZED_INCOME`) nunca
-- foi uma decisão do usuário: ele marca "Sem categoria" e pronto. O preço eram
-- dois nomes internos ("Sem categoria (despesa)" / "(receita)") que vazavam em
-- toda tela que lê `category.name` sem passar por `displayCategory`.
--
-- A migração funde as duas por usuário, mantendo a de despesa como sobrevivente
-- (é a que a maioria das transações aponta), e recria o enum sem os valores
-- antigos — Postgres não remove valor de enum, só troca o tipo inteiro.

-- 1. Transações e sugestões da oculta de receita passam para a de despesa.
UPDATE "Transaction" t
SET "categoryId" = despesa.id
FROM "Category" receita
JOIN "Category" despesa
  ON despesa."userId" = receita."userId"
 AND despesa."systemKey" = 'UNCATEGORIZED_EXPENSE'
WHERE receita."systemKey" = 'UNCATEGORIZED_INCOME'
  AND t."categoryId" = receita.id;

UPDATE "CategorySuggestion" s
SET "categoryId" = despesa.id
FROM "Category" receita
JOIN "Category" despesa
  ON despesa."userId" = receita."userId"
 AND despesa."systemKey" = 'UNCATEGORIZED_EXPENSE'
WHERE receita."systemKey" = 'UNCATEGORIZED_INCOME'
  AND s."categoryId" = receita.id;

UPDATE "CategorySuggestion" s
SET "resolvedCategoryId" = despesa.id
FROM "Category" receita
JOIN "Category" despesa
  ON despesa."userId" = receita."userId"
 AND despesa."systemKey" = 'UNCATEGORIZED_EXPENSE'
WHERE receita."systemKey" = 'UNCATEGORIZED_INCOME'
  AND s."resolvedCategoryId" = receita.id;

-- 2. Quem tinha só a de receita (usuário sem nenhuma despesa importada) fica com
--    ela: vira a única, em vez de ser apagada e levar as transações junto.
UPDATE "Category" receita
SET "systemKey" = 'UNCATEGORIZED_EXPENSE'
WHERE receita."systemKey" = 'UNCATEGORIZED_INCOME'
  AND NOT EXISTS (
    SELECT 1 FROM "Category" d
    WHERE d."userId" = receita."userId" AND d."systemKey" = 'UNCATEGORIZED_EXPENSE'
  );

-- 3. As de receita que sobraram já não têm nada apontando para elas.
DELETE FROM "Category" WHERE "systemKey" = 'UNCATEGORIZED_INCOME';

-- 4. O nome, agora que é uma só. `@@unique([userId, name])` continua valendo:
--    quem já tivesse uma categoria própria chamada "Sem categoria" teria sido
--    adotada como a de sistema em `ensureSystemCategories`, e não existe duas.
UPDATE "Category" SET "name" = 'Sem categoria' WHERE "systemKey" = 'UNCATEGORIZED_EXPENSE';

-- 5. O enum, sem os dois valores por tipo.
ALTER TYPE "SystemCategoryKey" RENAME TO "SystemCategoryKey_old";
CREATE TYPE "SystemCategoryKey" AS ENUM ('TRANSFER', 'UNCATEGORIZED');
-- O NULL precisa continuar NULL: ele é o que distingue as categorias do próprio
-- usuário das que o app mantém. Um `CASE systemKey WHEN ... ELSE` cairia no ELSE
-- para NULL e transformaria a lista inteira de categorias em ocultas.
ALTER TABLE "Category"
  ALTER COLUMN "systemKey" TYPE "SystemCategoryKey"
  USING (
    CASE
      WHEN "systemKey" IS NULL THEN NULL
      WHEN "systemKey"::text = 'TRANSFER' THEN 'TRANSFER'
      ELSE 'UNCATEGORIZED'
    END
  )::"SystemCategoryKey";
DROP TYPE "SystemCategoryKey_old";
