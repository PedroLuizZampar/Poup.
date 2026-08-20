-- Enums
CREATE TYPE "SystemCategoryKey" AS ENUM ('TRANSFER', 'UNCATEGORIZED_EXPENSE', 'UNCATEGORIZED_INCOME');
CREATE TYPE "SuggestionSource" AS ENUM ('HISTORY', 'RULE', 'PLUGGY');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CHANGED', 'DISMISSED');

-- Colunas novas
ALTER TABLE "Category" ADD COLUMN "systemKey" "SystemCategoryKey";
ALTER TABLE "Transaction" ADD COLUMN "transferPairId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "link" TEXT;

CREATE UNIQUE INDEX "Category_userId_systemKey_key" ON "Category"("userId", "systemKey");
CREATE INDEX "Transaction_transferPairId_idx" ON "Transaction"("transferPairId");

-- Tabela de sugestões
CREATE TABLE "CategorySuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "SuggestionSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedCategoryId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CategorySuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CategorySuggestion_transactionId_key" ON "CategorySuggestion"("transactionId");
CREATE INDEX "CategorySuggestion_userId_status_idx" ON "CategorySuggestion"("userId", "status");

ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Adoção: se o usuário já tem uma categoria com um dos nomes reservados, ela
-- vira a de sistema em vez de colidir com o unique (userId, name). Ninguém
-- perde histórico, e o unique parcial garante no máximo uma por usuário.
UPDATE "Category" SET "systemKey" = 'TRANSFER'
  WHERE "name" = 'Transferência entre contas' AND "systemKey" IS NULL;
UPDATE "Category" SET "systemKey" = 'UNCATEGORIZED_EXPENSE'
  WHERE "name" = 'Sem categoria (despesa)' AND "systemKey" IS NULL;
UPDATE "Category" SET "systemKey" = 'UNCATEGORIZED_INCOME'
  WHERE "name" = 'Sem categoria (receita)' AND "systemKey" IS NULL;

-- Criação para quem não tinha
INSERT INTO "Category" ("id", "userId", "name", "icon", "colorKey", "systemKey", "createdAt")
SELECT gen_random_uuid(), u."id", 'Transferência entre contas', 'repeat', '5', 'TRANSFER', NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND c."systemKey" = 'TRANSFER'
);

INSERT INTO "Category" ("id", "userId", "name", "icon", "colorKey", "systemKey", "createdAt")
SELECT gen_random_uuid(), u."id", 'Sem categoria (despesa)', 'dots', '5', 'UNCATEGORIZED_EXPENSE', NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND c."systemKey" = 'UNCATEGORIZED_EXPENSE'
);

INSERT INTO "Category" ("id", "userId", "name", "icon", "colorKey", "systemKey", "createdAt")
SELECT gen_random_uuid(), u."id", 'Sem categoria (receita)', 'dots', '5', 'UNCATEGORIZED_INCOME', NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND c."systemKey" = 'UNCATEGORIZED_INCOME'
);

-- Backfill: nenhuma transação fica sem categoria
UPDATE "Transaction" t
SET "categoryId" = c."id"
FROM "Category" c
WHERE t."categoryId" IS NULL
  AND c."userId" = t."userId"
  AND c."systemKey" = (
    CASE WHEN t."type" = 'EXPENSE' THEN 'UNCATEGORIZED_EXPENSE' ELSE 'UNCATEGORIZED_INCOME' END
  )::"SystemCategoryKey";
