import { describe, expect, it } from "vitest";
import { emLotes } from "../../lib/lotes";
import { camposDaTransacao, dataInicialDaBusca } from "./pluggy.service";

/**
 * As duas peças puras do sync. O resto do `syncItem` fala com a Pluggy e com o
 * banco, mas estas duas decidem sozinhas *quanto* se pede e *quantas* idas ao
 * banco acontecem — que é exatamente o que estourava o teto de tempo antes.
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

describe("dataInicialDaBusca", () => {
  describe("conta nova (primeiro sync)", () => {
    it("pede só a partir do primeiro dia do mês corrente", () => {
      // É o teto do primeiro sync: sem ele o pedido é "o extrato inteiro", que
      // não tem tamanho conhecido e é o que estoura o limite de tempo.
      expect(dataInicialDaBusca(null, new Date("2026-08-22T14:00:00Z"))).toBe("2026-08-01");
    });

    it("no primeiro dia do mês, pede a partir do próprio dia", () => {
      expect(dataInicialDaBusca(null, new Date("2026-08-01T00:05:00Z"))).toBe("2026-08-01");
    });

    it("no último instante do mês, ainda é o mês corrente", () => {
      // Um off-by-one aqui faria a conexão criada em 31/08 nascer com o mês de
      // setembro inteiro vazio.
      expect(dataInicialDaBusca(null, new Date("2026-08-31T23:59:59Z"))).toBe("2026-08-01");
    });

    it("trata `undefined` como conta nova", () => {
      expect(dataInicialDaBusca(undefined, new Date("2026-03-10T00:00:00Z"))).toBe("2026-03-01");
    });

    it("em janeiro, não escorrega para dezembro", () => {
      expect(dataInicialDaBusca(null, new Date("2026-01-15T00:00:00Z"))).toBe("2026-01-01");
    });
  });

  describe("conta que já sincronizou", () => {
    it("volta 30 dias antes da transação mais recente", () => {
      expect(dataInicialDaBusca(new Date("2026-08-22T00:00:00Z"))).toBe("2026-07-23");
    });

    it("atravessa a virada de ano sem tropeçar", () => {
      expect(dataInicialDaBusca(new Date("2026-01-10T00:00:00Z"))).toBe("2025-12-11");
    });

    it("ignora o mês corrente — quem manda é a transação mais recente", () => {
      // A regra do mês corrente vale só para conta nova. Aplicá-la aqui
      // perderia tudo que a Pluggy corrigiu no mês anterior.
      expect(
        dataInicialDaBusca(new Date("2026-08-22T00:00:00Z"), new Date("2026-08-22T00:00:00Z"))
      ).toBe("2026-07-23");
    });

    it("usa a data UTC, e não a local", () => {
      // A data é gravada em UTC; formatar no fuso da máquina faria a janela
      // andar um dia dependendo de onde o servidor roda.
      expect(dataInicialDaBusca(new Date("2026-08-22T23:30:00Z"))).toBe("2026-07-23");
    });
  });

  it("devolve sempre o formato que a Pluggy aceita", () => {
    expect(dataInicialDaBusca(new Date("2026-03-05T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataInicialDaBusca(null, new Date("2026-03-05T12:00:00Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });
});

describe("camposDaTransacao", () => {
  /**
   * O sync escreve `data: campos` — tudo o que estiver aqui ele sobrescreve a
   * cada sincronização. `compensationId` é uma decisão da pessoa, não um dado
   * da Pluggy, e por isso precisa ficar de fora. Este teste existe para falhar
   * no dia em que alguém adicionar o campo por engano.
   */
  it("não inclui o vínculo de compensação", () => {
    const campos = camposDaTransacao(
      {
        id: "ptx-1",
        description: "MERCADOLIVRE*MERCADOLIVRE",
        amount: 34,
        type: "DEBIT",
        date: new Date("2026-08-17T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 1,
          totalInstallments: 8,
          billForecastDate: "2026-09",
        },
      } as never,
      "conta-1"
    );

    expect(Object.keys(campos)).not.toContain("compensationId");
  });
});
