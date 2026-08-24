import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * O que vale travar aqui é a decisão, não o Postgres: quem pode compensar o
 * quê, e o que exatamente é escrito quando pode. O banco fica mockado — é o
 * mesmo critério de `reopen.test.ts`.
 */
const findFirst = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    transaction: { findFirst, findMany, updateMany },
  },
}));

const { compensar, desfazerCompensacao } = await import("./compensacao.service");

const credito = {
  id: "tx-estorno",
  userId: "user-1",
  accountId: "cartao-1",
  type: "INCOME",
  amount: { toString: () => "272" },
  compensationId: null,
};

const parcela = (i: number) => ({
  id: `p${i}`,
  accountId: "cartao-1",
  type: "EXPENSE",
  amount: { toString: () => "34" },
  installmentTotal: 8,
  compensationId: null,
});

const oitoParcelas = [1, 2, 3, 4, 5, 6, 7, 8].map(parcela);

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  updateMany.mockReset();
});

describe("compensar", () => {
  it("grava o mesmo vínculo no crédito e em todas as parcelas", async () => {
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue(oitoParcelas);
    updateMany.mockResolvedValue({ count: 9 });

    const resultado = await compensar("user-1", "tx-estorno", "chave-a");

    expect(resultado.afetadas).toBe(9);
    expect(updateMany).toHaveBeenCalledTimes(1);

    const args = updateMany.mock.calls[0][0];
    // As nove pontas de uma vez, e não nove escritas: um erro no meio deixaria
    // metade da compra compensada, que é pior que nenhuma.
    expect(args.where.id.in).toHaveLength(9);
    expect(args.where.id.in).toContain("tx-estorno");
    expect(args.where.userId).toBe("user-1");
    expect(typeof args.data.compensationId).toBe("string");
  });

  it("recusa quando a soma das parcelas não bate com o crédito", async () => {
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue(oitoParcelas.slice(0, 7));

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(/valor/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa compra à vista, mesmo com o valor certo", async () => {
    // Só parcelamento espalha a despesa por meses que o crédito não alcança.
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue([
      { ...parcela(1), amount: { toString: () => "272" }, installmentTotal: null },
    ]);

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(/parcel/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa um crédito que já está compensado", async () => {
    findFirst.mockResolvedValue({ ...credito, compensationId: "par-antigo" });

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(/compensad/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa quando a ponta escolhida é uma despesa", async () => {
    findFirst.mockResolvedValue({ ...credito, type: "EXPENSE" });

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa grupo de outra conta", async () => {
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue(oitoParcelas.map((p) => ({ ...p, accountId: "cartao-2" })));

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(/conta/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("transação de outro usuário não existe", async () => {
    // O par (id, userId) é o que prova posse. Não achou = 404, e não 403: não
    // se confirma a existência de linha alheia.
    findFirst.mockResolvedValue(null);

    await expect(compensar("user-1", "tx-de-outro", "chave-a")).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("desfazerCompensacao", () => {
  it("limpa o grupo inteiro a partir de qualquer ponta", async () => {
    findFirst.mockResolvedValue({ ...credito, compensationId: "par-1" });
    updateMany.mockResolvedValue({ count: 9 });

    const resultado = await desfazerCompensacao("user-1", "p3");

    expect(resultado.afetadas).toBe(9);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "user-1", compensationId: "par-1" });
    expect(args.data).toEqual({ compensationId: null });
  });

  it("desfazer o que não está compensado não escreve nada", async () => {
    findFirst.mockResolvedValue({ ...credito, compensationId: null });

    const resultado = await desfazerCompensacao("user-1", "tx-estorno");

    expect(resultado.afetadas).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
