import { describe, expect, it } from "vitest";
import { casarPagamentos, pagamentoQueQuita, parecePagamentoDeFatura } from "./pagamentoDeFatura";

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
