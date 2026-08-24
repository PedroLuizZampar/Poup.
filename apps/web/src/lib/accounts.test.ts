import { describe, expect, it } from "vitest";
import type { AccountDTO } from "@poup/shared";
import { ACCOUNT_TYPE_LABELS, summarizeAccounts } from "./accounts";

function conta(overrides: Partial<AccountDTO> & { id: string }): AccountDTO {
  return {
    name: overrides.id,
    originalName: overrides.id,
    type: "CHECKING",
    originalType: "CHECKING",
    customType: null,
    creditCardDueDay: null,
    balance: 0,
    institution: "Banco",
    institutionName: "Banco",
    lastSyncedAt: null,
    excludedFromBalance: false,
    ...overrides,
  };
}

describe("summarizeAccounts", () => {
  it("separa disponível, investimento e fatura", () => {
    const totais = summarizeAccounts([
      conta({ id: "corrente", type: "CHECKING", balance: 1000 }),
      conta({ id: "poupanca", type: "SAVINGS", balance: 500 }),
      conta({ id: "cdb", type: "INVESTMENT", balance: 20000 }),
      conta({ id: "cartao", type: "CREDIT", balance: -300 }),
    ]);

    expect(totais).toEqual({
      liquid: 1500,
      liquidCount: 2,
      investments: 20000,
      creditInvoices: 300,
    });
  });

  it("ignora nos três totais as contas marcadas como fora do saldo", () => {
    const totais = summarizeAccounts([
      conta({ id: "corrente", type: "CHECKING", balance: 1000 }),
      conta({ id: "conjunta", type: "CHECKING", balance: 9999, excludedFromBalance: true }),
      conta({ id: "cdb", type: "INVESTMENT", balance: 20000, excludedFromBalance: true }),
      conta({ id: "cartao", type: "CREDIT", balance: -300, excludedFromBalance: true }),
    ]);

    // A conta excluída não some só do total: ela também não pode contar como
    // "conta conectada" no rodapé do card, ou o número diria uma coisa e a
    // soma, outra.
    expect(totais).toEqual({
      liquid: 1000,
      liquidCount: 1,
      investments: 0,
      creditInvoices: 0,
    });
  });

  it("cartão de débito é dinheiro disponível, como a conta corrente que ele é", () => {
    // A Pluggy não tem esse tipo: ele só existe quando o usuário rotula a
    // conta à mão. O saldo, porém, é o da conta corrente a que o cartão está
    // preso — tratá-lo como outra coisa tiraria dinheiro real do total.
    const totais = summarizeAccounts([
      conta({ id: "corrente", type: "CHECKING", balance: 1000 }),
      conta({ id: "debito", type: "DEBIT_CARD", balance: 250 }),
    ]);

    expect(totais).toEqual({
      liquid: 1250,
      liquidCount: 2,
      investments: 0,
      creditInvoices: 0,
    });
  });

  it("poupança fora do saldo não entra no disponível nem na contagem", () => {
    // O padrão novo: poupança nasce com `excludedFromBalance`. O que este teste
    // protege é que ela sai também do `liquidCount` — um rodapé dizendo "2
    // contas" sobre a soma de uma só é pior que não ter rodapé.
    const totais = summarizeAccounts([
      conta({ id: "corrente", type: "CHECKING", balance: 1000 }),
      conta({ id: "poupanca", type: "SAVINGS", balance: 5000, excludedFromBalance: true }),
    ]);

    expect(totais).toEqual({
      liquid: 1000,
      liquidCount: 1,
      investments: 0,
      creditInvoices: 0,
    });
  });
});

describe("ACCOUNT_TYPE_LABELS", () => {
  it("tem rótulo para todos os cinco tipos", () => {
    // O select de tipo é montado a partir daqui; um tipo sem rótulo apareceria
    // como uma opção em branco.
    expect(Object.keys(ACCOUNT_TYPE_LABELS).sort()).toEqual([
      "CHECKING",
      "CREDIT",
      "DEBIT_CARD",
      "INVESTMENT",
      "SAVINGS",
    ]);
  });
});
