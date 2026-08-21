import type { AccountDTO } from "@poup/shared";

export interface AccountTotals {
  /** Dinheiro disponível: conta corrente e poupança. */
  liquid: number;
  /** Contas de investimento — patrimônio, não liquidez. */
  investments: number;
  /** Faturas de cartão em aberto, como valor positivo a pagar. */
  creditInvoices: number;
  /** Quantas contas entram em `liquid`. */
  liquidCount: number;
}

/**
 * Separa os saldos por natureza.
 *
 * O painel somava `balance` de **todas** as contas num "saldo total". Só que o
 * `balance` de uma conta de crédito é o valor da fatura — uma dívida — então
 * com fatura aberta o saldo aparecia inflado exatamente pelo que se deve. E
 * investimento, somado junto, mistura liquidez com patrimônio: responde à
 * pergunta errada quando o que se quer saber é "quanto posso gastar hoje".
 *
 * Contas marcadas como `excludedFromBalance` ficam de fora dos três totais — e
 * só deles: as transações delas continuam contando em relatórios e orçamentos.
 */
export function summarizeAccounts(accounts: AccountDTO[]): AccountTotals {
  const totals: AccountTotals = {
    liquid: 0,
    investments: 0,
    creditInvoices: 0,
    liquidCount: 0,
  };

  for (const account of accounts) {
    if (account.excludedFromBalance) continue;

    switch (account.type) {
      case "CREDIT":
        totals.creditInvoices += Math.abs(account.balance);
        break;
      case "INVESTMENT":
        totals.investments += account.balance;
        break;
      default:
        totals.liquid += account.balance;
        totals.liquidCount++;
    }
  }

  return totals;
}
