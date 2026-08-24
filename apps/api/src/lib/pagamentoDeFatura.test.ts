import { describe, expect, it } from "vitest";
import {
  casarPagamentos,
  casarPontas,
  casarPorDescricao,
  pagamentoQueQuita,
  parecePagamentoDeFatura,
} from "./pagamentoDeFatura";

const fatura = {
  billId: "fatura-1",
  accountId: "cartao-1",
  paidAt: new Date("2026-09-10T00:00:00Z"),
  paidAmount: 300,
};

const debito = {
  id: "tx-1",
  accountId: "corrente-1",
  date: new Date("2026-09-10T00:00:00Z"),
  amount: 300,
};

describe("casarPagamentos", () => {
  it("casa valor igual no mesmo dia", () => {
    expect(casarPagamentos([fatura], [debito])).toEqual([
      { transactionId: "tx-1", billId: "fatura-1" },
    ]);
  });

  it("casa dentro da janela de tres dias", () => {
    const doisDiasAntes = { ...debito, date: new Date("2026-09-08T00:00:00Z") };
    expect(casarPagamentos([fatura], [doisDiasAntes])).toHaveLength(1);
  });

  it("nao casa fora da janela", () => {
    // Uma despesa de mesmo valor duas semanas depois nao e o pagamento.
    const longe = { ...debito, date: new Date("2026-09-25T00:00:00Z") };
    expect(casarPagamentos([fatura], [longe])).toEqual([]);
  });

  it("nao casa valor diferente", () => {
    // Pagamento parcial existe, mas casar por aproximacao transformaria
    // qualquer despesa parecida em transferencia.
    expect(casarPagamentos([fatura], [{ ...debito, amount: 299.9 }])).toEqual([]);
  });

  it("nao casa um debito na propria conta do cartao", () => {
    // A outra ponta do pagamento mora no cartao e ja e tratada pelo pareamento
    // de transferencia que existe. Casar aqui duplicaria o vinculo.
    expect(casarPagamentos([fatura], [{ ...debito, accountId: "cartao-1" }])).toEqual([]);
  });

  it("cada debito casa com uma fatura so", () => {
    // Duas faturas de mesmo valor no mesmo dia (dois cartoes) e um debito so:
    // o debito paga uma delas, e escolher as duas inventaria dinheiro.
    const outra = { ...fatura, billId: "fatura-2", accountId: "cartao-2" };
    expect(casarPagamentos([fatura, outra], [debito])).toHaveLength(1);
  });

  it("cada fatura casa com um debito so", () => {
    const outroDebito = { ...debito, id: "tx-2" };
    expect(casarPagamentos([fatura], [debito, outroDebito])).toHaveLength(1);
  });

  it("prefere o debito mais proximo da data do pagamento", () => {
    const longe = { ...debito, id: "tx-longe", date: new Date("2026-09-08T00:00:00Z") };
    const perto = { ...debito, id: "tx-perto", date: new Date("2026-09-10T00:00:00Z") };
    expect(casarPagamentos([fatura], [longe, perto])).toEqual([
      { transactionId: "tx-perto", billId: "fatura-1" },
    ]);
  });

  it("lista vazia nao quebra", () => {
    expect(casarPagamentos([], [debito])).toEqual([]);
    expect(casarPagamentos([fatura], [])).toEqual([]);
  });
});

describe("parecePagamentoDeFatura", () => {
  it("reconhece as formas comuns", () => {
    expect(parecePagamentoDeFatura("PAGTO FATURA CARTAO")).toBe(true);
    expect(parecePagamentoDeFatura("PAGAMENTO FATURA")).toBe(true);
    expect(parecePagamentoDeFatura("PAGTO CARTAO DE CREDITO")).toBe(true);
    expect(parecePagamentoDeFatura("PAGAMENTO DE FATURA")).toBe(true);
  });

  it("ignora acento e caixa", () => {
    expect(parecePagamentoDeFatura("pagamento de fatura")).toBe(true);
    expect(parecePagamentoDeFatura("Pagto Cartão")).toBe(true);
  });

  it("nao confunde outros pagamentos", () => {
    // A heuristica so entra quando a API nao deu resposta, entao errar aqui
    // marca uma despesa real como transferencia e ela some dos relatorios.
    expect(parecePagamentoDeFatura("PAGAMENTO ALUGUEL")).toBe(false);
    expect(parecePagamentoDeFatura("PAGTO BOLETO ENERGIA")).toBe(false);
    expect(parecePagamentoDeFatura("FATURA DE ENERGIA")).toBe(false);
    expect(parecePagamentoDeFatura("SUPERMERCADO")).toBe(false);
  });
});

