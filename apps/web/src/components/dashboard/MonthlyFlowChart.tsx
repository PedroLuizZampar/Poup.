import React from "react";
import { formatCurrency, formatCurrencyCompact } from "../../lib/format";

export interface MonthlyFlowDatum {
  label: string;
  income: number;
  expense: number;
  isCurrent: boolean;
}

export interface MonthlyFlowChartProps {
  data: MonthlyFlowDatum[];
}

/**
 * Arredonda um valor para cima até o próximo "passo redondo" (1, 2, 2,5 ou 5 ×
 * 10ⁿ).
 */
function niceStep(value: number): number {
  if (value <= 0) return 25;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Topo do eixo, escolhido a partir do *intervalo* entre linhas e não do pico.
 *
 * Arredondar só o topo produz rótulos intermediários feios: um pico de
 * R$ 3.838 vira topo R$ 5.000 e linhas em R$ 1.250 / 2.500 / 3.750. Arredondando
 * o intervalo primeiro, o mesmo pico vira passo de R$ 1.000 e linhas em
 * R$ 1.000 / 2.000 / 3.000 / 4.000.
 */
function axisCeil(peak: number, steps: number): number {
  if (peak <= 0) return 100;
  return niceStep(peak / steps) * steps;
}

const PLOT_HEIGHT = 208;
const GRID_STEPS = 4;

/**
 * Faixa reservada acima do gráfico para o balão do mês. Sem ela o balão sobe
 * por cima do topo do card e é cortado — era o que acontecia com os dois balões
 * anteriores, um por barra.
 */
const TOOLTIP_BAND = 92;

/**
 * Balão único do mês: mês, receitas, despesas e o saldo — que antes o leitor
 * tinha que calcular de cabeça a partir de dois balões sobrepostos.
 *
 * Fica sempre montado e some por opacidade; abrir no hover *e* no foco é o que
 * permite ler o gráfico pelo teclado.
 */
function MonthTooltip({
  datum,
  align,
}: {
  datum: MonthlyFlowDatum;
  align: "start" | "center" | "end";
}) {
  const balance = datum.income - datum.expense;
  const alignClasses =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <div
      className={`absolute bottom-full ${alignClasses} mb-2 z-10 w-max min-w-[9.5rem] px-3 py-2 rounded-tile bg-surface border border-border shadow-sh2 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-[opacity,transform] duration-150 pointer-events-none`}
      aria-hidden="true"
    >
      <p className="text-[11px] font-bold text-text-primary mb-1.5">{datum.label}</p>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-income shrink-0" />
            Receitas
          </span>
          <span className="text-[11px] font-semibold tnum text-text-primary">
            {formatCurrency(datum.income)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-expense shrink-0" />
            Despesas
          </span>
          <span className="text-[11px] font-semibold tnum text-text-primary">
            {formatCurrency(datum.expense)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1 mt-0.5 border-t border-border">
          <span className="text-[11px] text-text-secondary">Saldo</span>
          <span
            className={`text-[11px] font-bold tnum ${
              balance < 0 ? "text-expense" : "text-income"
            }`}
          >
            {formatCurrency(balance, { showSign: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Texto lido por leitor de tela no lugar do balão, que é puramente visual. */
function describeMonth(datum: MonthlyFlowDatum): string {
  const balance = datum.income - datum.expense;
  return `${datum.label}: receitas ${formatCurrency(datum.income)}, despesas ${formatCurrency(
    datum.expense
  )}, saldo ${formatCurrency(balance, { showSign: true })}`;
}

/**
 * Comparativo de entradas e saídas dos últimos meses.
 *
 * As barras sozinhas só comunicam proporção relativa; com as linhas de grade
 * rotuladas o leitor consegue ler a grandeza de cada barra sem passar o mouse.
 */
export function MonthlyFlowChart({ data }: MonthlyFlowChartProps) {
  const peak = Math.max(...data.flatMap((d) => [d.income, d.expense]), 0);
  const axisMax = axisCeil(peak, GRID_STEPS);

  const gridValues = Array.from(
    { length: GRID_STEPS + 1 },
    (_, i) => (axisMax / GRID_STEPS) * (GRID_STEPS - i)
  );

  return (
    // A faixa do balão é padding do gráfico inteiro, não margem do balão: assim
    // o card já nasce com a altura certa e nada salta quando o mouse entra.
    <div className="flex gap-3" style={{ paddingTop: TOOLTIP_BAND }}>
      {/* Eixo de valores */}
      <div
        className="relative w-12 sm:w-16 shrink-0"
        style={{ height: PLOT_HEIGHT }}
        aria-hidden="true"
      >
        {gridValues.map((value, i) => (
          <span
            key={i}
            className="absolute right-0 -translate-y-1/2 text-[10px] font-medium tnum text-text-secondary whitespace-nowrap"
            style={{ top: `${(i / GRID_STEPS) * 100}%` }}
          >
            {formatCurrencyCompact(value)}
          </span>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <div className="relative" style={{ height: PLOT_HEIGHT }}>
          {/* Linhas de grade: a base é sólida, as intermediárias são tracejadas
              para ficarem atrás das barras sem competir com elas. */}
          {gridValues.map((_, i) => {
            const isBaseline = i === GRID_STEPS;
            return (
              <div
                key={i}
                // `border-strong` fica invisível sobre a superfície escura
                // (1,2:1). As linhas partem do cinza de texto desabilitado, que
                // é o tom mais claro do tema ainda lido como estrutura.
                className={`absolute inset-x-0 border-t ${
                  isBaseline
                    ? "border-text-disabled"
                    : "border-text-disabled/70 border-dashed"
                }`}
                style={{ top: `${(i / GRID_STEPS) * 100}%` }}
                aria-hidden="true"
              />
            );
          })}

          {/* Barras. Cada mês é um único alvo — de hover, de foco e de balão —
              em vez de duas barras acendendo balões concorrentes. */}
          <div className="absolute inset-0 flex items-end justify-around">
            {data.map((item, index) => {
              const bars = [
                {
                  key: "income" as const,
                  value: item.income,
                  color: item.isCurrent
                    ? "bg-income"
                    : "bg-income/45 group-hover:bg-income/75 group-focus-within:bg-income/75",
                },
                {
                  key: "expense" as const,
                  value: item.expense,
                  color: item.isCurrent
                    ? "bg-expense"
                    : "bg-expense/45 group-hover:bg-expense/75 group-focus-within:bg-expense/75",
                },
              ];

              // Nas pontas o balão encosta na borda do plot em vez de centralizar,
              // que o empurraria para fora da área visível.
              const align =
                index === 0 ? "start" : index === data.length - 1 ? "end" : "center";

              return (
                <div
                  key={item.label}
                  tabIndex={0}
                  role="img"
                  aria-label={describeMonth(item)}
                  className="group relative flex items-end justify-center gap-1.5 h-full px-2 rounded-tile focus-ring"
                >
                  <MonthTooltip datum={item} align={align} />

                  {bars.map((bar) => {
                    const ratio = axisMax > 0 ? bar.value / axisMax : 0;
                    // Barras zeradas viram um traço de 2px sobre a linha de
                    // base: comunica "sem movimento" sem fingir um valor.
                    const height = bar.value > 0 ? Math.max(4, ratio * PLOT_HEIGHT) : 2;

                    return (
                      <div
                        key={bar.key}
                        className={`w-6 md:w-7 rounded-t-tile transition-[height,background-color] duration-500 ease-out ${bar.color}`}
                        style={{ height }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Rótulos dos meses */}
        <div className="flex justify-around pt-2.5">
          {data.map((item) => {
            const hasData = item.income > 0 || item.expense > 0;
            return (
              <div key={item.label} className="px-2 text-center">
                <span
                  className={`text-xs ${
                    item.isCurrent
                      ? "font-bold text-text-primary"
                      : "font-medium text-text-secondary"
                  }`}
                >
                  {item.label}
                </span>
                {!hasData && (
                  <span className="block text-[10px] text-text-secondary">sem dados</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
