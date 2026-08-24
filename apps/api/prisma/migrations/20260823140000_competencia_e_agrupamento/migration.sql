-- Competencia e agrupamento de parcelas.
--
-- `competenceDate` responde "em que mes esta despesa pesa?", que ate aqui era
-- respondido por `date` — e `date`, num parcelamento do Mercado Pago, e a data
-- da compra para as dez parcelas. O resultado era uma compra de R$ 300 em 10x
-- contando R$ 300 no mes da compra, em vez de R$ 30 por mes.
--
-- A coluna nasce anulavel so para caber o backfill: e preenchida numa passada
-- so e vira NOT NULL logo em seguida, no mesmo arquivo. Nao ganha DEFAULT
-- porque o valor certo e calculado pela aplicacao, e nao por now().
ALTER TABLE "Transaction" ADD COLUMN "competenceDate" TIMESTAMP(3);

-- Para tudo que ja existe, competencia e a propria data. O reparo do historico
-- recalcula as linhas de cartao depois; ate la, o app se comporta como hoje.
UPDATE "Transaction" SET "competenceDate" = "date";

ALTER TABLE "Transaction" ALTER COLUMN "competenceDate" SET NOT NULL;

ALTER TABLE "Transaction" ADD COLUMN "purchaseDate" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "purchaseKey" TEXT;

-- `userId, competenceDate` substitui `userId, date` como o indice que relatorio
-- e orcamento passam a usar. O antigo fica: a lista por intervalo de datas e o
-- pareamento de transferencia continuam na data real.
CREATE INDEX "Transaction_userId_competenceDate_idx" ON "Transaction"("userId", "competenceDate");
CREATE INDEX "Transaction_purchaseKey_idx" ON "Transaction"("purchaseKey");
