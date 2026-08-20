import { randomUUID } from "node:crypto";
import { Prisma, SuggestionSource, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  buildHistoryIndex,
  detectTransferPairs,
  suggestCategory,
  TRANSFER_WINDOW_DAYS,
  type TransferCandidate,
} from "../../lib/categorization";
import { ensureSystemCategories, uncategorizedKeyFor } from "../../lib/systemCategories";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProcessResult {
  /** Transações que entraram em "Transferência entre contas" (as duas pontas). */
  transfers: number;
  /** Transações que ganharam sugestão pendente. */
  suggested: number;
  /** Transações que ficaram na oculta sem palpite nenhum. */
  withoutGuess: number;
}

/**
 * O que acontece com uma transação recém-importada.
 *
 * A ordem importa: transferência interna é decidida ANTES de qualquer palpite,
 * porque uma transferência não é um gasto e não deve consumir a atenção do
 * usuário na fila de revisão. O que sobra vai para a oculta correspondente ao
 * tipo — nenhuma transação sai daqui sem categoria — e só então recebe (ou não)
 * uma sugestão pendente.
 */
export async function processNewTransactions(
  userId: string,
  transactionIds: string[]
): Promise<ProcessResult> {
  if (transactionIds.length === 0) {
    return { transfers: 0, suggested: 0, withoutGuess: 0 };
  }

  const systemIds = await ensureSystemCategories(prisma, userId);
  const systemIdSet = new Set(Object.values(systemIds));

  const novas = await prisma.transaction.findMany({
    where: { id: { in: transactionIds }, userId },
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      date: true,
      description: true,
      categoryId: true,
      transferPairId: true,
      account: { select: { type: true } },
    },
  });

  if (novas.length === 0) {
    return { transfers: 0, suggested: 0, withoutGuess: 0 };
  }

  // 1. Universo do pareamento: a outra ponta pode ter entrado num sync
  //    anterior, então a janela de datas manda, não o lote.
  const datas = novas.map((t) => t.date.getTime());
  const universo = await prisma.transaction.findMany({
    where: {
      userId,
      date: {
        gte: new Date(Math.min(...datas) - TRANSFER_WINDOW_DAYS * DAY_MS),
        lte: new Date(Math.max(...datas) + TRANSFER_WINDOW_DAYS * DAY_MS),
      },
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      date: true,
      transferPairId: true,
      account: { select: { type: true } },
    },
  });

  const toCandidate = (row: {
    id: string;
    accountId: string;
    amount: Prisma.Decimal;
    type: "INCOME" | "EXPENSE";
    date: Date;
    transferPairId: string | null;
    account: { type: "CHECKING" | "SAVINGS" | "CREDIT" | "INVESTMENT" };
  }): TransferCandidate => ({
    id: row.id,
    accountId: row.accountId,
    accountType: row.account.type,
    amount: Number(row.amount),
    type: row.type,
    date: row.date,
    transferPairId: row.transferPairId,
  });

  const pares = detectTransferPairs(
    novas.map(toCandidate),
    universo.map(toCandidate)
  );

  const emTransferencia = new Set<string>();
  for (const par of pares) {
    const pairId = randomUUID();
    await prisma.transaction.updateMany({
      where: { id: { in: [par.aId, par.bId] }, userId },
      data: { categoryId: systemIds[SystemCategoryKey.TRANSFER], transferPairId: pairId },
    });
    emTransferencia.add(par.aId);
    emTransferencia.add(par.bId);
  }

  // 2. O resto cai na oculta do próprio tipo — mas só o que ainda não tem
  //    categoria nenhuma. O pipeline preenche vazio; ele não desfaz decisão.
  //    Sem esse filtro, chamá-lo duas vezes sobre os mesmos ids arrancaria as
  //    transferências recém-pareadas de volta para "Sem categoria".
  const semDecisao = novas.filter(
    (t) => !emTransferencia.has(t.id) && t.categoryId === null
  );

  for (const key of [
    SystemCategoryKey.UNCATEGORIZED_EXPENSE,
    SystemCategoryKey.UNCATEGORIZED_INCOME,
  ] as const) {
    const ids = semDecisao.filter((t) => uncategorizedKeyFor(t.type) === key).map((t) => t.id);
    if (ids.length === 0) continue;
    await prisma.transaction.updateMany({
      where: { id: { in: ids }, userId },
      data: { categoryId: systemIds[key] },
    });
  }

  // 3. Índice de histórico, construído uma vez para o lote inteiro.
  const selecionaveis = await prisma.category.findMany({
    where: { userId, systemKey: null },
    select: { id: true, name: true },
  });

  const historico = await prisma.transaction.findMany({
    where: {
      userId,
      categoryId: { notIn: Array.from(systemIdSet) },
      id: { notIn: novas.map((t) => t.id) },
    },
    select: { description: true, categoryId: true },
  });

  const ctx = {
    history: buildHistoryIndex(
      historico.filter(
        (t): t is { description: string; categoryId: string } => t.categoryId !== null
      )
    ),
    categories: selecionaveis,
  };

  // 4. Sugestões. `skipDuplicates` cobre a transação que já foi julgada num
  //    sync anterior: uma sugestão por transação, e pular é definitivo.
  const sugestoes = semDecisao
    .map((tx) => {
      const palpite = suggestCategory({ description: tx.description }, ctx);
      if (!palpite) return null;
      return {
        userId,
        transactionId: tx.id,
        categoryId: palpite.categoryId,
        source: palpite.source as SuggestionSource,
        confidence: palpite.confidence,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  let suggested = 0;
  if (sugestoes.length > 0) {
    const result = await prisma.categorySuggestion.createMany({
      data: sugestoes,
      skipDuplicates: true,
    });
    suggested = result.count;
  }

  return {
    transfers: emTransferencia.size,
    suggested,
    withoutGuess: semDecisao.length - suggested,
  };
}
