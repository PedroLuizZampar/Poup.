/**
 * Utilitários centralizados de formatação para pt-BR
 */

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(amount: number, options?: { showSign?: boolean }): string {
  const formatted = currencyFormatter.format(Math.abs(amount));
  if (options?.showSign) {
    if (amount > 0) return `+ ${formatted}`;
    if (amount < 0) return `- ${formatted}`;
  }
  return amount < 0 ? `- ${formatted}` : formatted;
}

export function formatDate(dateVal: string | Date): string {
  if (!dateVal) return "";
  const date = typeof dateVal === "string" ? new Date(dateVal) : dateVal;
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR");
}

export function formatDateTime(dateVal: string | Date): string {
  if (!dateVal) return "";
  const date = typeof dateVal === "string" ? new Date(dateVal) : dateVal;
  if (isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("pt-BR")} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatPercent(value: number, decimals: number = 0): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

export function formatRelative(dateVal: string | Date): string {
  if (!dateVal) return "";
  const date = typeof dateVal === "string" ? new Date(dateVal) : dateVal;
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "agora";
  if (diffMins < 60) return `há ${diffMins} min`;
  if (diffHours < 24) return `há ${diffHours} h`;
  if (diffDays === 1) return "ontem";
  if (diffDays < 7) return `há ${diffDays} d`;
  return formatDate(date);
}

/**
 * Valor curto para eixos de gráfico, onde não cabe "R$ 1.284.930,55".
 * "R$ 1,3 mi" / "R$ 284 mil" / "R$ 930".
 */
export function formatCurrencyCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    return `${sign}R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })} mi`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    return `${sign}R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })} mil`;
  }
  return `${sign}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/**
 * Escala tipográfica de um valor monetário em função do seu comprimento.
 *
 * Números de saldo não cabem numa medida fixa: "R$ 0,34" e "R$ 1.284.930,55"
 * têm larguras muito diferentes, e um `whitespace-nowrap` num tamanho fixo
 * estoura a coluna. Em vez de deixar o texto quebrar no meio do número — o que
 * torna o valor ilegível — descemos um degrau da escala por faixa de tamanho.
 *
 * `hero` é o saldo principal do painel; `metric` são as métricas de apoio.
 */
export function amountSizeClass(
  formatted: string,
  scale: "hero" | "metric" = "metric"
): string {
  const len = formatted.length;

  if (scale === "hero") {
    if (len <= 13) return "text-[2.25rem] leading-[1.1]"; // até R$ 99.999,99
    if (len <= 16) return "text-[1.875rem] leading-[1.15]"; // até R$ 9.999.999,99
    if (len <= 19) return "text-[1.5rem] leading-[1.2]";
    return "text-[1.25rem] leading-[1.25]";
  }

  if (len <= 13) return "text-[1.25rem] leading-[1.2]"; // até R$ 284.930,55
  if (len <= 16) return "text-[1rem] leading-[1.3]"; // até R$ 39.998.311,23
  if (len <= 19) return "text-[0.875rem] leading-[1.35]"; // até R$ 1.234.567.890,12
  return "text-[0.75rem] leading-[1.4]";
}
