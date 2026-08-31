import { describe, expect, it } from "vitest";
import type { TransactionDTO } from "@poup/shared";
import { agruparCompras } from "./agruparCompras";

function tx(over: Partial<TransactionDTO> & { id: string }): TransactionDTO {
  return {
    description: "MERCADOLIVRE",
    amount: 34,
    type: "EXPENSE",
    date: "2026-08-17T15:37:11.000Z",
    note: null,
    isRecurring: false,
    accountId: "conta-1",
    accountName: "Cartão",
    categoryId: null,
    categoryName: null,
    installmentIndex: null,
    installmentTotal: null,
    dueDate: null,
    competenceDate: "2026-08-17T15:37:11.000Z",
    purchaseKey: null,
    compensationId: null,
    ownerUserId: "user-1",
    ...over,
  };
}

/** As N parcelas de uma compra, fora de ordem de proposito. */
function parcelas(total: number, chave = "compra-a"): TransactionDTO[] {
  return Array.from({ length: total }, (_, i) => total - i).map((n) =>
    tx({ id: `p${n}`, installmentIndex: n, installmentTotal: total, purchaseKey: chave })
  );
}

describe("agruparCompras", () => {
  it("transacao comum vira uma linha, sem grupo", () => {
    const [linha] = agruparCompras([tx({ id: "a", amount: 20 })]);
    expect(linha.parcelas).toBeNull();
    expect(linha.valor).toBe(20);
    expect(linha.tx.id).toBe("a");
  });

  it("as N parcelas de uma compra viram uma linha so", () => {
    const linhas = agruparCompras(parcelas(8));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].parcelas).toHaveLength(8);
  });

  it("a linha mostra o valor da compra inteira", () => {
    expect(agruparCompras(parcelas(8))[0].valor).toBe(272);
  });

  it("a parcela 1 representa a linha", () => {
    // A lista chega ordenada por data, e as parcelas dividem a mesma data: a
    // ordem entre elas e arbitraria. Representar pela 1a e o que faz a linha
    // ler igual toda vez.
    expect(agruparCompras(parcelas(8))[0].tx.installmentIndex).toBe(1);
  });

  it("as parcelas do grupo saem ordenadas pelo numero", () => {
    const nums = agruparCompras(parcelas(8))[0].parcelas!.map((p) => p.installmentIndex);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("o grupo ocupa a posicao da primeira parcela encontrada", () => {
    // Colapsar nao pode reordenar a lista: a compra fica onde a lista ja a
    // mostrava, e nao no topo nem no fim.
    const linhas = agruparCompras([
      tx({ id: "antes" }),
      ...parcelas(3),
      tx({ id: "depois" }),
    ]);
    expect(linhas.map((l) => l.tx.id)).toEqual(["antes", "p1", "depois"]);
  });

  it("uma parcela sozinha na lista nao vira grupo", () => {
    // E o caso do painel e da tela de categorias, que filtram por mes: la so
    // uma parcela cai no mes, e ela tem de continuar sendo ela mesma — valor da
    // parcela, e nao da compra.
    const [linha] = agruparCompras([
      tx({ id: "p3", installmentIndex: 3, installmentTotal: 8, purchaseKey: "compra-a" }),
    ]);
    expect(linha.parcelas).toBeNull();
    expect(linha.valor).toBe(34);
  });

  it("compra a vista nao agrupa, mesmo com varias no mesmo lojista", () => {
    // `purchaseKey` nulo e a ausencia de compra a agrupar, e nao uma chave que
    // todas compartilham.
    const linhas = agruparCompras([tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c" })]);
    expect(linhas).toHaveLength(3);
  });

  it("compras diferentes nao se misturam", () => {
    const linhas = agruparCompras([...parcelas(3, "compra-a"), ...parcelas(2, "compra-b")]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.parcelas!.length)).toEqual([3, 2]);
  });

  it("soma em centavos sem sobra de ponto flutuante", () => {
    // 0.1 + 0.2 nao da 0.3 em binario; um total de R$ 99,99000000000001 seria
    // impresso como R$ 99,99 mas quebraria qualquer comparacao.
    const tres = [1, 2, 3].map((n) =>
      tx({ id: `q${n}`, amount: 33.33, installmentIndex: n, installmentTotal: 3, purchaseKey: "c" })
    );
    expect(agruparCompras(tres)[0].valor).toBe(99.99);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(agruparCompras([])).toEqual([]);
  });
});
