-- Faturas de cartao e o aviso do webhook.
--
-- A fatura existe para responder "esta paga, quando e por quanto?" com o dado
-- da propria instituicao (`payments[]` da Pluggy), em vez de adivinhar pela
-- descricao do debito na conta corrente. Reconhecer o pagamento e o que permite
-- marca-lo como transferencia — e transferencia ja e ignorada em todos os
-- totais, entao a despesa para de contar duas vezes.
CREATE TABLE "CreditCardBill" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "accountId"    TEXT NOT NULL,
  "pluggyBillId" TEXT NOT NULL,
  "dueDate"      TIMESTAMP(3) NOT NULL,
  "closingDate"  TIMESTAMP(3),
  "totalAmount"  DECIMAL(14,2) NOT NULL,
  "paidAt"       TIMESTAMP(3),
  "paidAmount"   DECIMAL(14,2),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCardBill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditCardBill_pluggyBillId_key" ON "CreditCardBill"("pluggyBillId");
CREATE INDEX "CreditCardBill_userId_dueDate_idx" ON "CreditCardBill"("userId", "dueDate");
CREATE INDEX "CreditCardBill_accountId_idx" ON "CreditCardBill"("accountId");

ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O vinculo do lado da transacao: a Pluggy nao expoe, neste SDK, um endpoint
-- que va da fatura para as transacoes dela.
ALTER TABLE "Transaction" ADD COLUMN "pluggyBillId" TEXT;
CREATE INDEX "Transaction_pluggyBillId_idx" ON "Transaction"("pluggyBillId");

-- Aviso de que o webhook viu transacao nova. Nasce falso para todo mundo: o
-- estado de hoje e "ninguem foi avisado de nada".
ALTER TABLE "Item" ADD COLUMN "hasPendingSync" BOOLEAN NOT NULL DEFAULT false;
