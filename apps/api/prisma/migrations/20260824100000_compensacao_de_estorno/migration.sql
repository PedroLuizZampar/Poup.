-- Compensacao de estorno de compra parcelada.
--
-- Um uuid compartilhado pelo credito do estorno e pelas N parcelas que ele
-- cancela — mesmo desenho do `transferPairId`. Com ele o vinculo e idempotente
-- e o desfazer e uma escrita so.
--
-- Aditiva e sem backfill: nenhuma linha existente e tocada. Nulo continua sendo
-- o normal, e significa "conta em todos os totais, como sempre contou".
ALTER TABLE "Transaction" ADD COLUMN "compensationId" TEXT;
CREATE INDEX "Transaction_compensationId_idx" ON "Transaction"("compensationId");
