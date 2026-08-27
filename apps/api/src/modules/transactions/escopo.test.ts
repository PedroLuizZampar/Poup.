import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

/**
 * A leitura somada, guardada onde ela mais importa: a lista de transações é a
 * tela em que "faltou o dinheiro do parceiro" seria invisível — nenhum erro
 * sobe, o total só fica menor. Por isso o teste olha o `where` que a consulta
 * monta, e não o que ela devolve.
 */
const txFindMany = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: { transaction: { findMany: txFindMany } },
}));

const { listTransactions } = await import("./transactions.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

beforeEach(() => {
  txFindMany.mockReset().mockResolvedValue([]);
});

describe("lista de transações em espaço conjunto", () => {
  it("sem filtro, soma os dois", async () => {
    await listTransactions(casal, {});
    expect(txFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["ana", "bento"] } }),
      })
    );
  });

  it("com owner, restringe a um", async () => {
    await listTransactions(casal, { owner: "bento" });
    expect(txFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["bento"] } }),
      })
    );
  });

  it("recusa owner de fora do espaço", async () => {
    await expect(listTransactions(casal, { owner: "estranho" })).rejects.toThrow();
  });
});
