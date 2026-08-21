-- A revisão passa a ser feita por categoria, em lote: cada página lista as
-- transações que o app sugeriu para uma categoria, todas pré-marcadas, e o que
-- o usuário desmarca é um palpite recusado à mão.
--
-- Sem esta coluna a recusa não sobreviveria ao passo seguinte: depois de cada
-- lote o app reavalia as pendentes com o histórico recém-atualizado, e a
-- transação desmarcada receberia de volta o mesmo palpite — reaparecendo na
-- mesma página, pré-marcada, na rodada seguinte.
ALTER TABLE "CategorySuggestion" ADD COLUMN "guessRejected" BOOLEAN NOT NULL DEFAULT false;
