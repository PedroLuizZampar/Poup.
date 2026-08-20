/**
 * Utilitários de manipulação e formatação de datas e meses (pt-BR)
 * Garante consistência evitando misturar leituras locais com métodos UTC.
 */

export function getCurrentMonthStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getOffsetMonthStr(monthStr: string, offset: number): string {
  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;

  const targetDate = new Date(year, month + offset, 1);
  const nextYear = targetDate.getFullYear();
  const nextMonth = String(targetDate.getMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

/**
 * O pt-BR devolve meses em caixa baixa ("agosto de 2026"). Nos títulos e rótulos
 * do app o mês abre a frase, então capitalizamos a inicial aqui em vez de
 * espalhar `capitalize` pelo CSS — assim o texto copiado também sai certo.
 */
function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

/** "2026-08" -> "Agosto de 2026" */
export function formatMonthFull(monthStr: string): string {
  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;

  const date = new Date(year, month, 1);
  return capitalizeFirst(
    date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
  );
}

/** "2026-08" -> "Agosto" */
export function formatMonthName(monthStr: string): string {
  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;

  const date = new Date(year, month, 1);
  return capitalizeFirst(date.toLocaleDateString("pt-BR", { month: "long" }));
}

/** "2026-08" -> "Ago" */
export function formatMonthShort(monthStr: string): string {
  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;

  const date = new Date(year, month, 1);
  const short = date.toLocaleDateString("pt-BR", { month: "short" });
  return capitalizeFirst(short.replace(".", "").toLowerCase());
}