describe("pagamentoQueQuita", () => {
  const quitacao = {
    valueType: "FULL_PAYMENT" as const,
    paymentDate: new Date("2026-08-12T00:00:00Z"),
    amount: 94.62,
  };

  it("ignora o credito lancado como OTHER_PAYMENT", () => {
    // O caso real: um estorno de R$ 272 entrou na fatura de agosto como
    // OTHER_PAYMENT, depois da quitacao. Pela data ele e o ultimo, e por isso
    // o app passou a achar que a fatura de R$ 94,62 foi paga por R$ 272.
    const estorno = {
      valueType: "OTHER_PAYMENT" as const,
      paymentDate: new Date("2026-08-22T00:00:00Z"),
      amount: 272,
    };

    expect(pagamentoQueQuita([quitacao, estorno])).toEqual(quitacao);
  });

  it("entre pagamentos classificados, fica com o ultimo", () => {
    const depois = { ...quitacao, paymentDate: new Date("2026-08-14T00:00:00Z"), amount: 30 };
    expect(pagamentoQueQuita([quitacao, depois])).toEqual(depois);
  });

  it("aceita a quitacao de uma fatura parcelada", () => {
    // Parcelar a fatura e pagar a fatura: o debito existe na conta corrente e
    // precisa ser reconhecido como transferencia igual.
    const parcelada = { ...quitacao, valueType: "INSTALLMENT_PAYMENT" as const, amount: 50 };
    expect(pagamentoQueQuita([parcelada])).toEqual(parcelada);
  });

  it("nao inventa quitacao quando so ha OTHER_PAYMENT", () => {
    // Preferir nao reconhecer: reconhecer errado faz uma despesa real sumir do
    // relatorio, e a reserva por descricao ainda tem chance de acertar.
    const soEstorno = { ...quitacao, valueType: "OTHER_PAYMENT" as const };
    expect(pagamentoQueQuita([soEstorno])).toBeNull();
  });

  it("fatura sem pagamento nao esta paga", () => {
    expect(pagamentoQueQuita([])).toBeNull();
  });
});

