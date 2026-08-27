import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

/**
 * As três consultas que somam dinheiro no relatório precisam ignorar linha
 * compensada. Errar aqui não levanta erro nenhum: o número só fica errado, e
 * ninguém percebe. Por isso o teste olha o `where` que cada consulta monta, em
 * vez de confiar em revisão.
 */
const groupBy = vi.fn();
const count = vi.fn();
const categoryFindFirst = vi.fn();
const categoryFindMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    transaction: { groupBy, count },
    category: { findFirst: categoryFindFirst, findMany: categoryFindMany },
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

const { getReportSummary } = await import("./reports.service");

/** Um espaco de um membro so: o que muda aqui e a forma do filtro, nao a regra. */
const escopo: Scope = { userId: "user-1", householdId: "casa-1", memberIds: ["user-1"] };

beforeEach(() => {
  groupBy.mockReset().mockResolvedValue([]);
  count.mockReset().mockResolvedValue(0);
  // Sempre acha as categorias de sistema, para não entrar no caminho que cria.
  categoryFindFirst.mockReset().mockResolvedValue({ id: "cat-sistema" });
  categoryFindMany.mockReset().mockResolvedValue([]);
  queryRaw.mockReset().mockResolvedValue([]);
});

describe("relatório ignora linha compensada", () => {
  it("nas duas consultas agrupadas", async () => {
    await getReportSummary(escopo, { month: "2026-09" });

    expect(groupBy).toHaveBeenCalledTimes(2);
    for (const chamada of groupBy.mock.calls) {
      expect(chamada[0].where).toMatchObject({
        compensationId: null,
        userId: { in: ["user-1"] },
      });
    }
  });

  it("na série mensal, que é SQL cru", async () => {
    await getReportSummary(escopo, { month: "2026-09" });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    // O primeiro argumento de uma template tag é o array de pedaços do SQL.
    const pedacos = queryRaw.mock.calls[0][0] as string[];
    expect([...pedacos].join(" ")).toContain('"compensationId" IS NULL');
  });
});
