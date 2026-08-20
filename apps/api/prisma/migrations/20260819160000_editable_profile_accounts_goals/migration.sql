-- Foto de perfil do usuário (data URL base64)
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;

-- Logo da instituição escolhida manualmente. Coluna separada de
-- "institutionImageUrl" para que o sync com a Pluggy não a sobrescreva.
ALTER TABLE "Item" ADD COLUMN "customImageUrl" TEXT;

-- Nome da conta dado pelo usuário; tem precedência sobre "name", reescrito pelo sync.
ALTER TABLE "Account" ADD COLUMN "customName" TEXT;

-- Meta passa a derivar o acumulado do saldo de uma conta.
ALTER TABLE "Goal" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Goal" DROP COLUMN "currentAmount";

CREATE INDEX "Goal_accountId_idx" ON "Goal"("accountId");

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
