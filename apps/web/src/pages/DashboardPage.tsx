import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type {
  TransactionDTO,
  BudgetDTO,
  GoalDTO,
  AccountDTO,
  ReportSummaryDTO,
} from "@poup/shared";
import {
  fetchTransactions,
  fetchBudgets,
  fetchGoals,
  fetchAccounts,
  fetchReportSummary,
  checkNotifications,
  syncItem,
} from "../lib/api";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
} from "../components/icons/Icons";
import { CardSkeleton, TableRowSkeleton } from "../components/common/Skeleton";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { CategoryTile } from "../components/ui/CategoryTile";
import { InstitutionLogo } from "../components/ui/InstitutionLogo";
import { MonthlyFlowChart } from "../components/dashboard/MonthlyFlowChart";
import { MonthSummaryPanel } from "../components/dashboard/MonthSummaryPanel";
import { useToast } from "../components/ui/Toast";
import { useCategories } from "../hooks/useCategories";
import { SuggestionsButton } from "../components/suggestions/SuggestionsButton";
import { useMonthNavigation } from "../hooks/useMonthNavigation";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { summarizeAccounts } from "../lib/accounts";
import { formatCurrency, formatDate } from "../lib/format";
import { formatMonthShort } from "../lib/date";

/** Quantas transações a lista "Últimas transações" mostra. */
const RECENT_TRANSACTIONS_LIMIT = 5;
/** Meses do gráfico de fluxo, contando o selecionado. */
const FLOW_CHART_MONTHS = 3;

