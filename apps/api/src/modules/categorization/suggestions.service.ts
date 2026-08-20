import { SuggestionStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import type { SuggestionDTO, TransactionDTO } from "@poup/shared";
import {
  CategoryNotFoundError,
  SuggestionNotFoundError,
  SystemCategoryError,
} from "../../lib/errors";
import { getTransactionById } from "../transactions/transactions.service";

const TX_INCLUDE = {
  account: { select: { name: true } },
  category: { select: { name: true } },
} as const;

export async function countPendingSuggestions(userId: string): Promise<number> {
  return prisma.categorySuggestion.count({
    where: { userId, status: SuggestionStatus.PENDING },
  });
}

export async function listPendingSuggestions(
  userId: string
): Promise<{ suggestions: SuggestionDTO[]; count: number }> {
  const rows = await prisma.categorySuggestion.findMany({
    where: { userId, status: SuggestionStatus.PENDING },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
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
    suggestedCategoryName: row.category.name,
    source: row.source,
    confidence: row.confidence,
  }));

  return { suggestions, count: suggestions.length };
}

/**
 * Aceitar sem `categoryId` aplica o que foi sugerido; com `categoryId` aplica a
 * escolha do usuário e guarda as duas. A diferença entre `ACCEPTED` e `CHANGED`
 * é o único sinal que existe sobre a qualidade do palpite.
 */
export async function acceptSuggestion(
  userId: string,
  id: string,
  categoryId?: string
): Promise<{ transaction: TransactionDTO; remaining: number }> {
  const suggestion = await prisma.categorySuggestion.findFirst({
    where: { id, userId, status: SuggestionStatus.PENDING },
  });
  if (!suggestion) {
    throw new SuggestionNotFoundError();
  }

  let escolhida = suggestion.categoryId;
  let status: SuggestionStatus = SuggestionStatus.ACCEPTED;

  if (categoryId && categoryId !== suggestion.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) throw new CategoryNotFoundError();
    if (category.systemKey) throw new SystemCategoryError();
    escolhida = categoryId;
    status = SuggestionStatus.CHANGED;
  }

  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: suggestion.transactionId },
      data: { categoryId: escolhida, transferPairId: null },
    }),
    prisma.categorySuggestion.update({
      where: { id },
      data: { status, resolvedCategoryId: escolhida, resolvedAt: new Date() },
    }),
  ]);

  const transaction = await getTransactionById(userId, suggestion.transactionId);
  if (!transaction) throw new SuggestionNotFoundError();

  return { transaction, remaining: await countPendingSuggestions(userId) };
}

export async function dismissSuggestion(
  userId: string,
  id: string
): Promise<{ remaining: number }> {
  const suggestion = await prisma.categorySuggestion.findFirst({
    where: { id, userId, status: SuggestionStatus.PENDING },
  });
  if (!suggestion) {
    throw new SuggestionNotFoundError();
  }

  await prisma.categorySuggestion.update({
    where: { id },
    data: { status: SuggestionStatus.DISMISSED, resolvedAt: new Date() },
  });

  return { remaining: await countPendingSuggestions(userId) };
}
