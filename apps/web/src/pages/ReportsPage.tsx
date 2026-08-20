import React, { useState, useEffect, useMemo } from "react";
import type { ReportCategoryTotalDTO, ReportPeriod, ReportSummaryDTO } from "@poup/shared";
import { fetchReportSummary } from "../lib/api";
import { CardSkeleton } from "../components/common/Skeleton";
import { EmptyState } from "../components/common/EmptyState";
import { CategoryTile } from "../components/ui/CategoryTile";
import { Select } from "../components/ui/Select";
import { formatCurrency, formatPercent } from "../lib/format";

/** Depois da 8ª categoria, a cauda vira uma linha só. */
const TOP_CATEGORIES = 8;

const PERIOD_OPTIONS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "current", label: "Mês atual" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "year", label: "Este ano" },
  { value: "all", label: "Todo o período" },
];

export function ReportsPage() {
  const [summary, setSummary] = useState<ReportSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ReportPeriod>("current");

  /**
   * Um pedido por período, com os totais já somados no banco. A página baixava
   * o histórico **inteiro** de transações e filtrava por data no navegador —
   * o que cresce sem teto conforme o extrato aumenta.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        const result = await fetchReportSummary({ period });
        if (!cancelled) setSummary(result);
      } catch (err) {
        console.error("Erro ao carregar relatórios:", err);
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const totalIncome = summary?.income ?? 0;
  const totalExpense = summary?.expense ?? 0;
  const expenseCount = summary?.expenseCount ?? 0;
  const savingsRate = summary?.savingsRate ?? 0;

  const categoryBreakdown = useMemo<ReportCategoryTotalDTO[]>(() => {
    const rows = summary?.byCategory ?? [];
    if (rows.length <= TOP_CATEGORIES) return rows;

    const top = rows.slice(0, TOP_CATEGORIES);
    const tail = rows.slice(TOP_CATEGORIES);

    return [
      ...top,
      {
        categoryId: null,
        categoryName: "Outras categorias",
        categoryIcon: null,
        categoryColorKey: null,
        amount: tail.reduce((sum, item) => sum + item.amount, 0),
        percentage: tail.reduce((sum, item) => sum + item.percentage, 0),
        transactionCount: tail.reduce((sum, item) => sum + item.transactionCount, 0),
      },
    ];
  }, [summary]);

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      {/* Header com Filtro de Período */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-xl font-display font-extrabold text-text-primary">
            Relatórios
          </h1>
          <p className="text-xs md:text-sm text-text-secondary mt-0.5">
            Distribuição dos seus gastos e fluxo financeiro por período
          </p>
        </div>

        <div className="w-full sm:w-52">
          <Select
            size="sm"
            value={period}
            onChange={(val) => setPeriod(val as ReportPeriod)}
            options={PERIOD_OPTIONS}
          />
        </div>
      </div>

      {/* Cards de Resumo */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col gap-1">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Receitas no período
            </span>
            <div className="font-display font-extrabold text-num-xl text-income mt-0.5 tnum">
              {formatCurrency(totalIncome)}
            </div>
          </div>

          <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col gap-1">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Despesas no período
            </span>
            <div className="font-display font-extrabold text-num-xl text-expense mt-0.5 tnum">
              {formatCurrency(totalExpense)}
            </div>
          </div>

          <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col gap-1">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Taxa de economia
            </span>
            <div
              className={`font-display font-extrabold text-num-xl mt-0.5 tnum ${
                savingsRate >= 0 ? "text-primary" : "text-expense"
              }`}
            >
              {formatPercent(savingsRate)}
            </div>
          </div>
        </div>
      )}

      {/* Breakdown por Categoria com Cores Reais */}
      <div className="bg-surface rounded-panel p-6 md:p-8 shadow-sh2 border border-border flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-base md:text-lg text-text-primary">
            Distribuição de gastos por categoria
          </h2>
          <span className="text-caption text-text-secondary">
            {expenseCount} {expenseCount === 1 ? "despesa" : "despesas"}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-text-secondary">
            Calculando distribuição...
          </div>
        ) : categoryBreakdown.length === 0 ? (
          <EmptyState
            title="Sem despesas no período"
            description="Não encontramos nenhuma movimentação de saída para o período selecionado."
          />
        ) : (
          <div className="flex flex-col gap-5">
            {categoryBreakdown.map((item) => {
              const colorKey = item.categoryColorKey || "1";
              const bgClass =
                colorKey === "1"
                  ? "bg-cat-1-fg"
                  : colorKey === "2"
                  ? "bg-cat-2-fg"
                  : colorKey === "3"
                  ? "bg-cat-3-fg"
                  : colorKey === "4"
                  ? "bg-cat-4-fg"
                  : "bg-cat-5-fg";

              return (
                <div key={item.categoryId ?? item.categoryName} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs md:text-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CategoryTile
                        icon={item.categoryIcon ?? undefined}
                        colorKey={item.categoryColorKey ?? undefined}
                        size="sm"
                      />
                      <span className="font-semibold text-text-primary truncate">
                        {item.categoryName}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-display font-bold text-text-primary tnum">
                        {formatCurrency(item.amount)}
                      </span>
                      <span className="text-caption font-semibold text-text-secondary w-12 text-right tnum">
                        {item.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="h-2.5 rounded-full bg-surface-alt overflow-hidden border border-border/40">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${bgClass}`}
                      style={{ width: `${Math.min(100, item.percentage)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
