import { Prisma, SuggestionSource, SuggestionStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import type { SuggestionsResponse, TransactionDTO } from "@poup/shared";
import { CategoryNotFoundError, SystemCategoryError } from "../../lib/errors";
import { reevaluatePendingSuggestions } from "./categorization.service";

const TX_INCLUDE = {
  account: { select: { name: true } },
  category: { select: { name: true } },
} as const;

export async function countPendingSuggestions(userId: string): Promise<number> {
  return prisma.categorySuggestion.count({
    where: { userId, status: SuggestionStatus.PENDING },
  });
}

export async function listPendingSuggestions(userId: string): Promise<SuggestionsResponse> {
  const rows = await prisma.categorySuggestion.findMany({
    where: { userId, status: SuggestionStatus.PENDING },
    // A tela agrupa por categoria sugerida, então esta ordem decide o de dentro
    // de cada grupo: mais recente primeiro, que é o que a pessoa lembra de ter
    // gastado. Confiança na frente mantém as sem palpite (confidence 0) no fim
    // da lista crua, para quem consumir a API sem agrupar.
    orderBy: [{ confidence: "desc" }, { transaction: { date: "desc" } }],
    include: {
      category: { select: { name: true } },
      transaction: { include: TX_INCLUDE },
    },
  });

  const suggestions = rows.map((row) => ({
    id: row.id,
    transaction: {
      id: row.transaction.id,
      description: row.transaction.description,
      amount: Number(row.transaction.amount),
      type: row.transaction.type,
      date: row.transaction.date.toISOString(),
      note: row.transaction.note,
      isRecurring: row.transaction.isRecurring,
      accountId: row.transaction.accountId,
      accountName: row.transaction.account.name,
      categoryId: row.transaction.categoryId,
      categoryName: row.transaction.category?.name ?? null,
    } as TransactionDTO,
    suggestedCategoryId: row.categoryId,
    suggestedCategoryName: row.category?.name ?? null,
    source: row.source,
    confidence: row.confidence,
  }));

  return { suggestions, count: suggestions.length };
}

export interface ApplySuggestionsInput {
  /** A categoria da página — a mesma para o lote inteiro. */
  categoryId: string;
  /** Sugestões que ficaram marcadas: a transação recebe a categoria. */
  acceptIds: string[];
  /** Sugestões desmarcadas: o palpite foi recusado à mão. */
  rejectIds: string[];
}

/**
 * O que uma página da revisão faz ao ser confirmada.
 *
 * O marcado vira categoria aplicada; o desmarcado vira palpite recusado — a
 * transação continua pendente, mas sem palpite, e reaparece na última página
 * ("Sem categoria definida"), onde a escolha é manual. Não usamos `DISMISSED`
 * aqui: desmarcar diz "não é esta categoria", não "esqueça esta transação".
 *
 * A diferença entre `ACCEPTED` e `CHANGED` continua sendo o único sinal sobre a
 * qualidade do palpite — e só vale filtrando `source != NONE`, porque item sem
 * palpite sempre sai como `CHANGED` e contá-lo culparia o motor por uma
 * resposta que ele nunca deu.
 *
 * No fim, a reavaliação: o lote que acabou de ser aplicado é histórico novo, e
 * o que sobrou na fila merece um palpite calculado com ele.
 */
export async function applySuggestions(
  userId: string,
  { categoryId, acceptIds, rejectIds }: ApplySuggestionsInput
): Promise<SuggestionsResponse & { applied: number }> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new CategoryNotFoundError();
  if (category.systemKey) throw new SystemCategoryError();

  const marcadas = new Set(acceptIds);
  // Escopo por `userId` e `PENDING`: id de outra pessoa, ou já resolvido em
  // outra aba, simplesmente não entra no lote.
  const rows = await prisma.categorySuggestion.findMany({
    where: {
      id: { in: [...new Set([...acceptIds, ...rejectIds])] },
      userId,
      status: SuggestionStatus.PENDING,
    },
    select: { id: true, transactionId: true, categoryId: true },
  });

  const aceitas = rows.filter((row) => marcadas.has(row.id));
  const recusadas = rows.filter((row) => !marcadas.has(row.id));
  const resolvedAt = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  if (aceitas.length > 0) {
    ops.push(
      prisma.transaction.updateMany({
        where: { id: { in: aceitas.map((row) => row.transactionId) }, userId },
        data: { categoryId, transferPairId: null },
      })
    );

    for (const [status, ids] of [
      [SuggestionStatus.ACCEPTED, aceitas.filter((r) => r.categoryId === categoryId)],
      [SuggestionStatus.CHANGED, aceitas.filter((r) => r.categoryId !== categoryId)],
    ] as const) {
      if (ids.length === 0) continue;
      ops.push(
        prisma.categorySuggestion.updateMany({
          where: { id: { in: ids.map((row) => row.id) } },
          data: { status, resolvedCategoryId: categoryId, resolvedAt },
        })
      );
    }
  }

  if (recusadas.length > 0) {
    ops.push(
      prisma.categorySuggestion.updateMany({
        where: { id: { in: recusadas.map((row) => row.id) } },
        data: {
          categoryId: null,
          source: SuggestionSource.NONE,
          confidence: 0,
          guessRejected: true,
        },
      })
    );
  }

  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }

  await reevaluatePendingSuggestions(userId);

  return { applied: aceitas.length, ...(await listPendingSuggestions(userId)) };
}

/**
 * Tira transações da fila sem categorizá-las — a saída para o que a pessoa não
 * quer decidir. Elas continuam nas categorias "Sem categoria", e some só a
 * cobrança: contador, notificação e revisão.
 */
export async function dismissSuggestions(
  userId: string,
  ids: string[]
): Promise<SuggestionsResponse & { dismissed: number }> {
  const { count } = await prisma.categorySuggestion.updateMany({
    where: { id: { in: ids }, userId, status: SuggestionStatus.PENDING },
    data: { status: SuggestionStatus.DISMISSED, resolvedAt: new Date() },
  });

  return { dismissed: count, ...(await listPendingSuggestions(userId)) };
}
