-- Parcelas, tipos de conta e vencimento de cartao.
--
-- `DEBIT_CARD` existe porque a Pluggy nao tem esse conceito: para ela um cartao
-- de debito e a conta corrente a que esta preso. O valor so e alcancado por
-- `customType`, preenchido a mao.
--
-- ATENCAO: no Postgres um valor de enum recem-adicionado nao pode ser USADO na
-- mesma transacao em que foi criado. Os dois UPDATE abaixo so mencionam valores
-- que ja existiam ('SAVINGS', 'CREDIT'), entao esta migracao e segura como esta
-- — mas nao acrescente aqui nenhum comando que escreva 'DEBIT_CARD'.
ALTER TYPE "AccountType" ADD VALUE 'DEBIT_CARD';

ALTER TABLE "Account" ADD COLUMN "customType" "AccountType";
ALTER TABLE "Account" ADD COLUMN "creditCardDueDay" INTEGER;

ALTER TABLE "Transaction" ADD COLUMN "installmentIndex" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "installmentTotal" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "billMonth" TEXT;

-- Poupanca nasce fora do saldo disponivel: ela e reserva, nao e o que se pode
-- gastar hoje. Vale para as contas que ja estao no banco tambem, e nao so para
-- as que chegarem depois — senao a regra so valeria para quem conectar de novo.
-- O olhinho da tela de Perfil e o caminho de volta, conta a conta.
--
-- Escopo global de proposito: e um padrao novo do app, nao dado de um usuario.
UPDATE "Account" SET "excludedFromBalance" = true WHERE "type" = 'SAVINGS';

-- Cartao existente ganha o padrao 10. O `balanceDueDate` da Pluggy nunca foi
-- guardado, entao nao ha de onde tirar o dia certo para quem ja esta aqui;
-- cartao novo recebe o valor real no primeiro sync.
UPDATE "Account" SET "creditCardDueDay" = 10 WHERE "type" = 'CREDIT';
