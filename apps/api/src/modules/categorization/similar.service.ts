import { SuggestionStatus, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import type { SimilarTransactionDTO } from "@poup/shared";
import { SIMILARITY_THRESHOLD, similarityScore } from "../../lib/categorization";
import {
  CategoryNotFoundError,
  SystemCategoryError,
  TransactionNotFoundError,
} from "../../lib/errors";
import { ensureSystemCategories } from "../../lib/systemCategories";
import { reevaluatePendingSuggestions } from "./categorization.service";

/**
 * Tetos deliberados: este é o único caminho que compara par a par em vez de
 * consultar por chave, então sem limite ele degrada junto com o tamanho do
 * histórico. Vinte e quatro meses cobrem qualquer padrão de gasto recorrente.
 */
const HISTORY_MONTHS = 24;
const MAX_CANDIDATES = 500;
const MAX_PER_SECTION = 50;

export async function findSimilarTransactions(
  userId: string,
  transactionId: string,
  categoryId: string
): Promise<{
  uncategorized: SimilarTransactionDTO[];
  differentCategory: SimilarTransactionDTO[];
}> {
  const base = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, description: true },
  });
  if (!base) throw new TransactionNotFoundError();

  const systemIds = await ensureSystemCategories(prisma, userId);
  const semCategoria = [systemIds[SystemCategoryKey.UNCATEGORIZED]];

  const desde = new Date();
  desde.setMonth(desde.getMonth() - HISTORY_MONTHS);

  const candidatas = await prisma.transaction.findMany({
    where: {
      userId,
      id: { not: base.id },
      date: { gte: desde },
      // Transferência interna não entra: ela já está resolvida, e oferecê-la
      // aqui convidaria a desfazer o pareamento sem querer.
      categoryId: { not: systemIds[SystemCategoryKey.TRANSFER] },
    },
    orderBy: { date: "desc" },
    take: MAX_CANDIDATES,
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  const uncategorized: SimilarTransactionDTO[] = [];
  const differentCategory: SimilarTransactionDTO[] = [];

  for (const tx of candidatas) {
    const score = similarityScore(base.description, tx.description);
    if (score < SIMILARITY_THRESHOLD) continue;
    if (tx.categoryId === categoryId) continue;

    const dto: SimilarTransactionDTO = {
      id: tx.id,
      description: tx.description,
      amount: Number(tx.amount),
      type: tx.type,
      date: tx.date.toISOString(),
      note: tx.note,
      isRecurring: tx.isRecurring,
      accountId: tx.accountId,
      accountName: tx.account.name,
      categoryId: tx.categoryId,
      categoryName: tx.category?.name ?? null,
      score,
    };

    if (tx.categoryId && semCategoria.includes(tx.categoryId)) {
      uncategorized.push(dto);
    } else {
      differentCategory.push({ ...dto, currentCategoryName: tx.category?.name ?? null });
    }
  }

  const porScore = (a: SimilarTransactionDTO, b: SimilarTransactionDTO) => b.score - a.score;

  return {
    uncategorized: uncategorized.sort(porScore).slice(0, MAX_PER_SECTION),
    differentCategory: differentCategory.sort(porScore).slice(0, MAX_PER_SECTION),
  };
}

export async function bulkCategorize(
  userId: string,
  transactionIds: string[],
  categoryId: string
): Promise<{ updated: number }> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new CategoryNotFoundError();
  if (category.systemKey) throw new SystemCategoryError();

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.transaction.updateMany({
      where: { id: { in: transactionIds }, userId },
      data: { categoryId, transferPairId: null },
    });

    // Uma transação que acabou de receber categoria não pode continuar na fila
    // pedindo a mesma decisão.
    await tx.categorySuggestion.updateMany({
      where: {
        userId,
        transactionId: { in: transactionIds },
        status: SuggestionStatus.PENDING,
      },
      data: {
        status: SuggestionStatus.CHANGED,
        resolvedCategoryId: categoryId,
        resolvedAt: new Date(),
      },
    });

    return updated.count;
  });

  // O lote que acabou de ser aplicado é histórico novo: o que continua na fila
  // merece um palpite calculado com ele. É o mesmo passo que a revisão dá a
  // cada página confirmada — aplicar em parecidas ensina tanto quanto.
  await reevaluatePendingSuggestions(userId);

  return { updated: result };
}