export function DashboardPage() {
  const user = useCurrentUser();
  const month = useMonthNavigation();
  const { categoryMap } = useCategories();

  const [summary, setSummary] = useState<ReportSummaryDTO | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<TransactionDTO[]>([]);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [budgets, setBudgets] = useState<BudgetDTO[]>([]);
  const [goals, setGoals] = useState<GoalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const toast = useToast();

  /**
   * Os totais vêm somados do banco (`/reports/summary`). O painel baixava três
   * meses inteiros de transações para reduzi-los a quatro números — e somava em
   * ponto flutuante no navegador. Do que ainda se baixa, só as cinco últimas
   * transações são de fato exibidas.
   */
  async function loadDashboard() {
    try {
      setLoading(true);
      const [reportSummary, txs, bdg, gls, accs] = await Promise.all([
        fetchReportSummary({ month: month.month, history: FLOW_CHART_MONTHS }),
        fetchTransactions({ month: month.month, limit: RECENT_TRANSACTIONS_LIMIT }),
        fetchBudgets(month.month).catch(() => []),
        fetchGoals().catch(() => []),
        fetchAccounts().catch(() => []),
      ]);

      setSummary(reportSummary);
      setRecentTransactions(txs);
      setBudgets(bdg);
      setGoals(gls);
      setAccounts(accs);
    } catch (err: any) {
      console.error("Erro ao carregar dados do dashboard:", err);
      toast.error("Erro ao carregar os dados do painel.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncAccounts() {
    try {
      setSyncing(true);
      const res = await syncItem();
      toast.success(
        "Sincronização concluída",
        `${res.accountsSynced} contas · ${res.transactionsSynced} transações sincronizadas`
      );
      // Os alertas de orçamento são gerados aqui, depois do sync — que é quando
      // os dados de fato mudaram. Abrir o sininho não escreve mais no banco.
      await checkNotifications().catch(() => undefined);
      await loadDashboard();
    } catch (err: any) {
      // A mensagem da API distingue "sem credencial cadastrada" e "sem conexão
      // adicionada" de uma falha de rede — trocá-la por um texto genérico
      // esconderia justamente o que o usuário precisa resolver no perfil.
      toast.error(err?.message || "Não foi possível sincronizar. Verifique sua conexão.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [month.month]);

  const accountTotals = useMemo(() => summarizeAccounts(accounts), [accounts]);

  const totalIncome = summary?.income ?? 0;
  const totalExpense = summary?.expense ?? 0;
  const transactionCount = summary?.transactionCount ?? 0;
  const uncategorizedCount = summary?.uncategorizedCount ?? 0;

  const chartData = useMemo(
    () =>
      (summary?.monthly ?? []).map((entry) => ({
        label: formatMonthShort(entry.month),
        income: entry.income,
        expense: entry.expense,
        isCurrent: entry.month === month.month,
      })),
    [summary, month.month]
  );

  const incomeText = formatCurrency(totalIncome);
  const expenseText = formatCurrency(totalExpense);

  return (
    <div className="flex flex-col gap-8 anim-fade-up">
      {/* Header com Navegação de Mês */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="min-w-0">
          <span className="text-xs md:text-sm text-text-secondary">
            Olá, {user.name.split(" ")[0]}
          </span>
          {/* O nome do mês trunca em vez de empurrar as setas para fora da tela:
              em 360px "Setembro de 2026" a 24px já não cabe ao lado de dois
              botões e do atalho de volta ao mês corrente. */}
          <div className="flex items-center gap-2 sm:gap-3 mt-1 min-w-0">
            <button
              type="button"
              onClick={month.goToPreviousMonth}
              className="tap-target w-9 h-9 shrink-0 rounded-ctl bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors focus-ring cursor-pointer"
              title="Mês anterior"
              aria-label="Mês anterior"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <h1 className="font-display font-extrabold text-2xl md:text-3xl tracking-tight text-text-primary truncate min-w-0">
              {month.fullName}
            </h1>
            <button
              type="button"
              onClick={month.goToNextMonth}
              className="tap-target w-9 h-9 shrink-0 rounded-ctl bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors focus-ring cursor-pointer"
              title="Próximo mês"
              aria-label="Próximo mês"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
            {!month.isCurrentMonth && (
              <button
                type="button"
                onClick={month.goToCurrentMonth}
                className="tap-target shrink-0 text-xs font-semibold text-primary hover:underline cursor-pointer focus-ring px-1.5 py-0.5 rounded"
              >
                Mês atual
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <SuggestionsButton />
          <Button
            variant="secondary"
            size="md"
            onClick={handleSyncAccounts}
            loading={syncing}
            iconLeft={<RefreshIcon className="w-4 h-4 text-primary" />}
            title="Buscar movimentações novas"
            className="flex-1 md:flex-none"
          >
            Sincronizar
          </Button>
          <Link to="/transacoes" className="flex-1 md:flex-none">
            <Button variant="primary" size="md" fullWidth className="md:w-auto">
              Ver transações
            </Button>
          </Link>
        </div>
      </div>

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Coluna Esquerda (2 cols) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Card Consolidado: Saldo em Contas + Métricas do Mês */}
          {loading ? (
            <CardSkeleton />
          ) : (
            <MonthSummaryPanel
              accountBalance={accountTotals.liquid}
              accountCount={accountTotals.liquidCount}
              investmentTotal={accountTotals.investments}
              creditInvoiceTotal={accountTotals.creditInvoices}
              income={totalIncome}
              expense={totalExpense}
              monthName={month.shortName}
            />
          )}

          {/* Gráfico Comparativo com Dados Reais dos 3 Meses */}
          <Card
            variant="panel"
            title="Entradas e saídas"
            subtitle={`Histórico dos últimos ${FLOW_CHART_MONTHS} meses`}
          >
            <MonthlyFlowChart data={chartData} />

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-text-secondary pt-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-income shrink-0" />
                Receitas em {month.shortName}
                <span className="tnum text-text-primary font-semibold">{incomeText}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-expense shrink-0" />
                Despesas em {month.shortName}
                <span className="tnum text-text-primary font-semibold">{expenseText}</span>
              </div>
            </div>
          </Card>

          {/* Últimas Transações */}
          <Card
            variant="panel"
            title="Últimas transações"
            action={
              <Link to="/transacoes" className="text-xs font-semibold text-primary hover:underline">
                Ver todas ({transactionCount})
              </Link>
            }
          >
            {loading ? (
              <div className="flex flex-col">
                <TableRowSkeleton />
                <TableRowSkeleton />
                <TableRowSkeleton />
              </div>
            ) : recentTransactions.length === 0 ? (
              <div className="py-10 text-center text-xs md:text-sm text-text-secondary">
                Nenhuma movimentação encontrada neste mês.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {recentTransactions.map((tx) => {
                  const cat = tx.categoryId ? categoryMap[tx.categoryId] : null;
                  return (
                    <div key={tx.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <CategoryTile
                          icon={cat?.icon}
                          colorKey={cat?.colorKey}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-xs md:text-sm text-text-primary truncate">
                            {tx.description}
                          </p>
                          <span className="text-xs text-text-secondary">
                            {tx.categoryName || "Sem categoria"} <span aria-hidden="true">·</span> {formatDate(tx.date)}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`font-display font-bold text-xs md:text-sm shrink-0 tnum ${
                          tx.type === "INCOME" ? "text-income" : "text-expense"
                        }`}
                      >
                        {tx.type === "INCOME" ? "+ " : "- "}
                        {formatCurrency(tx.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Coluna Direita (Widgets) */}
        <div className="flex flex-col gap-6">
          {/* Banner de Transações sem Categoria */}
          {uncategorizedCount > 0 && (
            <Link
              to="/transacoes?uncategorized=true"
              className="bg-primary-soft text-primary rounded-panel p-5 flex items-center gap-4 group hover:shadow-sh2 transition-all border border-primary/20"
            >
              <div className="w-10 h-10 rounded-tile bg-surface text-primary font-display font-extrabold text-sm flex items-center justify-center shrink-0 shadow-sh1">
                {uncategorizedCount}
              </div>
              <span className="flex-1 font-semibold text-xs md:text-sm leading-snug">
                {uncategorizedCount === 1
                  ? "1 transação sem categoria"
                  : `${uncategorizedCount} transações sem categoria`}
              </span>
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          )}

          {/* Widget Minhas Contas */}
          <Card
            variant="widget"
            title="Contas conectadas"
            action={
              <Link to="/perfil" className="text-xs font-semibold text-primary hover:underline">
                Gerenciar
              </Link>
            }
          >
            {accounts.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Nenhuma conta conectada.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border/60">
                {accounts.map((acc) => (
                  <div key={acc.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <InstitutionLogo
                        name={acc.institutionName}
                        imageUrl={acc.institutionImageUrl}
                        customImageUrl={acc.customImageUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-xs text-text-primary truncate">
                          {acc.name}
                        </p>
                        <p className="text-[11px] text-text-secondary truncate">
                          {acc.type === "CREDIT" ? "Fatura em aberto" : acc.institutionName}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-display font-bold text-xs shrink-0 tnum ${
                        acc.type === "CREDIT" ? "text-expense" : "text-text-primary"
                      }`}
                    >
                      {formatCurrency(acc.balance)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Widget Metas de Economia — consolida o antigo par de cards
              ("Metas de economia" + "Metas"), que mostrava os mesmos dados. */}
          <Card
            variant="widget"
            title="Metas de economia"
            action={
              <Link to="/planejamento" className="text-xs font-semibold text-primary hover:underline">
                Ver todas
              </Link>
            }
          >
            {goals.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Nenhuma meta criada ainda.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border/60">
                {goals.slice(0, 3).map((g) => {
                  const progress = Math.min(Math.max(g.progress, 0), 100);
                  const complete = progress >= 100;

                  return (
                    <div key={g.id} className="flex items-center gap-3.5 py-3 first:pt-0 last:pb-0">
                      {/* Anel de progresso: o percentual desenhado como arco
                          torna o avanço legível antes de ler o número. */}
                      <div
                        className="w-11 h-11 rounded-full shrink-0 grid place-items-center"
                        style={{
                          background: `conic-gradient(var(--primary) ${progress * 3.6}deg, var(--surface-sunken) 0deg)`,
                        }}
                        role="img"
                        aria-label={`${Math.round(progress)}% da meta ${g.name}`}
                      >
                        <span className="w-[34px] h-[34px] rounded-full bg-surface grid place-items-center font-display font-extrabold text-[11px] text-primary tnum">
                          {Math.round(progress)}%
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text-primary truncate">
                          {g.name}
                        </p>
                        <p className="text-xs text-text-secondary tnum mt-0.5">
                          <span className="font-semibold text-text-primary">
                            {formatCurrency(g.currentAmount)}
                          </span>{" "}
                          de {formatCurrency(g.targetAmount)}
                        </p>
                        <p className="text-[11px] text-text-secondary tnum mt-0.5">
                          {complete
                            ? "Meta alcançada"
                            : `Faltam ${formatCurrency(g.remainingAmount)}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Widget de Orçamentos do Mês */}
          <Card
            variant="widget"
            title="Orçamentos do mês"
            action={
              <Link to="/planejamento" className="text-xs font-semibold text-primary hover:underline">
                Ver todos
              </Link>
            }
          >
            {budgets.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Nenhum orçamento configurado ainda.
              </p>
            ) : (
              <div className="flex flex-col gap-3.5">
                {budgets.slice(0, 3).map((b) => (
                  <div key={b.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-text-primary font-semibold">{b.categoryName}</span>
                      <span
                        className={`tnum ${
                          b.status === "exceeded"
                            ? "text-error font-bold"
                            : b.status === "warning"
                            ? "text-warning font-bold"
                            : "text-text-secondary"
                        }`}
                      >
                        {formatCurrency(b.spent)} / {formatCurrency(b.monthlyLimit)}
                      </span>
                    </div>
                    <ProgressBar
                      value={b.spent}
                      max={b.monthlyLimit}
                      status={b.status}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
