import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * As duas consultas de orçamento. `listBudgets` é a que alimenta a tela e não
 * usa função de agregação — soma em JavaScript depois de um `findMany` —, e foi
 * por isso que ela quase escapou da revisão deste plano.
 */
const findMany = vi.fn();
const aggregate = vi.fn();
const budgetFindMany = vi.fn();
const budgetUpsert = vi.fn();
const categoryFindFirst = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    transaction: { findMany, aggregate },
    budget: { findMany: budgetFindMany, upsert: budgetUpsert },
    category: { findFirst: categoryFindFirst },
  },
}));

const { listBudgets, upsertBudget } = await import("./budgets.service");

const categoria = { id: "cat-1", name: "Outros", icon: "tag", colorKey: "blue" };

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
  aggregate.mockReset().mockResolvedValue({ _sum: { amount: 0 } });
  budgetFindMany.mockReset().mockResolvedValue([]);
  budgetUpsert.mockReset().mockResolvedValue({
    id: "orc-1",
    categoryId: "cat-1",
    monthlyLimit: 500,
    category: categoria,
  });
  categoryFindFirst.mockReset().mockResolvedValue({ ...categoria, systemKey: null });
});

describe("orçamento ignora linha compensada", () => {
  it("ao listar os orçamentos da tela", async () => {
    await listBudgets("user-1", "2026-09");

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ compensationId: null });
  });

  it("ao salvar um orçamento", async () => {
    await upsertBudget("user-1", "cat-1", 500);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate.mock.calls[0][0].where).toMatchObject({ compensationId: null });
  });
});
