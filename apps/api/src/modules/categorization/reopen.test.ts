import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * O único ponto do fluxo que vale travar num teste é o formato da linha que
 * volta para a fila: é dela que dependem o contador, a notificação e a página
 * em que a transação reaparece. O banco fica de fora — o que se verifica aqui é
 * a decisão, não o Postgres.
 */
const upsert = vi.fn();
vi.mock("../../prisma", () => ({ prisma: { categorySuggestion: { upsert } } }));

const { reopenPendingSuggestion } = await import("./categorization.service");

beforeEach(() => upsert.mockReset());

describe("reopenPendingSuggestion", () => {
  it("devolve a transação para a fila sem palpite e sem resolução", async () => {
    await reopenPendingSuggestion("user-1", "tx-1");

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
    expect(args.create.userId).toBe("user-1");
    expect(args.update.userId).toBeUndefined();
  });
});
