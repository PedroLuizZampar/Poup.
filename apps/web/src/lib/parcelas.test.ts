import { describe, expect, it } from "vitest";
import { descricaoDaParcela } from "./parcelas";

describe("descricaoDaParcela", () => {
  it("a paga fala da data do pagamento, nao do vencimento", () => {
    // O erro que este teste existe para pegar: mostrar "paga em 10/06" quando
    // 10/06 e o vencimento e o dinheiro saiu no dia 15.
    expect(
      descricaoDaParcela({
        status: "PAID",
        dueDate: "2026-06-10T00:00:00.000Z",
        paidAt: "2026-06-15T00:00:00.000Z",
      })
    ).toBe("paga em 15/06/2026");
  });

  it("a vencida fala no passado", () => {
    expect(
      descricaoDaParcela({
        status: "OVERDUE",
        dueDate: "2026-07-10T00:00:00.000Z",
        paidAt: null,
      })
    ).toBe("venceu 10/07/2026");
  });

  it("a em aberto fala no futuro", () => {
    expect(
      descricaoDaParcela({
        status: "OPEN",
        dueDate: "2026-09-10T00:00:00.000Z",
        paidAt: null,
      })
    ).toBe("vence 10/09/2026");
  });

  it("a prevista fala no futuro e nao afirma nada sobre pagamento", () => {
    expect(
      descricaoDaParcela({
        status: "FORECAST",
        dueDate: "2026-12-10T00:00:00.000Z",
        paidAt: null,
      })
    ).toBe("vence 10/12/2026");
  });

  it("paga sem data de pagamento ainda se anuncia paga", () => {
    expect(descricaoDaParcela({ status: "PAID", dueDate: null, paidAt: null })).toBe("paga");
  });

  it("sem vencimento, cada estado ainda diz algo util", () => {
    expect(descricaoDaParcela({ status: "OVERDUE", dueDate: null, paidAt: null })).toBe("vencida");
    expect(descricaoDaParcela({ status: "FORECAST", dueDate: null, paidAt: null })).toBe(
      "sem vencimento"
    );
  });

  it("usa o dia UTC, e nao o local", () => {
    // Vencimento e gravado a meia-noite UTC; formatar no fuso da maquina faria
    // a parcela aparecer um dia antes em GMT-3.
    expect(
      descricaoDaParcela({ status: "OPEN", dueDate: "2026-09-10T00:00:00.000Z", paidAt: null })
    ).toBe("vence 10/09/2026");
  });
});
