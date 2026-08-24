-- Pagamento de fatura ganha categoria propria, separada de
-- "Transferencia entre contas": as duas somem dos totais pela mesma razao
-- (o dinheiro ja foi contado na compra), mas sao coisas diferentes e a
-- pessoa precisa distinguir uma da outra na lista.
--
-- ADD VALUE roda dentro da transacao da migration a partir do Postgres 12,
-- desde que o valor novo nao seja usado nela mesma. Nao e: a linha da
-- categoria nasce em `ensureSystemCategories`, por usuario, no primeiro acesso.
ALTER TYPE "SystemCategoryKey" ADD VALUE 'BILL_PAYMENT';
