import { describe, expect, it } from "vitest";
import { statusDaParcela } from "./statusDaParcela";

const agora = new Date("2026-08-24T12:00:00Z");

describe("statusDaParcela", () => {
  it("fatura quitada e parcela paga", () => {
    expect(
      statusDaParcela(
        { dueDate: new Date("2026-06-16T00:00:00Z"), paidAt: new Date("2026-06-15T00:00:00Z") },
        agora
      )
    ).toBe("PAID");
  });

  it("quitada continua paga mesmo com o vencimento no futuro", () => {
    // Pagar adiantado e comum, e a fatura quitada nao volta a ficar em aberto.
    expect(
      statusDaParcela(
        { dueDate: new Date("2026-09-16T00:00:00Z"), paidAt: new Date("2026-08-20T00:00:00Z") },
        agora
      )
    ).toBe("PAID");
  });

  it("fatura vencida e nao paga e parcela vencida", () => {
    expect(
      statusDaParcela({ dueDate: new Date("2026-07-16T00:00:00Z"), paidAt: null }, agora)
    ).toBe("OVERDUE");
  });

  it("fatura que ainda vai vencer esta em aberto", () => {
    expect(
      statusDaParcela({ dueDate: new Date("2026-09-16T00:00:00Z"), paidAt: null }, agora)
    ).toBe("OPEN");
  });

  it("sem fatura importada, nao afirma nada", () => {
    // O caso do Inter, cujo conector nao devolve fatura nenhuma: deduzir
    // "vencida" da data pintaria de vermelho um parcelamento inteiro sem que
    // nada esteja errado.
    expect(statusDaParcela(null, agora)).toBe("FORECAST");
    expect(statusDaParcela(undefined, agora)).toBe("FORECAST");
  });

  it("no instante exato do vencimento ainda esta em aberto", () => {
    // O vencimento e o ultimo dia para pagar, e nao o primeiro de atraso.
    expect(statusDaParcela({ dueDate: agora, paidAt: null }, agora)).toBe("OPEN");
  });
});
