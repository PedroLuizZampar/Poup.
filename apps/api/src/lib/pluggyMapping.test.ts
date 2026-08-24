import { describe, expect, it } from "vitest";
import {
  DIA_DE_VENCIMENTO_PADRAO,
  dadosDeParcela,
  diaDeVencimentoInicial,
  mesDaFatura,
  sinalDaTransacao,
  valorAbsoluto,
  vencimentoDaFatura,
} from "./pluggyMapping";

describe("sinalDaTransacao", () => {
  // O `type` da Pluggy e a direcao do dinheiro, e e dado — nao palpite. O
  // sinal do valor so entra quando o conector nao mandou `type`.
  it("DEBIT e despesa, com valor positivo", () => {
    expect(sinalDaTransacao("DEBIT", 120.5)).toBe("EXPENSE");
  });

  it("DEBIT e despesa mesmo com valor negativo", () => {
    expect(sinalDaTransacao("DEBIT", -120.5)).toBe("EXPENSE");
  });

  it("CREDIT e receita, com valor positivo", () => {
    expect(sinalDaTransacao("CREDIT", 300)).toBe("INCOME");
  });

  // ESTE e o bug que abriu o trabalho: num cartao, estorno vem CREDIT com
  // valor negativo, e a regra antiga (`|| raw < 0`) o transformava em despesa.
  it("CREDIT com valor negativo e receita — o estorno de cartao", () => {
    expect(sinalDaTransacao("CREDIT", -89.9)).toBe("INCOME");
  });

  it("sem type, o sinal do valor decide", () => {
    expect(sinalDaTransacao(undefined, -10)).toBe("EXPENSE");
    expect(sinalDaTransacao(undefined, 10)).toBe("INCOME");
    expect(sinalDaTransacao(null, -10)).toBe("EXPENSE");
  });

  it("type desconhecido cai no sinal do valor", () => {
    expect(sinalDaTransacao("QUALQUERCOISA", -10)).toBe("EXPENSE");
    expect(sinalDaTransacao("QUALQUERCOISA", 10)).toBe("INCOME");
  });

  it("aceita type em caixa baixa", () => {
    expect(sinalDaTransacao("credit", -50)).toBe("INCOME");
  });

  it("zero sem type e receita, nao despesa", () => {
    // Arbitrario, mas precisa ser estavel: `0 < 0` e falso.
    expect(sinalDaTransacao(undefined, 0)).toBe("INCOME");
  });
});

describe("valorAbsoluto", () => {
  it("devolve sempre o modulo", () => {
    expect(valorAbsoluto(-89.9)).toBe(89.9);
    expect(valorAbsoluto(89.9)).toBe(89.9);
  });

  it("trata ausencia como zero", () => {
    expect(valorAbsoluto(null)).toBe(0);
    expect(valorAbsoluto(undefined)).toBe(0);
  });

  it("trata valor nao-finito como zero", () => {
    // Um NaN viraria `Decimal` invalido e derrubaria o lote inteiro do sync.
    expect(valorAbsoluto(NaN)).toBe(0);
    expect(valorAbsoluto(Infinity)).toBe(0);
    expect(valorAbsoluto(-Infinity)).toBe(0);
  });
});

describe("mesDaFatura", () => {
  it("usa o billForecastDate quando a Pluggy manda", () => {
    // E o mes que o proprio banco projetou. Vence qualquer derivacao nossa.
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09")).toBe("2026-09");
  });

  it("ignora billForecastDate malformado e deriva", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "setembro")).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-9")).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "")).toBe("2026-09");
  });

  it("sem billForecastDate, deriva do mes da transacao mais um", () => {
    expect(mesDaFatura(new Date("2026-08-22T14:00:00Z"))).toBe("2026-09");
  });

  it("vira o ano em dezembro", () => {
    expect(mesDaFatura(new Date("2026-12-15T00:00:00Z"))).toBe("2027-01");
  });

  it("mantem o mes em dois digitos", () => {
    expect(mesDaFatura(new Date("2026-01-05T00:00:00Z"))).toBe("2026-02");
  });
});

