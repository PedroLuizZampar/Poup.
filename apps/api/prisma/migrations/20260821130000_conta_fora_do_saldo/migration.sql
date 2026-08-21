-- Conta que o usuário não quer ver somada nos cards de saldo.
--
-- É preferência de exibição, não exclusão: as transações continuam valendo em
-- relatórios, orçamentos e na tela de Transações. Por isso mora na conta, e não
-- num filtro que cada tela teria de lembrar de aplicar.
ALTER TABLE "Account" ADD COLUMN "excludedFromBalance" BOOLEAN NOT NULL DEFAULT false;
