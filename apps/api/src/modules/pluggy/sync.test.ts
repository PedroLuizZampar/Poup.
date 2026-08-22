import { describe, expect, it } from "vitest";
import { emLotes } from "../../lib/lotes";
import { janelaDeRevisita } from "./pluggy.service";

/**
 * As duas peças puras do sync incremental. O resto do `syncItem` fala com a
 * Pluggy e com o banco, mas estas duas decidem sozinhas *quanto* se pede e
 * *quantas* idas ao banco acontecem — que é exatamente o que estourava o teto
 * de tempo antes.
 */

describe("emLotes", () => {
  it("não fatia o que já cabe num lote", () => {
    expect(emLotes([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
  });

  it("fatia no tamanho pedido e deixa o resto no último", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("não devolve lote vazio para lista vazia", () => {
    // Um `[[]]` aqui viraria um `createMany` com zero linhas — ida ao banco
    // para não fazer nada.
    expect(emLotes([], 500)).toEqual([]);
  });

  it("mantém todos os itens, sem perder nem duplicar", () => {
    const items = Array.from({ length: 1234 }, (_, i) => i);
    const lotes = emLotes(items, 500);
    expect(lotes).toHaveLength(3);
    expect(lotes.flat()).toEqual(items);
  });
});

describe("janelaDeRevisita", () => {
  it("sem transação nenhuma, pede o histórico inteiro", () => {
    // Primeiro sync: filtrar por data aqui deixaria o extrato antigo de fora
    // para sempre, porque a próxima janela parte do que foi importado.
    expect(janelaDeRevisita(null)).toBeUndefined();
    expect(janelaDeRevisita(undefined)).toBeUndefined();
  });

  it("volta 30 dias antes da transação mais recente", () => {
    expect(janelaDeRevisita(new Date("2026-08-22T00:00:00Z"))).toBe("2026-07-23");
  });

  it("atravessa a virada de ano sem tropeçar", () => {
    expect(janelaDeRevisita(new Date("2026-01-10T00:00:00Z"))).toBe("2025-12-11");
  });

  it("usa a data UTC, e não a local", () => {
    // A data é gravada em UTC; formatar no fuso da máquina faria a janela
    // andar um dia dependendo de onde o servidor roda.
    expect(janelaDeRevisita(new Date("2026-08-22T23:30:00Z"))).toBe("2026-07-23");
  });

  it("devolve o formato que a Pluggy aceita", () => {
    expect(janelaDeRevisita(new Date("2026-03-05T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
