import React, { useState, useEffect, useMemo } from "react";
import type {
  ReportCategoryTotalDTO,
  ReportKindTotalDTO,
  ReportPeriod,
  ReportSummaryDTO,
} from "@poup/shared";
import { fetchReportSummary } from "../lib/api";
import { CardSkeleton } from "../components/common/Skeleton";
import { EmptyState } from "../components/common/EmptyState";
import { CategoryTile, normalizeColorKey } from "../components/ui/CategoryTile";
import { Select } from "../components/ui/Select";
import { formatPercent } from "../lib/format";
import { Money } from "../components/ui/Money";

/** Dentro de cada grupo, depois da 6ª categoria a cauda vira uma linha só. */
const TOP_CATEGORIES = 6;

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

  /**
   * A cauda vira uma linha só — mas por grupo, e não na lista inteira. Cortar
   * antes de separar fixas de variáveis somaria numa linha só coisas que
   * pertencem a grupos diferentes, e é justamente a separação que a tela
   * existe para mostrar.
   */
  function collapseTail(rows: ReportCategoryTotalDTO[]): ReportCategoryTotalDTO[] {
    if (rows.length <= TOP_CATEGORIES) return rows;

    const top = rows.slice(0, TOP_CATEGORIES);
    const tail = rows.slice(TOP_CATEGORIES);

    return [
      ...top,
      {
        categoryId: null,
        categoryName: `Outras ${tail.length} categorias`,
        categoryIcon: null,
        categoryColorKey: null,
        categoryKind: null,
        amount: tail.reduce((sum, item) => sum + item.amount, 0),
        percentage: tail.reduce((sum, item) => sum + item.percentage, 0),
        transactionCount: tail.reduce((sum, item) => sum + item.transactionCount, 0),
      },
    ];
  }

  const groups = useMemo<ReportKindTotalDTO[]>(() => {
    if (!summary) return [];
    // Fixas primeiro: é o piso do mês, o número que não se negocia. O que sobra
    // depois dele é que é a margem de manobra.
    return [summary.byKind.fixed, summary.byKind.variable].filter(
      (group) => group.categories.length > 0
    );
  }, [summary]);

  const fixedTotal = summary?.byKind.fixed.amount ?? 0;
  const variableTotal = summary?.byKind.variable.amount ?? 0;
  const hasExpenses = totalExpense > 0;

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
              <Money value={totalIncome} />
            </div>
          </div>

          <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col gap-1">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Despesas no período
            </span>
            <div className="font-display font-extrabold text-num-xl text-expense mt-0.5 tnum">
              <Money value={totalExpense} />
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

      {/* Fixas × variáveis — a leitura que vem antes da lista: quanto do mês
          já estava decidido antes de ele começar. */}
      {loading ? (
        <CardSkeleton />
      ) : (
        <div className="bg-surface rounded-panel p-6 md:p-8 shadow-sh2 border border-border flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display font-bold text-base md:text-lg text-text-primary">
              Despesas fixas e variáveis
            </h2>
            <span className="text-caption text-text-secondary text-right">
              {expenseCount} {expenseCount === 1 ? "despesa" : "despesas"}
            </span>
          </div>

          {!hasExpenses ? (
            <EmptyState
              title="Sem despesas no período"
              description="Não encontramos nenhuma movimentação de saída para o período selecionado."
            />
          ) : (
            <>
              {/* Uma barra só, dividida — comparar duas barras separadas obriga
                  a medir; aqui a proporção é a própria forma. */}
              <div className="flex h-3 rounded-full overflow-hidden bg-surface-alt border border-border/40">
                <div
                  className="bg-cat-9-fg transition-all duration-300"
                  style={{ width: `${summary?.byKind.fixed.percentage ?? 0}%` }}
                />
                <div
                  className="bg-cat-3-fg transition-all duration-300"
                  style={{ width: `${summary?.byKind.variable.percentage ?? 0}%` }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <KindSummary
                  swatch="bg-cat-9-fg"
                  label="Fixas"
                  hint="Repetem todo mês"
                  group={summary!.byKind.fixed}
                />
                <KindSummary
                  swatch="bg-cat-3-fg"
                  label="Variáveis"
                  hint="Dependem do mês"
                  group={summary!.byKind.variable}
                />
              </div>

              <p className="text-caption text-text-secondary">
                {fixedTotal > variableTotal
                  ? "A maior parte do que você gastou já estava comprometida antes do mês começar."
                  : variableTotal > 0
                  ? "A maior parte do que você gastou é margem de manobra — decisão do mês, não compromisso."
                  : "Todas as despesas do período estão em categorias fixas."}
              </p>
            </>
          )}
        </div>
      )}

      {/* Breakdown por categoria, dentro de cada grupo */}
      <div className="bg-surface rounded-panel p-6 md:p-8 shadow-sh2 border border-border flex flex-col gap-6">
        <h2 className="font-display font-bold text-base md:text-lg text-text-primary">
          Distribuição de gastos por categoria
        </h2>

        {loading ? (
          <div className="py-12 text-center text-xs text-text-secondary">
            Calculando distribuição...
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            title="Sem despesas no período"
            description="Não encontramos nenhuma movimentação de saída para o período selecionado."
          />
        ) : (
          <div className="flex flex-col gap-7">
            {groups.map((group) => (
              <div key={group.kind} className="flex flex-col gap-4">
                <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-border">
                  <span className="text-overline uppercase tracking-wider text-text-secondary">
                    {group.kind === "FIXED" ? "Fixas" : "Variáveis"}
                  </span>
                  <span className="font-display font-bold text-sm text-text-primary tnum">
                    <Money value={group.amount} />
                  </span>
                </div>

                <div className="flex flex-col gap-5">
                  {collapseTail(group.categories).map((item) => (
                    <div
                      key={item.categoryId ?? item.categoryName}
                      className="flex flex-col gap-2"
                    >
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
                            <Money value={item.amount} />
                          </span>
                          <span className="text-caption font-semibold text-text-secondary w-12 text-right tnum">
                            {item.percentage.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      <div className="h-2.5 rounded-full bg-surface-alt overflow-hidden border border-border/40">
                        {/* A classe é montada em tempo de execução; o safelist do
                            Tailwind cobre cat-1..16. */}
                        <div
                          className={`h-full rounded-full transition-all duration-300 bg-cat-${normalizeColorKey(
                            item.categoryColorKey
                          )}-fg`}
                          style={{ width: `${Math.min(100, item.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Um dos dois lados do painel: total, fatia e quantas despesas o compõem. */
function KindSummary({
  swatch,
  label,
  hint,
  group,
}: {
  swatch: string;
  label: string;
  hint: string;
  group: ReportKindTotalDTO;
}) {
  return (
    <div className="rounded-card border border-border bg-surface-alt/40 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${swatch}`} aria-hidden="true" />
        <span className="text-label text-text-secondary">{label}</span>
        <span className="text-caption text-text-disabled ml-auto tnum">
          {group.percentage.toFixed(1)}%
        </span>
      </div>
      <div className="font-display font-extrabold text-num-lg text-text-primary tnum">
        <Money value={group.amount} />
      </div>
      <p className="text-caption text-text-secondary">
        {hint} · {group.transactionCount}{" "}
        {group.transactionCount === 1 ? "despesa" : "despesas"}
      </p>
    </div>
  );
}
