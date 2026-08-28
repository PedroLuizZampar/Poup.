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
import type { Scope } from "../../lib/scope";
import { reevaluatePendingSuggestions } from "./categorization.service";
import { TX_INCLUDE, formatTransactionDTO } from "../transactions/transactions.service";

/**
 * Tetos deliberados: este é o único caminho que compara par a par em vez de
 * consultar por chave, então sem limite ele degrada junto com o tamanho do
 * histórico. Vinte e quatro meses cobrem qualquer padrão de gasto recorrente.
 */
const HISTORY_MONTHS = 24;
const MAX_CANDIDATES = 500;
const MAX_PER_SECTION = 50;

/**
 * As parecidas são as do **espaço**: a lista de transações que a tela mostra já
 * é a dos dois, e oferecer "aplicar a parecidas" sobre um universo menor do que
 * o que está na tela deixaria de fora justamente as linhas que a pessoa acabou
 * de ver ali.
 */
export async function findSimilarTransactions(
  scope: Scope,
  transactionId: string,
  categoryId: string
): Promise<{
  uncategorized: SimilarTransactionDTO[];
  differentCategory: SimilarTransactionDTO[];
}> {
  const base = await prisma.transaction.findFirst({
    where: { id: transactionId, userId: { in: scope.memberIds } },
    select: { id: true, description: true },
  });
  if (!base) throw new TransactionNotFoundError();

  const systemIds = await ensureSystemCategories(prisma, scope.householdId);
  const semCategoria = [systemIds[SystemCategoryKey.UNCATEGORIZED]];

  const desde = new Date();
  desde.setMonth(desde.getMonth() - HISTORY_MONTHS);

  const candidatas = await prisma.transaction.findMany({
    where: {
      userId: { in: scope.memberIds },
      id: { not: base.id },
      date: { gte: desde },
      // Transferência interna e pagamento de fatura não entram: as duas já
      // estão resolvidas e são pareadas, e oferecê-las aqui convidaria a
      // desfazer o pareamento sem querer.
      categoryId: {
        notIn: [systemIds[SystemCategoryKey.TRANSFER], systemIds[SystemCategoryKey.BILL_PAYMENT]],
      },
    },
    orderBy: { date: "desc" },
    take: MAX_CANDIDATES,
    include: TX_INCLUDE,
  });

  const uncategorized: SimilarTransactionDTO[] = [];
  const differentCategory: SimilarTransactionDTO[] = [];

  for (const tx of candidatas) {
    const score = similarityScore(base.description, tx.description);
    if (score < SIMILARITY_THRESHOLD) continue;
    if (tx.categoryId === categoryId) continue;

    const dto: SimilarTransactionDTO = { ...formatTransactionDTO(tx), score };

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

/**
 * Categoriza um lote inteiro de uma vez.
 *
 * O lote é do **espaço**: a lista de transações mostra as dos dois membros, e a
 * seleção da tela mistura as duas naturalmente. Com o filtro por um `userId` só,
 * as linhas do parceiro casavam com zero linhas — a resposta dizia sucesso, o
 * contador vinha menor do que o selecionado e ninguém era avisado de nada.
 */
export async function bulkCategorize(
  scope: Scope,
  transactionIds: string[],
  categoryId: string
): Promise<{ updated: number }> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, householdId: scope.householdId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.systemKey) throw new SystemCategoryError();

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.transaction.updateMany({
      where: { id: { in: transactionIds }, userId: { in: scope.memberIds } },
      data: { categoryId, transferPairId: null },
    });

    // Uma transação que acabou de receber categoria não pode continuar na fila
    // pedindo a mesma decisão.
    await tx.categorySuggestion.updateMany({
      where: {
        userId: { in: scope.memberIds },
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
  await reevaluatePendingSuggestions(scope);

  return { updated: result };
}
