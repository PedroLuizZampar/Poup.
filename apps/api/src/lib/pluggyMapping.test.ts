import { describe, expect, it } from "vitest";
import {
  DIA_DE_VENCIMENTO_PADRAO,
  ancorasDeCompra,
  competenciaDaTransacao,
  dadosDeParcela,
  deslocarMes,
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

  it("parcela ja vinculada a uma fatura nao desloca", () => {
    // Postada, o `billForecastDate` deixa de ser a fatura da primeira parcela
    // e passa a ser a **desta**. Somar o indice em cima disso empurra a parcela
    // para frente, e de novo a cada fechamento.
    expect(mesDaFatura(new Date("2026-08-11T00:00:00Z"), "2026-08", 3, true)).toBe("2026-08");
  });

  it("pendente continua deslocando pelo indice", () => {
    // As parcelas de uma compra nova chegam todas juntas e todas com o mesmo
    // forecast: e a fatura da primeira, e o deslocamento e o que as separa.
    expect(mesDaFatura(new Date("2026-08-17T00:00:00Z"), "2026-09", 3, false)).toBe("2026-11");
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

  it("parcela ja postada fica no mes da propria fatura", () => {
    // Caso real: compra de 02/06/2026 em 8x, parcela 3 vinculada pela Pluggy a
    // fatura de agosto. O app gravava 2026-10 — dois meses a frente de uma
    // fatura que o usuario ja tinha pago.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-11T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 8,
          billForecastDate: "2026-08",
          billId: "901172d7-2dcc-4f3f-be71-1c55ead5b6c2",
        },
      } as any)
    ).toEqual({
      installmentIndex: 3,
      installmentTotal: 8,
      billMonth: "2026-08",
      pluggyBillId: "901172d7-2dcc-4f3f-be71-1c55ead5b6c2",
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

describe("deslocarMes", () => {
  it("anda para a frente e atravessa o ano", () => {
    expect(deslocarMes("2026-11", 3)).toBe("2027-02");
  });

  it("anda para tras e atravessa o ano", () => {
    expect(deslocarMes("2026-02", -3)).toBe("2025-11");
  });

  it("nao anda quando o delta e zero", () => {
    expect(deslocarMes("2026-06", 0)).toBe("2026-06");
  });

  it("recusa o que nao e chave de mes", () => {
    expect(deslocarMes("2026-13", 1)).toBeNull();
    expect(deslocarMes("junho", 1)).toBeNull();
  });
});

describe("ancorasDeCompra", () => {
  const postada = (indice: number, mes: string) => ({
    purchaseKey: "compra-1",
    installmentIndex: indice,
    billMonth: mes,
    postada: true,
  });

  it("deduz o mes da parcela 1 a partir de uma parcela postada", () => {
    // O caso real: a parcela 3 caiu na fatura de agosto, entao a compra ancora
    // em junho — e as parcelas 4 a 8 se deduzem dai.
    expect(ancorasDeCompra([postada(3, "2026-08")]).get("compra-1")).toBe("2026-06");
  });

  it("parcelas postadas coerentes concordam na ancora", () => {
    const ancoras = ancorasDeCompra([
      postada(1, "2026-06"),
      postada(2, "2026-07"),
      postada(3, "2026-08"),
    ]);
    expect(ancoras.get("compra-1")).toBe("2026-06");
  });

  it("ignora a parcela que ainda e previsao", () => {
    // Enquanto e previsao o mes que vem junto e palpite do conector, e o
    // palpite muda de significado entre conectores. So a postada e prova.
    const ancoras = ancorasDeCompra([
      { purchaseKey: "compra-1", installmentIndex: 4, billMonth: "2026-09", postada: false },
    ]);
    expect(ancoras.has("compra-1")).toBe(false);
  });

  it("entre postadas que discordam, vence a de menor indice", () => {
    const ancoras = ancorasDeCompra([postada(3, "2026-08"), postada(1, "2026-07")]);
    expect(ancoras.get("compra-1")).toBe("2026-07");
  });

  it("compra sem parcela postada nao entra no mapa", () => {
    expect(ancorasDeCompra([]).size).toBe(0);
  });

  it("ignora parcela sem compra ou sem indice", () => {
    const ancoras = ancorasDeCompra([
      { purchaseKey: null, installmentIndex: 2, billMonth: "2026-08", postada: true },
      { purchaseKey: "compra-2", installmentIndex: null, billMonth: "2026-08", postada: true },
    ]);
    expect(ancoras.size).toBe(0);
  });
});

describe("mesDaFatura quando o conector ja data cada parcela (Nubank)", () => {
  // O Mercado Pago manda as N parcelas com a data da compra: a linha nao sabe
  // sozinha em que mes ela cai, e por isso o indice desloca. O Nubank manda
  // cada parcela com a data do mes dela e a compra em `purchaseDate` — a linha
  // ja esta posicionada, e deslocar de novo a joga meses para frente. O caso
  // real: a parcela 11/12 de uma compra de junho/2026, datada 13/04/2027, ia
  // parar em marco de **2028**.
  const compra = new Date("2026-06-13T00:00:00Z");

  it("nao desloca a parcela que ja veio datada no mes dela", () => {
    expect(
      mesDaFatura(new Date("2027-04-13T00:00:00Z"), "2027-05", 11, false, null, compra)
    ).toBe("2027-05");
  });

  it("a ultima parcela de uma 12x fica no mes dela, e nao um ano adiante", () => {
    expect(
      mesDaFatura(new Date("2027-05-13T00:00:00Z"), "2027-06", 12, false, null, compra)
    ).toBe("2027-06");
  });

  it("a parcela 1 continua igual — nao ha o que deslocar", () => {
    expect(
      mesDaFatura(compra, "2026-07", 1, false, null, compra)
    ).toBe("2026-07");
  });

  it("sem `purchaseDate`, o comportamento antigo fica de pe", () => {
    // Conector que nao manda a data da compra nao da como distinguir os dois
    // mundos. Na duvida, o deslocamento continua: e o que o Mercado Pago exige.
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 3, false)).toBe("2026-11");
  });

  it("parcela na data da compra ainda desloca (o caso do Mercado Pago)", () => {
    // As dez parcelas chegam juntas, todas com a data da compra: `date` nao
    // andou, entao o indice e a unica coisa que sabe em que fatura cada uma cai.
    const mesmoDia = new Date("2026-08-17T00:00:00Z");
    expect(mesDaFatura(mesmoDia, "2026-09", 3, false, null, mesmoDia)).toBe("2026-11");
  });

  it("desloca so o que falta quando a data andou menos que o indice", () => {
    // Parcela 5 cuja data andou dois meses: faltam dois, nao quatro.
    expect(
      mesDaFatura(new Date("2026-08-13T00:00:00Z"), "2026-09", 5, false, null, compra)
    ).toBe("2026-11");
  });
});

describe("mesDaFatura com ancora (as parcelas que andavam de dois em dois meses)", () => {
  const emJunho = new Date("2026-06-02T00:00:00Z");

  it("sem ancora, o forecast por parcela e deslocado de novo — o bug", () => {
    // A Pluggy mandou o forecast **ja por parcela** (4/8 -> 2026-09), e o
    // deslocamento de `indice - 1` somou por cima: a parcela 4 foi parar em
    // dezembro e a 8 em agosto de 2027.
    expect(mesDaFatura(emJunho, "2026-09", 4, false)).toBe("2026-12");
    expect(mesDaFatura(emJunho, "2027-01", 8, false)).toBe("2027-08");
  });

  it("com ancora, cada parcela cai um mes depois da anterior", () => {
    expect(mesDaFatura(emJunho, "2026-09", 4, false, "2026-06")).toBe("2026-09");
    expect(mesDaFatura(emJunho, "2026-10", 5, false, "2026-06")).toBe("2026-10");
    expect(mesDaFatura(emJunho, "2026-11", 6, false, "2026-06")).toBe("2026-11");
    expect(mesDaFatura(emJunho, "2026-12", 7, false, "2026-06")).toBe("2026-12");
    expect(mesDaFatura(emJunho, "2027-01", 8, false, "2026-06")).toBe("2027-01");
  });

  it("a ancora nao mexe na parcela ja postada", () => {
    // Postada tem fatura de verdade: o mes vem dela, e nao de deducao nenhuma.
    expect(mesDaFatura(emJunho, "2026-06", 1, true, "2026-06")).toBe("2026-06");
  });

  it("sem ancora, o forecast constante continua funcionando", () => {
    // O outro conector manda o mesmo forecast nas oito parcelas, querendo dizer
    // "a primeira cai em setembro". Este caso ja acertava, e nao pode regredir.
    const emAgosto = new Date("2026-08-17T00:00:00Z");
    expect(mesDaFatura(emAgosto, "2026-09", 1, false)).toBe("2026-09");
    expect(mesDaFatura(emAgosto, "2026-09", 2, false)).toBe("2026-10");
    expect(mesDaFatura(emAgosto, "2026-09", 8, false)).toBe("2027-04");
  });
});
