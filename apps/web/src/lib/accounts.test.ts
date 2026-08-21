import { describe, expect, it } from "vitest";
import type { AccountDTO } from "@poup/shared";
import { summarizeAccounts } from "./accounts";

function conta(overrides: Partial<AccountDTO> & { id: string }): AccountDTO {
  return {
    name: overrides.id,
    originalName: overrides.id,
    type: "CHECKING",
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
});
