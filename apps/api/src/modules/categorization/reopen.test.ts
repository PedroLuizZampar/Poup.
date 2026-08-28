import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

/**
 * O único ponto do fluxo que vale travar num teste é o formato da linha que
 * volta para a fila: é dela que dependem o contador, a notificação e a página
 * em que a transação reaparece. O banco fica de fora — o que se verifica aqui é
 * a decisão, não o Postgres.
 */
const upsert = vi.fn();
const transactionFindFirst = vi.fn();
vi.mock("../../prisma", () => ({
  prisma: {
    categorySuggestion: { upsert },
    transaction: { findFirst: transactionFindFirst },
  },
}));

const { reopenPendingSuggestion } = await import("./categorization.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

beforeEach(() => {
  upsert.mockReset();
  transactionFindFirst.mockReset().mockResolvedValue({ userId: "ana" });
});

describe("reopenPendingSuggestion", () => {
  it("devolve a transação para a fila sem palpite e sem resolução", async () => {
    await reopenPendingSuggestion(casal, "tx-1");

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];

    expect(args.where).toEqual({ transactionId: "tx-1" });

    // PENDING é o que a fila lê; NONE sem categoria é o que a manda para a
    // página de escolha manual, em vez de oferecer um palpite que o usuário
    // acabou de recusar à mão.
    for (const payload of [args.create, args.update]) {
      expect(payload).toMatchObject({
        status: "PENDING",
        source: "NONE",
        categoryId: null,
        confidence: 0,
        guessRejected: true,
        resolvedCategoryId: null,
        resolvedAt: null,
      });
    }

    // O `create` precisa do dono; o `update` não pode reescrevê-lo.
    expect(args.create.userId).toBe("ana");
    expect(args.update.userId).toBeUndefined();
  });

  it("aceita a transação de qualquer membro do espaço", async () => {
    await reopenPendingSuggestion(casal, "tx-do-bento");

    expect(transactionFindFirst).toHaveBeenCalledWith({
      where: { id: "tx-do-bento", userId: { in: ["ana", "bento"] } },
      select: { userId: true },
    });
  });

  it("a pendência é do dono da transação, e não de quem editou", async () => {
    // Tirar a categoria de uma linha do parceiro cria uma pendência **dele**:
    // gravar o id de quem editou faria a dissolução do espaço levar embora a
    // sugestão de uma transação que fica com o outro.
    transactionFindFirst.mockResolvedValue({ userId: "bento" });

    await reopenPendingSuggestion(casal, "tx-do-bento");

    expect(upsert.mock.calls[0][0].create.userId).toBe("bento");
  });

  it("estoura em vez de gravar pendência para transação de fora do espaço", async () => {
    transactionFindFirst.mockResolvedValue(null);

    await expect(reopenPendingSuggestion(casal, "tx-alheia")).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
