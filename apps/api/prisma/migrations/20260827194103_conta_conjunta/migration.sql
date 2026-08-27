-- 1. Os modelos novos.
CREATE TYPE "HouseholdInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseholdInvite" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "status" "HouseholdInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "HouseholdInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HouseholdInvite_inviteeId_status_idx" ON "HouseholdInvite"("inviteeId", "status");
CREATE INDEX "HouseholdInvite_householdId_status_idx" ON "HouseholdInvite"("householdId", "status");

-- Um convite pendente por par, garantido pelo banco e nao por um `findFirst`
-- que duas requisicoes simultaneas atravessam juntas.
CREATE UNIQUE INDEX "HouseholdInvite_pendente_por_par"
  ON "HouseholdInvite" ("householdId", "inviteeId")
  WHERE "status" = 'PENDING';

ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Um espaco por usuario que ja existe.
--
-- `AS MATERIALIZED` nao e enfeite: `gen_random_uuid()` e volatil, e sem a
-- materializacao explicita nada garante que o id inserido no Household seja o
-- mesmo gravado no User.
ALTER TABLE "User" ADD COLUMN "householdId" TEXT;

WITH novos AS MATERIALIZED (
  SELECT u."id" AS user_id, gen_random_uuid()::text AS household_id FROM "User" u
), inseridos AS (
  INSERT INTO "Household" ("id") SELECT household_id FROM novos
)
UPDATE "User" u SET "householdId" = n.household_id FROM novos n WHERE u."id" = n.user_id;

ALTER TABLE "User" ALTER COLUMN "householdId" SET NOT NULL;
CREATE INDEX "User_householdId_idx" ON "User"("householdId");
ALTER TABLE "User" ADD CONSTRAINT "User_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Category: preenche, torna obrigatorio, e so entao derruba o userId.
ALTER TABLE "Category" ADD COLUMN "householdId" TEXT;
UPDATE "Category" c SET "householdId" = u."householdId" FROM "User" u WHERE u."id" = c."userId";
ALTER TABLE "Category" ALTER COLUMN "householdId" SET NOT NULL;

DROP INDEX "Category_userId_name_key";
DROP INDEX "Category_userId_systemKey_key";
ALTER TABLE "Category" DROP CONSTRAINT "Category_userId_fkey";
ALTER TABLE "Category" DROP COLUMN "userId";

ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");
CREATE UNIQUE INDEX "Category_householdId_systemKey_key" ON "Category"("householdId", "systemKey");

-- 4. Budget.
ALTER TABLE "Budget" ADD COLUMN "householdId" TEXT;
UPDATE "Budget" b SET "householdId" = u."householdId" FROM "User" u WHERE u."id" = b."userId";
ALTER TABLE "Budget" ALTER COLUMN "householdId" SET NOT NULL;

DROP INDEX "Budget_userId_categoryId_key";
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_userId_fkey";
ALTER TABLE "Budget" DROP COLUMN "userId";

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Budget_householdId_categoryId_key" ON "Budget"("householdId", "categoryId");

-- 5. Goal, que alem do espaco ganha o dono da criacao.
ALTER TABLE "Goal" ADD COLUMN "householdId" TEXT;
ALTER TABLE "Goal" ADD COLUMN "createdByUserId" TEXT;
UPDATE "Goal" g SET "householdId" = u."householdId", "createdByUserId" = g."userId" FROM "User" u WHERE u."id" = g."userId";
ALTER TABLE "Goal" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "Goal" ALTER COLUMN "createdByUserId" SET NOT NULL;

ALTER TABLE "Goal" DROP CONSTRAINT "Goal_userId_fkey";
ALTER TABLE "Goal" DROP COLUMN "userId";

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Goal_householdId_idx" ON "Goal"("householdId");
CREATE INDEX "Goal_createdByUserId_idx" ON "Goal"("createdByUserId");
