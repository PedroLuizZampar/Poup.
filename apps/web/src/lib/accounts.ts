import type { AccountDTO, AccountType } from "@poup/shared";

/**
 * O nome de cada tipo na tela, num lugar só.
 *
 * "Cartão de débito" não vem da Pluggy — para ela um cartão de débito é a conta
 * corrente a que está preso. O rótulo existe porque é assim que a pessoa chama
 * a conta, e é o usuário quem o aplica.
 */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  CREDIT: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  INVESTMENT: "Investimento",
};

/** A mesma tabela na forma que o `<Select>` consome. */
export const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = (
  Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]
).map((value) => ({ value, label: ACCOUNT_TYPE_LABELS[value] }));

export interface AccountTotals {
  /** Dinheiro disponível: conta corrente, cartão de débito e poupança. */
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
        // CHECKING, SAVINGS e DEBIT_CARD. Cartão de débito é a conta corrente
        // com outro nome, então o saldo dele é dinheiro disponível.
        totals.liquid += account.balance;
        totals.liquidCount++;
    }
  }

  return totals;
}
