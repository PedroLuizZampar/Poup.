import React from "react";
import { ArrowUpIcon, ArrowDownIcon } from "../icons/Icons";
import { formatCurrency, amountSizeClass } from "../../lib/format";

export interface MonthSummaryPanelProps {
  /**
   * Dinheiro disponível: só contas corrente e poupança. Fatura de cartão é
   * dívida e investimento não é liquidez — os dois saem daqui e aparecem em
   * linha própria abaixo.
   */
  accountBalance: number;
  /** Quantas contas entram no saldo acima. */
  accountCount: number;
  /** Soma das contas de investimento. Omitido quando não há nenhuma. */
  investmentTotal?: number;
  /** Soma das faturas de cartão em aberto, como valor positivo a pagar. */
  creditInvoiceTotal?: number;
  income: number;
  expense: number;
  /** Mês selecionado, capitalizado: "Agosto". */
  monthName: string;
}

/**
 * Resumo financeiro do topo do painel.
 *
 * A hierarquia é deliberada: o saldo consolidado responde "quanto eu tenho" e
 * fica sozinho na linha de cima; receitas, despesas e o resultado do mês são o
 * detalhamento e vivem abaixo, num degrau tipográfico menor.
 *
 * Todo valor passa por `amountSizeClass`, que desce a escala conforme a string
 * cresce. É o que impede o layout de estourar com saldos de sete dígitos sem
 * recorrer a `whitespace-nowrap` num tamanho fixo — que era o problema.
 */
export function MonthSummaryPanel({
  accountBalance,
  accountCount,
  investmentTotal = 0,
  creditInvoiceTotal = 0,
  income,
  expense,
  monthName,
}: MonthSummaryPanelProps) {
  const balance = income - expense;

  const accountBalanceText = formatCurrency(accountBalance);
  const balanceText = formatCurrency(balance, { showSign: balance > 0 });
  const incomeText = formatCurrency(income);
  const expenseText = formatCurrency(expense);

  const columnClasses =
    "flex flex-col gap-1 min-w-0 sm:px-4 sm:first:pl-0 sm:last:pr-0 sm:border-l sm:border-border sm:first:border-l-0";

  const asideClasses =
    "flex items-baseline gap-1.5 text-[11px] text-text-secondary whitespace-nowrap";

  return (
    <div className="bg-surface rounded-panel p-6 md:p-8 shadow-sh2 border border-border flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-overline uppercase tracking-wider text-text-secondary">
            Saldo em contas
          </h2>
          <p
            className={`font-display font-extrabold text-primary tnum mt-1.5 ${amountSizeClass(
              accountBalanceText,
              "hero"
            )}`}
          >
            {accountBalanceText}
          </p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0 pb-1.5">
          <span className="text-xs text-text-secondary">
            {accountCount} {accountCount === 1 ? "conta conectada" : "contas conectadas"}
          </span>

          {investmentTotal > 0 && (
            <span className={asideClasses}>
              Investimentos
              <strong className="font-semibold text-text-primary tnum">
                {formatCurrency(investmentTotal)}
              </strong>
            </span>
          )}

          {creditInvoiceTotal > 0 && (
            <span className={asideClasses}>
              Faturas em aberto
              <strong className="font-semibold text-expense tnum">
                {formatCurrency(creditInvoiceTotal)}
              </strong>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-0 pt-5 border-t border-border">
        <div className={columnClasses}>
          <span className="flex items-center gap-1.5 text-overline uppercase tracking-wider text-income font-semibold">
            <ArrowUpIcon className="w-3.5 h-3.5 shrink-0" /> Receitas
          </span>
          <span
            className={`font-display font-bold text-text-primary tnum mt-0.5 ${amountSizeClass(
              incomeText
            )}`}
          >
            {incomeText}
          </span>
          <span className="text-[11px] text-text-secondary">Entradas em {monthName}</span>
        </div>

        <div className={columnClasses}>
          <span className="flex items-center gap-1.5 text-overline uppercase tracking-wider text-expense font-semibold">
            <ArrowDownIcon className="w-3.5 h-3.5 shrink-0" /> Despesas
          </span>
          <span
            className={`font-display font-bold text-text-primary tnum mt-0.5 ${amountSizeClass(
              expenseText
            )}`}
          >
            {expenseText}
          </span>
          <span className="text-[11px] text-text-secondary">Saídas em {monthName}</span>
        </div>

        <div className={columnClasses}>
          <span className="text-overline uppercase tracking-wider text-text-secondary">
            Resultado do mês
          </span>
          <span
            className={`font-display font-extrabold tnum mt-0.5 ${amountSizeClass(balanceText)} ${
              balance < 0 ? "text-expense" : balance > 0 ? "text-income" : "text-text-primary"
            }`}
          >
            {balanceText}
          </span>
          <span className="text-[11px] text-text-secondary">
            {balance >= 0 ? "Superávit no período" : "Déficit no período"}
          </span>
        </div>
      </div>
    </div>
  );
}