describe("casarPorDescricao", () => {
  const debitoDescrito = {
    id: "tx-1",
    accountId: "corrente-1",
    date: new Date("2026-08-12T00:00:00Z"),
    amount: 94.62,
    description: "Pagamento Cartão de crédito",
  };

  const creditoNoCartao = {
    id: "tx-cartao-1",
    accountId: "cartao-1",
    date: new Date("2026-08-12T00:00:00Z"),
    amount: 94.62,
  };

  it("casa quando a outra ponta existe num cartao vinculado", () => {
    // O conector do Inter nao devolve fatura nenhuma. O cartao dele esta
    // vinculado, entao o credito da quitacao aparece no extrato do cartao — e e
    // ele que autoriza a descricao a decidir.
    expect(casarPorDescricao([debitoDescrito], [creditoNoCartao])).toEqual([
      { debitoId: "tx-1", creditoId: "tx-cartao-1" },
    ]);
  });

  it("nao casa sem contraparte nenhuma", () => {
    // O caso real: "Pagamento Cartão de crédito" de R$ 94,62 no Mercado Pago,
    // cujo cartao nao esta no app. Sem as duas pontas vinculadas a despesa e
    // real, e marca-la como transferencia a apagaria dos relatorios.
    expect(casarPorDescricao([debitoDescrito], [])).toEqual([]);
  });

  it("nao casa contraparte de valor diferente", () => {
    expect(casarPorDescricao([debitoDescrito], [{ ...creditoNoCartao, amount: 94.61 }])).toEqual(
      []
    );
  });

  it("nao casa contraparte fora da janela de tres dias", () => {
    const longe = { ...creditoNoCartao, date: new Date("2026-08-20T00:00:00Z") };
    expect(casarPorDescricao([debitoDescrito], [longe])).toEqual([]);
  });

  it("casa dentro da janela de tres dias", () => {
    const doisDiasDepois = { ...creditoNoCartao, date: new Date("2026-08-14T00:00:00Z") };
    expect(casarPorDescricao([debitoDescrito], [doisDiasDepois])).toEqual([
      { debitoId: "tx-1", creditoId: "tx-cartao-1" },
    ]);
  });

  it("ignora o debito cuja descricao nao fala de fatura", () => {
    // A contraparte sozinha nao basta: um credito de mesmo valor no cartao pode
    // ser estorno de compra, e o debito do mesmo dia, uma despesa qualquer.
    const aluguel = { ...debitoDescrito, description: "PAGAMENTO ALUGUEL" };
    expect(casarPorDescricao([aluguel], [creditoNoCartao])).toEqual([]);
  });

  it("cada credito paga um debito so", () => {
    // Dois debitos de mesmo valor e um credito so: casar os dois faria duas
    // despesas sumirem por conta de um pagamento que aconteceu uma vez.
    const outro = { ...debitoDescrito, id: "tx-2" };
    expect(casarPorDescricao([debitoDescrito, outro], [creditoNoCartao])).toEqual([
      { debitoId: "tx-1", creditoId: "tx-cartao-1" },
    ]);
  });

  it("prefere o credito mais proximo, e isso decide quantos debitos casam", () => {
    // Dois cartoes quitados no mesmo periodo. O credito de 12/08 alcanca o
    // debito de 12/08 mas nao o de 16/08; o de 13/08 alcanca os dois.
    //
    // Se o primeiro debito ficar com o credito mais proximo (o de 12/08), sobra
    // para o segundo o de 13/08, que ainda o alcanca — e os dois casam. Se ele
    // ficar com o de 13/08, o segundo herda um credito fora da janela e nao
    // casa. Por isso a preferencia por data nao e cosmetica: ela muda o
    // resultado.
    const emDoze = { ...creditoNoCartao, id: "cartao-12" };
    const emTreze = {
      ...creditoNoCartao,
      id: "cartao-13",
      date: new Date("2026-08-13T00:00:00Z"),
    };
    const seisDiasDepois = {
      ...debitoDescrito,
      id: "tx-2",
      date: new Date("2026-08-16T00:00:00Z"),
    };

    expect(casarPorDescricao([debitoDescrito, seisDiasDepois], [emTreze, emDoze])).toEqual([
      { debitoId: "tx-1", creditoId: "cartao-12" },
      { debitoId: "tx-2", creditoId: "cartao-13" },
    ]);
  });

  it("lista vazia nao quebra", () => {
    expect(casarPorDescricao([], [creditoNoCartao])).toEqual([]);
    expect(casarPorDescricao([debitoDescrito], [])).toEqual([]);
  });
});

describe("casarPontas", () => {
  const debito = {
    id: "tx-1",
    accountId: "corrente-1",
    date: new Date("2026-08-12T00:00:00Z"),
    amount: 94.62,
  };

  const credito = {
    id: "tx-cartao-1",
    accountId: "cartao-1",
    date: new Date("2026-08-12T00:00:00Z"),
    amount: 94.62,
  };

  it("devolve as duas pontas do mesmo pagamento", () => {
    // Marcar so o debito deixava o credito do cartao contando como receita: no
    // caso real o pagamento de R$ 94,62 abatia a despesa de um lado e entrava
    // como dinheiro novo do outro.
    expect(casarPontas([debito], [credito])).toEqual([
      { debitoId: "tx-1", creditoId: "tx-cartao-1" },
    ]);
  });

  it("nao exige descricao nenhuma", () => {
    // Diferente da reserva por descricao: aqui quem reconheceu o debito foi a
    // fatura, que ja e prova. A descricao pode ser qualquer coisa.
    const mudo = { ...debito, description: "QUALQUER COISA" };
    expect(casarPontas([mudo], [credito])).toHaveLength(1);
  });

  it("nao inventa contraparte quando ela nao existe", () => {
    expect(casarPontas([debito], [])).toEqual([]);
  });

  it("um credito espelha um debito so", () => {
    const outro = { ...debito, id: "tx-2" };
    expect(casarPontas([debito, outro], [credito])).toEqual([
      { debitoId: "tx-1", creditoId: "tx-cartao-1" },
    ]);
  });
});
