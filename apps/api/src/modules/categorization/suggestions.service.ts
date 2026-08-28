import { Prisma, SuggestionSource, SuggestionStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import type { SuggestionsResponse } from "@poup/shared";
import { CategoryNotFoundError, SystemCategoryError } from "../../lib/errors";
import type { Scope } from "../../lib/scope";
import { reevaluatePendingSuggestions } from "./categorization.service";
import { TX_INCLUDE, formatTransactionDTO } from "../transactions/transactions.service";

/**
 * A fila de revisão é uma só para o espaço: a categoria que sai dela vale para
 * os dois, e deixar cada um com a própria fila faria a mesma decisão ser pedida
 * duas vezes. Quem sincronizou continua sendo o dono da linha — é o que a
 * dissolução do espaço lê —, mas quem responde é qualquer membro.
 */
export async function countPendingSuggestions(scope: Scope): Promise<number> {
  return prisma.categorySuggestion.count({
    where: { userId: { in: scope.memberIds }, status: SuggestionStatus.PENDING },
  });
}

export async function listPendingSuggestions(scope: Scope): Promise<SuggestionsResponse> {
  const rows = await prisma.categorySuggestion.findMany({
    where: { userId: { in: scope.memberIds }, status: SuggestionStatus.PENDING },
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
    transaction: formatTransactionDTO(row.transaction),
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
  scope: Scope,
  { categoryId, acceptIds, rejectIds }: ApplySuggestionsInput
): Promise<SuggestionsResponse & { applied: number }> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, householdId: scope.householdId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.systemKey) throw new SystemCategoryError();

  const marcadas = new Set(acceptIds);
  // Escopo pelos membros e `PENDING`: id de fora do espaço, ou já resolvido em
  // outra aba, simplesmente não entra no lote.
  const rows = await prisma.categorySuggestion.findMany({
    where: {
      id: { in: [...new Set([...acceptIds, ...rejectIds])] },
      userId: { in: scope.memberIds },
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
        where: {
          id: { in: aceitas.map((row) => row.transactionId) },
          userId: { in: scope.memberIds },
        },
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

  await reevaluatePendingSuggestions(scope);

  return { applied: aceitas.length, ...(await listPendingSuggestions(scope)) };
}

/**
 * Tira transações da fila sem categorizá-las — a saída para o que a pessoa não
 * quer decidir. Elas continuam nas categorias "Sem categoria", e some só a
 * cobrança: contador, notificação e revisão.
 */
export async function dismissSuggestions(
  scope: Scope,
  ids: string[]
): Promise<SuggestionsResponse & { dismissed: number }> {
  const { count } = await prisma.categorySuggestion.updateMany({
    where: {
      id: { in: ids },
      userId: { in: scope.memberIds },
      status: SuggestionStatus.PENDING,
    },
    data: { status: SuggestionStatus.DISMISSED, resolvedAt: new Date() },
  });

  return { dismissed: count, ...(await listPendingSuggestions(scope)) };
}
