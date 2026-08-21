-- A fila de revisão passa a ser "toda transação sem categoria", e não só a que
-- o app conseguiu adivinhar. Quem não recebeu palpite nenhum também vira uma
-- CategorySuggestion — com `source = NONE` e `categoryId` nulo.
ALTER TYPE "SuggestionSource" ADD VALUE 'NONE';

ALTER TABLE "CategorySuggestion" ALTER COLUMN "categoryId" DROP NOT NULL;

-- SET NULL no lugar de CASCADE: excluir a categoria sugerida não deve tirar a
-- transação da fila. Ela continua sem categoria, e o que muda é só que a fila
-- passa a pedir uma escolha em vez de oferecer um palpite morto.
ALTER TABLE "CategorySuggestion" DROP CONSTRAINT "CategorySuggestion_categoryId_fkey";
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
