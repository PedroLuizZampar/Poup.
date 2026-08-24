import { CategoryKind, Prisma, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import { ensureSystemCategories } from "../../lib/systemCategories";
import type {
  ReportCategoryTotalDTO,
  ReportKindTotalDTO,
  ReportMonthTotalDTO,
  ReportPeriod,
  ReportSummaryDTO,
} from "@poup/shared";

/**
 * Totais somados no banco.
 *
 * O app fazia isto no navegador: baixava o histórico inteiro de transações e
 * reduzia em JavaScript. Duas consequências — o volume de dados cresce sem
 * teto, e a soma acontece em ponto flutuante, que é onde nasce o "o total não
 * bate com a soma". Aqui a soma é `numeric` no Postgres, exata, e o que trafega
 * é o resultado.
 */

interface ResolvedPeriod {
  /** Início inclusivo. Null significa "desde sempre". */
  start: Date | null;
  /** Fim exclusivo. Null significa "até agora". */
  end: Date | null;
}

function startOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

function parseMonth(monthStr: string): { year: number; month: number } | null {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) return null;
  const [year, month] = monthStr.split("-").map((n) => parseInt(n, 10));
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) return null;
  return { year, month: month - 1 };
}

/** "2026-08" a partir de uma data, sempre em UTC (como as datas são gravadas). */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function resolvePeriod(options: {
  month?: string;
  period?: ReportPeriod;
}): ResolvedPeriod {
  if (options.month) {
    const parsed = parseMonth(options.month);
    if (parsed) {
      return {
        start: startOfMonthUTC(parsed.year, parsed.month),
        end: startOfMonthUTC(parsed.year, parsed.month + 1),
      };
    }
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  switch (options.period) {
    case "all":
      return { start: null, end: null };
    case "3m":
      return { start: startOfMonthUTC(year, month - 2), end: startOfMonthUTC(year, month + 1) };
    case "6m":
      return { start: startOfMonthUTC(year, month - 5), end: startOfMonthUTC(year, month + 1) };
    case "year":
      return { start: startOfMonthUTC(year, 0), end: startOfMonthUTC(year + 1, 0) };
    case "current":
    default:
      return { start: startOfMonthUTC(year, month), end: startOfMonthUTC(year, month + 1) };
  }
}

/**
 * A janela do periodo, sobre a competencia.
 *
 * Competencia e nao `date` porque uma compra em 10x tem as dez parcelas com a
 * data da compra: somar por `date` colocaria os R$ 300 inteiros no mes em que se
 * comprou, em vez de R$ 30 em cada uma das dez faturas.
 */
function dateFilter(period: ResolvedPeriod): Prisma.TransactionWhereInput {
  if (!period.start && !period.end) return {};
  return {
    competenceDate: {
      ...(period.start ? { gte: period.start } : {}),
      ...(period.end ? { lt: period.end } : {}),
    },
  };
}

/** Arredonda para centavos só na saída — a soma já veio exata do banco. */
function toCents(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(Number(value).toFixed(2));
}

/**
 * Transferência entre contas e pagamento de fatura não são gasto nem receita: no
 * primeiro o dinheiro só mudou de bolso; no segundo a despesa já foi contada na
 * compra que gerou a fatura. Contar qualquer um dos dois infla os dois lados do
 * mesmo mês e estraga a taxa de poupança.
 *
 * São duas categorias distintas porque a pessoa precisa distinguir uma da outra
 * na lista — mas, para todo total, valem a mesma coisa: ficam de fora.
 */
async function totalsByType(userId: string, period: ResolvedPeriod, ocultas: string[]) {
  const grouped = await prisma.transaction.groupBy({
    by: ["type"],
    where: {
      userId,
      NOT: { categoryId: { in: ocultas } },
      // Compra compensada por um estorno nao foi gasta, e o credito que a
      // cancelou nao foi ganho: as duas pontas saem dos totais.
      compensationId: null,
      ...dateFilter(period),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  let income = 0;
  let expense = 0;
  let transactionCount = 0;
  let expenseCount = 0;

  for (const row of grouped) {
    const total = toCents(row._sum.amount);
    transactionCount += row._count._all;
    if (row.type === "INCOME") {
      income = total;
    } else {
      expense = total;
      expenseCount = row._count._all;
    }
  }

  return { income, expense, transactionCount, expenseCount };
}

async function expensesByCategory(
  userId: string,
  period: ResolvedPeriod,
  totalExpense: number,
  ocultas: string[]
): Promise<ReportCategoryTotalDTO[]> {
  const grouped = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      userId,
      type: "EXPENSE",
      NOT: { categoryId: { in: ocultas } },
      compensationId: null,
      ...dateFilter(period),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  if (grouped.length === 0) return [];

  const categoryIds = grouped
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);

  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds }, userId },
    select: { id: true, name: true, icon: true, colorKey: true, kind: true },
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return grouped
    .map((row) => {
      const category = row.categoryId ? categoryById.get(row.categoryId) : undefined;
      const amount = toCents(row._sum.amount);
      return {
        categoryId: row.categoryId,
        categoryName: category?.name ?? "Sem categoria",
        categoryIcon: category?.icon ?? null,
        categoryColorKey: category?.colorKey ?? null,
        // Despesa sem categoria conhecida entra como variável: é o que ela é
        // até que alguém diga o contrário, e some do grupo distorceria o total.
        categoryKind: category?.kind ?? CategoryKind.VARIABLE,
        amount,
        percentage: totalExpense > 0 ? Number(((amount / totalExpense) * 100).toFixed(1)) : 0,
        transactionCount: row._count._all,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

/**
 * As mesmas despesas de `byCategory`, separadas em fixas e variáveis.
 *
 * O corte sai da categoria, não da transação: a divisão é uma propriedade do
 * tipo de gasto ("aluguel é fixo"), e derivá-la aqui — em vez de gravá-la em
 * cada linha — significa que reclassificar uma categoria corrige o histórico
 * inteiro de uma vez, sem varrer transação por transação.
 */
function splitByKind(
  rows: ReportCategoryTotalDTO[],
  totalExpense: number
): { fixed: ReportKindTotalDTO; variable: ReportKindTotalDTO } {
  function group(kind: CategoryKind): ReportKindTotalDTO {
    const categories = rows.filter((row) => row.categoryKind === kind);
    const amount = toCents(categories.reduce((sum, row) => sum + row.amount, 0));

    return {
      kind,
      amount,
      // Recalculada do total, e não somada das fatias: somar percentuais já
      // arredondados a uma casa faz "fixas + variáveis" fechar em 99,9%.
      percentage: totalExpense > 0 ? Number(((amount / totalExpense) * 100).toFixed(1)) : 0,
      transactionCount: categories.reduce((sum, row) => sum + row.transactionCount, 0),
      categories,
    };
  }

  return { fixed: group(CategoryKind.FIXED), variable: group(CategoryKind.VARIABLE) };
}

interface MonthlyRow {
  month: string;
  type: "INCOME" | "EXPENSE";
  total: Prisma.Decimal;
}

/**
 * Série mensal de entradas e saídas.
 *
 * É SQL cru porque o `groupBy` do Prisma não agrupa por mês de uma coluna de
 * data — a alternativa seria uma consulta por mês, e o gráfico do painel pede
 * três de uma vez.
 */
async function monthlySeries(
  userId: string,
  months: string[],
  ocultas: string[]
): Promise<ReportMonthTotalDTO[]> {
  if (months.length === 0) return [];

  const first = parseMonth(months[0])!;
  const last = parseMonth(months[months.length - 1])!;
  const start = startOfMonthUTC(first.year, first.month);
  const end = startOfMonthUTC(last.year, last.month + 1);

  const rows = await prisma.$queryRaw<MonthlyRow[]>`
    SELECT to_char(date_trunc('month', "competenceDate" AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
           "type"::text AS type,
           SUM("amount") AS total
    FROM "Transaction"
    WHERE "userId" = ${userId}
      AND "competenceDate" >= ${start}
      AND "competenceDate" < ${end}
      AND ("categoryId" IS NULL OR "categoryId" NOT IN (${Prisma.join(ocultas)}))
      AND "compensationId" IS NULL
    GROUP BY 1, 2
  `;

  const byMonth = new Map<string, ReportMonthTotalDTO>(
    months.map((month) => [month, { month, income: 0, expense: 0 }])
  );

  for (const row of rows) {
    const entry = byMonth.get(row.month);
    if (!entry) continue;
    if (row.type === "INCOME") {
      entry.income = toCents(row.total);
    } else {
      entry.expense = toCents(row.total);
    }
  }

  return months.map((month) => byMonth.get(month)!);
}

/** Os `count` meses terminando no mês de `end` (ou no mês corrente). */
function monthsEndingAt(end: Date | null, count: number): string[] {
  const reference = end ? new Date(end.getTime() - 1) : new Date();
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();

  const result: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    result.push(monthKey(startOfMonthUTC(year, month - offset)));
  }
  return result;
}

export interface ReportSummaryOptions {
  month?: string;
  period?: ReportPeriod;
  /** Tamanho da série mensal. Sem isto, a série cobre o próprio período. */
  history?: number;
}

export async function getReportSummary(
  userId: string,
  options: ReportSummaryOptions = {}
): Promise<ReportSummaryDTO> {
  const period = resolvePeriod(options);
  const systemIds = await ensureSystemCategories(prisma, userId);
  // As duas ocultas que não somam em lugar nenhum. "Sem categoria" fica de
  // fora desta lista de propósito: aquilo é despesa de verdade esperando um
  // nome, e some do total no dia em que sumir do relatório também.
  const ocultas = [
    systemIds[SystemCategoryKey.TRANSFER],
    systemIds[SystemCategoryKey.BILL_PAYMENT],
  ];

  const [totals, uncategorizedCount] = await Promise.all([
    totalsByType(userId, period, ocultas),
    // "Sem categoria" deixou de ser ausência e virou lugar: a oculta.
    prisma.transaction.count({
      where: {
        userId,
        categoryId: systemIds[SystemCategoryKey.UNCATEGORIZED],
        ...dateFilter(period),
      },
    }),
  ]);

  const [byCategory, monthly] = await Promise.all([
    expensesByCategory(userId, period, totals.expense, ocultas),
    monthlySeries(userId, resolveSeriesMonths(period, options.history), ocultas),
  ]);

  const balance = Number((totals.income - totals.expense).toFixed(2));

  return {
    start: period.start?.toISOString() ?? null,
    end: period.end?.toISOString() ?? null,
    income: totals.income,
    expense: totals.expense,
    balance,
    savingsRate:
      totals.income > 0 ? Number(((balance / totals.income) * 100).toFixed(1)) : 0,
    transactionCount: totals.transactionCount,
    expenseCount: totals.expenseCount,
    uncategorizedCount,
    byCategory,
    byKind: splitByKind(byCategory, totals.expense),
    monthly,
  };
}

/**
 * Meses da série. Com `history`, são os N últimos meses do período — é o que o
 * painel pede para desenhar "os três últimos meses". Sem `history`, a série
 * cobre o período inteiro, limitada a 24 meses para que "todo o período" não
 * vire uma consulta sem teto.
 */
function resolveSeriesMonths(period: ResolvedPeriod, history?: number): string[] {
  if (history && history > 0) {
    return monthsEndingAt(period.end, Math.min(history, 24));
  }

  if (!period.start || !period.end) {
    return monthsEndingAt(null, 12);
  }

  const months: string[] = [];
  const cursor = new Date(period.start.getTime());
  while (cursor < period.end && months.length < 24) {
    months.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