describe("dadosDeParcela", () => {
  it("le numero e total do creditCardMetadata", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
      } as any)
    ).toEqual({ installmentIndex: 3, installmentTotal: 10, billMonth: "2026-09" });
  });

  it("prefere o billForecastDate para o mes da fatura", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          billForecastDate: "2026-11",
        },
      } as any)
    ).toEqual({ installmentIndex: 3, installmentTotal: 10, billMonth: "2026-11" });
  });

  it("sem creditCardMetadata, os tres campos ficam nulos", () => {
    // O caso da conta corrente: nao ha fatura, entao nao ha vencimento.
    expect(
      dadosDeParcela({ date: new Date("2026-08-10T00:00:00Z"), creditCardMetadata: null } as any)
    ).toEqual({ installmentIndex: null, installmentTotal: null, billMonth: null });
  });

  it("compra a vista no cartao tem fatura, mas nao tem parcela", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { payeeMCC: 5812 },
      } as any)
    ).toEqual({ installmentIndex: null, installmentTotal: null, billMonth: "2026-09" });
  });

  it("meia parcela nao e parcela", () => {
    // Um sem o outro nao diz nada exibivel: "3 de ?" e "? de 10" sao ruido.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3 },
      } as any).installmentIndex
    ).toBeNull();

    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { totalInstallments: 10 },
      } as any).installmentTotal
    ).toBeNull();
  });

  it("descarta parcela com numero fora de faixa", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 0, totalInstallments: 10 },
      } as any).installmentIndex
    ).toBeNull();

    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 11, totalInstallments: 10 },
      } as any).installmentIndex
    ).toBeNull();
  });
});

describe("vencimentoDaFatura", () => {
  it("combina o mes da fatura com o dia da conta", () => {
    expect(vencimentoDaFatura("2026-09", 10)?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("limita ao ultimo dia do mes", () => {
    // Vencimento 31 em fevereiro nao pode virar 3 de marco em silencio, que e
    // o que `Date.UTC(2026, 1, 31)` faz sozinho.
    expect(vencimentoDaFatura("2026-02", 31)?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("respeita ano bissexto", () => {
    expect(vencimentoDaFatura("2028-02", 31)?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("sem dia de vencimento, nao ha data", () => {
    expect(vencimentoDaFatura("2026-09", null)).toBeNull();
  });

  it("sem mes de fatura, nao ha data", () => {
    expect(vencimentoDaFatura(null, 10)).toBeNull();
  });

  it("recusa mes malformado em vez de inventar data", () => {
    expect(vencimentoDaFatura("2026-13", 10)).toBeNull();
    expect(vencimentoDaFatura("setembro", 10)).toBeNull();
  });

  it("recusa dia fora de 1..31", () => {
    expect(vencimentoDaFatura("2026-09", 0)).toBeNull();
    expect(vencimentoDaFatura("2026-09", 32)).toBeNull();
  });
});

describe("diaDeVencimentoInicial", () => {
  it("usa o dia do balanceDueDate da Pluggy", () => {
    expect(
      diaDeVencimentoInicial({
        creditData: { balanceDueDate: new Date("2026-08-15T00:00:00Z") },
      } as any)
    ).toBe(15);
  });

  it("aceita balanceDueDate como string", () => {
    // O SDK tipa como Date, mas o que chega do JSON e string ate o transform.
    expect(diaDeVencimentoInicial({ creditData: { balanceDueDate: "2026-08-05" } } as any)).toBe(5);
  });

  it("cai no padrao quando a Pluggy nao manda", () => {
    expect(diaDeVencimentoInicial({ creditData: null } as any)).toBe(DIA_DE_VENCIMENTO_PADRAO);
    expect(diaDeVencimentoInicial({ creditData: { balanceDueDate: null } } as any)).toBe(10);
    expect(diaDeVencimentoInicial({} as any)).toBe(10);
  });

  it("cai no padrao quando a data e invalida", () => {
    expect(diaDeVencimentoInicial({ creditData: { balanceDueDate: "amanha" } } as any)).toBe(10);
  });
});
