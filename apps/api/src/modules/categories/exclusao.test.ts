import { describe, expect, it, vi, beforeEach } from "vitest";
import { SuggestionSource, SuggestionStatus } from "@prisma/client";

/**
 * A categoria é do espaço, mas `Transaction` ainda é por usuário. Por isso o
 * `updateMany` que reaponta as transações da categoria excluída **não** pode ter
 * `userId` no `where`: filtrar por quem pediu a exclusão deixaria as linhas do
 * outro membro apontando para uma categoria que morre no comando seguinte, e o
 * `ON DELETE SET NULL` da FK as esvaziaria em silêncio — a perda de dados que
 * esta feature inteira existe para evitar, e que este branch já entregou uma vez.
 *
 * O invariante era guardado só por um comentário. Aqui a asserção é sobre o
 * objeto inteiro, com `toEqual`: uma chave a mais quebra o teste.
 */

const categoryFindFirst = vi.fn();
const transacaoDoBanco = {
  category: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  transaction: { updateMany: vi.fn() },
  categorySuggestion: { updateMany: vi.fn() },
};

vi.mock("../../prisma", () => ({
  prisma: {
    category: { findFirst: categoryFindFirst },
    $transaction: (fn: (tx: typeof transacaoDoBanco) => unknown) => fn(transacaoDoBanco),
  },
}));

const { deleteCategory, SystemCategoryError, CategoryNotFoundError } = await import(
  "./categories.service"
);

beforeEach(() => {
  categoryFindFirst.mockReset().mockResolvedValue({
    id: "cat-1",
    householdId: "casa-1",
    name: "Mercado",
    systemKey: null,
  });
  // `ensureSystemCategories` roda de verdade sobre este mock: acha cada
  // categoria de sistema pela chave e devolve o id correspondente.
  transacaoDoBanco.category.findFirst
    .mockReset()
    .mockImplementation(async ({ where }: { where: { systemKey: string } }) => ({
      id: `sys-${where.systemKey}`,
    }));
  transacaoDoBanco.category.findUnique.mockReset().mockResolvedValue(null);
  transacaoDoBanco.category.create.mockReset().mockResolvedValue({ id: "sys-novo" });
  transacaoDoBanco.category.update.mockReset().mockResolvedValue({ id: "sys-adotado" });
  transacaoDoBanco.category.delete.mockReset().mockResolvedValue({});
  transacaoDoBanco.transaction.updateMany.mockReset().mockResolvedValue({ count: 0 });
  transacaoDoBanco.categorySuggestion.updateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("excluir categoria do espaço", () => {
  it("reaponta as transações de todos os membros, sem filtrar por usuário", async () => {
    await deleteCategory("casa-1", "cat-1");

    expect(transacaoDoBanco.transaction.updateMany).toHaveBeenCalledTimes(1);
    expect(transacaoDoBanco.transaction.updateMany.mock.calls[0][0]).toEqual({
      where: { categoryId: "cat-1" },
      data: { categoryId: "sys-UNCATEGORIZED" },
    });
  });

  it("zera o palpite das sugestões pendentes, também sem filtrar por usuário", async () => {
    await deleteCategory("casa-1", "cat-1");

    expect(transacaoDoBanco.categorySuggestion.updateMany.mock.calls[0][0]).toEqual({
      where: { categoryId: "cat-1", status: SuggestionStatus.PENDING },
      data: { categoryId: null, source: SuggestionSource.NONE, confidence: 0 },
    });
  });

  it("recusa excluir categoria de sistema, sem tocar em transação nenhuma", async () => {
    categoryFindFirst.mockResolvedValue({
      id: "cat-sys",
      householdId: "casa-1",
      name: "Sem categoria",
      systemKey: "UNCATEGORIZED",
    });

    await expect(deleteCategory("casa-1", "cat-sys")).rejects.toBeInstanceOf(SystemCategoryError);
    expect(transacaoDoBanco.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("recusa categoria de outro espaço", async () => {
    categoryFindFirst.mockResolvedValue(null);

    await expect(deleteCategory("casa-1", "cat-de-outra-casa")).rejects.toBeInstanceOf(
      CategoryNotFoundError
    );
    expect(categoryFindFirst).toHaveBeenCalledWith({
      where: { id: "cat-de-outra-casa", householdId: "casa-1" },
    });
  });
});
