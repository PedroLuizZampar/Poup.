import { describe, expect, it } from "vitest";
import {
  DIA_DE_VENCIMENTO_PADRAO,
  competenciaDaTransacao,
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

  // O caso que motivou este plano: o Mercado Pago manda as dez parcelas de uma
  // vez, todas com a mesma data e o mesmo billForecastDate. Sem o deslocamento
  // as dez cairiam na mesma fatura.
  it("a parcela 1 nao desloca", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 1)).toBe("2026-09");
  });

  it("a parcela 3 anda dois meses", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 3)).toBe("2026-11");
  });

  it("a ultima parcela de um 10x vira o ano", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 10)).toBe("2027-06");
  });

  it("desloca tambem quando o mes foi derivado, e nao recebido", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), null, 3)).toBe("2026-11");
  });

  it("parcela ausente ou invalida nao desloca", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", null)).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 0)).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 1.5)).toBe("2026-09");
  });
});

describe("dadosDeParcela", () => {
  it("le numero e total do creditCardMetadata", () => {
    // O mes derivado da compra e 2026-09, e a parcela 3 anda dois meses a
    // partir dele: e a fatura desta parcela, nao a da compra.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
      } as any)
    ).toEqual({
      installmentIndex: 3,
      installmentTotal: 10,
      billMonth: "2026-11",
      pluggyBillId: null,
    });
  });

  it("prefere o billForecastDate para o mes da fatura", () => {
    // O billForecastDate e a fatura da **primeira** parcela; a terceira anda
    // dois meses sobre ele.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          billForecastDate: "2026-11",
        },
      } as any)
    ).toEqual({
      installmentIndex: 3,
      installmentTotal: 10,
      billMonth: "2027-01",
      pluggyBillId: null,
    });
  });

  it("sem creditCardMetadata, os tres campos ficam nulos", () => {
    // O caso da conta corrente: nao ha fatura, entao nao ha vencimento.
    expect(
      dadosDeParcela({ date: new Date("2026-08-10T00:00:00Z"), creditCardMetadata: null } as any)
    ).toEqual({
      installmentIndex: null,
      installmentTotal: null,
      billMonth: null,
      pluggyBillId: null,
    });
  });

  it("compra a vista no cartao tem fatura, mas nao tem parcela", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { payeeMCC: 5812 },
      } as any)
    ).toEqual({
      installmentIndex: null,
      installmentTotal: null,
      billMonth: "2026-09",
      pluggyBillId: null,
    });
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

  it("le o billId quando a fatura ja fechou", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          billId: "bill-abc",
        },
      } as any).pluggyBillId
    ).toBe("bill-abc");
  });

  it("fatura ainda aberta vem sem billId", () => {
    // Enquanto a fatura nao fecha, a transacao e PENDING e nao tem vinculo. O
    // evento `transactions/updated` e quem avisa que passou a ter.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
      } as any).pluggyBillId
    ).toBeNull();
  });

  it("sem creditCardMetadata nao ha fatura", () => {
    expect(
      dadosDeParcela({ date: new Date("2026-08-10T00:00:00Z"), creditCardMetadata: null } as any)
        .pluggyBillId
    ).toBeNull();
  });
});

describe("vencimentoDaFatura", () => {
  it("combina o mes da fatura com o dia da conta", () => {
    // 10/09/2026 e uma quinta-feira: nao anda.
    expect(vencimentoDaFatura("2026-09", 10)?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("limita ao ultimo dia do mes", () => {
    // Vencimento 31 em fevereiro nao pode virar 3 de marco em silencio, que e
    // o que `Date.UTC(2026, 1, 31)` faz sozinho. 28/02/2026 e sabado, entao
    // depois do limite ainda anda para segunda.
    expect(vencimentoDaFatura("2026-02", 31)?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("respeita ano bissexto antes de decidir o dia util", () => {
    // 29/02/2036 e uma sexta-feira comum: o limite manda, e o dia util nao
    // desloca nada. 2028 nao serve de exemplo porque naquele ano o 29 cai na
    // terca de Carnaval.
    expect(vencimentoDaFatura("2036-02", 31)?.toISOString()).toBe("2036-02-29T00:00:00.000Z");
  });

  it("posterga vencimento que cai em fim de semana", () => {
    // 12/09/2026 e sabado.
    expect(vencimentoDaFatura("2026-09", 12)?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("posterga vencimento que cai em feriado", () => {
    // 07/09/2026 e segunda-feira e feriado nacional.
    expect(vencimentoDaFatura("2026-09", 7)?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
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

describe("competenciaDaTransacao", () => {
  it("sem fatura, a competencia e a propria data", () => {
    const data = new Date("2026-08-22T14:30:00Z");
    expect(competenciaDaTransacao(data, null).toISOString()).toBe("2026-08-22T14:30:00.000Z");
  });

  it("com fatura, e o primeiro dia do mes dela", () => {
    // O dia nao importa e nao pode importar: a competencia e mensal, e fixar o
    // dia 1 e o que a mantem independente de `creditCardDueDay`.
    expect(
      competenciaDaTransacao(new Date("2026-08-22T14:30:00Z"), "2026-11").toISOString()
    ).toBe("2026-11-01T00:00:00.000Z");
  });

  it("mes malformado nao inventa competencia", () => {
    const data = new Date("2026-08-22T14:30:00Z");
    expect(competenciaDaTransacao(data, "setembro").toISOString()).toBe(
      "2026-08-22T14:30:00.000Z"
    );
  });
});
