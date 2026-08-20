import { prisma } from "../../prisma";
import { TransactionType as PrismaTransactionType, Prisma } from "@prisma/client";
import type { TransactionDTO, TransactionType } from "@poup/shared";
import {
  AccountNotFoundError,
  CategoryNotFoundError,
  TransactionNotFoundError,
} from "../../lib/errors";

export { AccountNotFoundError, CategoryNotFoundError, TransactionNotFoundError };

export interface TransactionFilters {
  month?: string; // YYYY-MM
  startDate?: string;
  endDate?: string;
  accountId?: string;
  categoryId?: string;
  uncategorized?: boolean;
  type?: TransactionType;
  search?: string;
  /** Teto de resultados, para quem só mostra as últimas (o painel usa 5). */
  limit?: number;
}

export interface CreateTransactionInput {
  accountId: string;
  description: string;
  amount: number;
  type: TransactionType;
  date: string;
  categoryId?: string | null;
  note?: string | null;
  isRecurring?: boolean;
}

export interface UpdateTransactionInput {
  description?: string;
  categoryId?: string | null;
  note?: string | null;
  isRecurring?: boolean;
}

function formatTransactionDTO(tx: {
  id: string;
  description: string;
  amount: Prisma.Decimal;
  type: PrismaTransactionType;
  date: Date;
  note: string | null;
  isRecurring: boolean;
  accountId: string;
  account: { name: string };
  categoryId: string | null;
  category: { name: string } | null;
}): TransactionDTO {
  return {
    id: tx.id,
    description: tx.description,
    amount: Number(tx.amount),
    type: tx.type as TransactionType,
    date: tx.date.toISOString(),
    note: tx.note,
    isRecurring: tx.isRecurring,
    accountId: tx.accountId,
    accountName: tx.account.name,
    categoryId: tx.categoryId,
    categoryName: tx.category?.name ?? null,
  };
}

export async function listTransactions(
  userId: string,
  filters: TransactionFilters = {}
): Promise<TransactionDTO[]> {
  const where: Prisma.TransactionWhereInput = {
    userId,
  };

  if (filters.month) {
    const [yearStr, monthStr] = filters.month.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!isNaN(year) && !isNaN(month)) {
      const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const startOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      where.date = {
        gte: startOfMonth,
        lt: startOfNextMonth,
      };
    }
  } else if (filters.startDate || filters.endDate) {
    where.date = {
      ...(filters.startDate && { gte: new Date(filters.startDate) }),
      ...(filters.endDate && { lte: new Date(filters.endDate) }),
    };
  }

  if (filters.accountId) {
    where.accountId = filters.accountId;
  }

  if (filters.uncategorized) {
    where.categoryId = null;
  } else if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.type) {
    where.type = filters.type as PrismaTransactionType;
  }

  if (filters.search) {
    const term = filters.search.trim();
    if (term.length > 0) {
      where.OR = [
        { description: { contains: term, mode: "insensitive" } },
        { note: { contains: term, mode: "insensitive" } },
      ];
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    ...(filters.limit ? { take: filters.limit } : {}),
  });

  return transactions.map(formatTransactionDTO);
}

export async function getTransactionById(
  userId: string,
  id: string
): Promise<TransactionDTO | null> {
  const tx = await prisma.transaction.findFirst({
    where: { id, userId },
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  if (!tx) return null;
  return formatTransactionDTO(tx);
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput
): Promise<TransactionDTO> {
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId },
  });
  if (!account) {
    throw new AccountNotFoundError();
  }

  if (input.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, userId },
    });
    if (!category) {
      throw new CategoryNotFoundError();
    }
  }

  const created = await prisma.transaction.create({
    data: {
      userId,
      accountId: input.accountId,
      description: input.description.trim(),
      amount: new Prisma.Decimal(input.amount),
      type: input.type as PrismaTransactionType,
      date: new Date(input.date),
      categoryId: input.categoryId ?? null,
      note: input.note?.trim() ?? null,
      isRecurring: input.isRecurring ?? false,
    },
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  return formatTransactionDTO(created);
}

export async function updateTransaction(
  userId: string,
  id: string,
  input: UpdateTransactionInput
): Promise<TransactionDTO> {
  const existing = await prisma.transaction.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new TransactionNotFoundError();
  }

  if (input.categoryId !== undefined && input.categoryId !== null) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, userId },
    });
    if (!category) {
      throw new CategoryNotFoundError();
    }
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
      ...(input.note !== undefined && { note: input.note ? input.note.trim() : null }),
      ...(input.isRecurring !== undefined && { isRecurring: input.isRecurring }),
    },
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  return formatTransactionDTO(updated);
}
