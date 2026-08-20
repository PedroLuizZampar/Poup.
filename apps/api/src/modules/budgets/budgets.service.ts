import { prisma } from "../../prisma";
import { Prisma } from "@prisma/client";
import type { BudgetDTO, BudgetStatus } from "@poup/shared";
import { BudgetNotFoundError, CategoryNotFoundError } from "../../lib/errors";

export { BudgetNotFoundError, CategoryNotFoundError };

function parseMonth(monthStr?: string): [number, number] {
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [y, m] = monthStr.split("-").map((n) => parseInt(n, 10));
    return [y, m];
  }
  const now = new Date();
  return [now.getUTCFullYear(), now.getUTCMonth() + 1];
}

export async function listBudgets(userId: string, monthStr?: string): Promise<BudgetDTO[]> {
  const [year, month] = parseMonth(monthStr);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const startOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const budgets = await prisma.budget.findMany({
    where: { userId },
    include: {
      category: {
        select: { id: true, name: true, icon: true, colorKey: true },
      },
    },
    orderBy: { category: { name: "asc" } },
  });

  const categoryIds = budgets.map((b) => b.categoryId);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      type: "EXPENSE",
      categoryId: { in: categoryIds },
      date: {
        gte: startOfMonth,
        lt: startOfNextMonth,
      },
    },
    select: {
      categoryId: true,
      amount: true,
    },
  });

  const spentMap = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.categoryId) continue;
    const current = spentMap.get(tx.categoryId) ?? 0;
    spentMap.set(tx.categoryId, current + Number(tx.amount));
  }

  return budgets.map((budget) => {
    const spent = Number((spentMap.get(budget.categoryId) ?? 0).toFixed(2));
    const monthlyLimit = Number(budget.monthlyLimit);
    const percentage = monthlyLimit > 0 ? Number(((spent / monthlyLimit) * 100).toFixed(1)) : 0;

    let status: BudgetStatus = "ok";
    if (spent > monthlyLimit) {
      status = "exceeded";
    } else if (spent >= monthlyLimit * 0.8) {
      status = "warning";
    }

    return {
      id: budget.id,
      categoryId: budget.categoryId,
      categoryName: budget.category.name,
      categoryIcon: budget.category.icon,
      categoryColorKey: budget.category.colorKey,
      monthlyLimit,
      spent,
      percentage,
      status,
    };
  });
}

export async function upsertBudget(userId: string, categoryId: string, monthlyLimit: number): Promise<BudgetDTO> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
  });
  if (!category) {
    throw new CategoryNotFoundError();
  }

  const budget = await prisma.budget.upsert({
    where: {
      userId_categoryId: {
        userId,
        categoryId,
      },
    },
    update: {
      monthlyLimit: new Prisma.Decimal(monthlyLimit),
    },
    create: {
      userId,
      categoryId,
      monthlyLimit: new Prisma.Decimal(monthlyLimit),
    },
    include: {
      category: {
        select: { id: true, name: true, icon: true, colorKey: true },
      },
    },
  });

  const [year, month] = parseMonth();
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const startOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const totalSpentAgg = await prisma.transaction.aggregate({
    where: {
      userId,
      categoryId,
      type: "EXPENSE",
      date: { gte: startOfMonth, lt: startOfNextMonth },
    },
    _sum: { amount: true },
  });

  const spent = Number(totalSpentAgg._sum.amount ?? 0);
  const limit = Number(budget.monthlyLimit);
  const percentage = limit > 0 ? Number(((spent / limit) * 100).toFixed(1)) : 0;

  let status: BudgetStatus = "ok";
  if (spent > limit) {
    status = "exceeded";
  } else if (spent >= limit * 0.8) {
    status = "warning";
  }

  return {
    id: budget.id,
    categoryId: budget.categoryId,
    categoryName: budget.category.name,
    categoryIcon: budget.category.icon,
    categoryColorKey: budget.category.colorKey,
    monthlyLimit: limit,
    spent,
    percentage,
    status,
  };
}

export async function deleteBudget(userId: string, id: string): Promise<{ success: true }> {
  const existing = await prisma.budget.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new BudgetNotFoundError();
  }

  await prisma.budget.delete({
    where: { id },
  });

  return { success: true };
}
