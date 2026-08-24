import { describe, expect, it } from "vitest";
import { candidatasDeCompensacao } from "./compensacao";

const credito = {
  id: "tx-estorno",
  accountId: "cartao-1",
  amountCents: 27200,
  compensationId: null,
};

const grupo = {
  purchaseKey: "chave-a",
  accountId: "cartao-1",
  description: "MERCADOLIVRE*MERCADOLIVRE",
  purchaseDate: "2026-08-17T15:37:11.000Z",
  installmentTotal: 8,
  parcelasConhecidas: 8,
  totalCents: 27200,
  jaCompensado: false,
};

describe("candidatasDeCompensacao", () => {
  it("o grupo que bate no valor é elegível e já vem selecionado", () => {
    expect(candidatasDeCompensacao(credito, [grupo])).toEqual([
      {
        purchaseKey: "chave-a",
        description: "MERCADOLIVRE*MERCADOLIVRE",
        purchaseDate: "2026-08-17T15:37:11.000Z",
        installmentTotal: 8,
        parcelasConhecidas: 8,
        totalCents: 27200,
        elegivel: true,
        motivo: null,
        preSelecionada: true,
      },
    ]);
  });

  it("um centavo de diferença não é elegível", () => {
    // Compensar por aproximação tiraria do relatório uma despesa que só parece
    // com o estorno. O erro é silencioso, então a regra é exata.
    const porUmCentavo = { ...grupo, totalCents: 27199 };
    const [c] = candidatasDeCompensacao(credito, [porUmCentavo]);
    expect(c.elegivel).toBe(false);
    expect(c.motivo).toBe("valor-diferente");
    expect(c.preSelecionada).toBe(false);
  });

  it("grupo já compensado aparece, mas não é escolhível", () => {
    const usado = { ...grupo, jaCompensado: true };
    const [c] = candidatasDeCompensacao(credito, [usado]);
    expect(c.elegivel).toBe(false);
    expect(c.motivo).toBe("ja-compensado");
  });

  it("grupo de outra conta nem aparece na lista", () => {
    // Estorno cai no cartão em que a compra foi feita. Listar compras de outra
    // conta só oferece jeitos de errar.
    const deOutroCartao = { ...grupo, accountId: "cartao-2" };
    expect(candidatasDeCompensacao(credito, [deOutroCartao])).toEqual([]);
  });

  it("dois grupos de mesmo valor não pré-selecionam nenhum", () => {
    // Empate significa que a informação disponível não decide — mesma regra do
    // pareamento de transferência. Escolher uma seria adivinhar.
    const gemeo = { ...grupo, purchaseKey: "chave-b" };
    const candidatas = candidatasDeCompensacao(credito, [grupo, gemeo]);
    expect(candidatas).toHaveLength(2);
    expect(candidatas.every((c) => c.elegivel)).toBe(true);
    expect(candidatas.some((c) => c.preSelecionada)).toBe(false);
  });

  it("crédito já compensado não tem candidata nenhuma", () => {
    const usado = { ...credito, compensationId: "par-1" };
    expect(candidatasDeCompensacao(usado, [grupo])).toEqual([]);
  });

  it("ordena por data da compra, da mais recente para a mais antiga", () => {
    // O estorno costuma ser de uma compra recente.
    const antiga = {
      ...grupo,
      purchaseKey: "chave-b",
      purchaseDate: "2026-06-02T00:00:00.000Z",
    };
    const ordem = candidatasDeCompensacao(credito, [antiga, grupo]).map((c) => c.purchaseKey);
    expect(ordem).toEqual(["chave-a", "chave-b"]);
  });
});
