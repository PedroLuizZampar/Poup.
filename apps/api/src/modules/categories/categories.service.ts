import { TransactionType } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  CategoryAlreadyExistsError,
  CategoryNotFoundError,
  SystemCategoryError,
} from "../../lib/errors";
import { ensureSystemCategories } from "../../lib/systemCategories";

export { CategoryAlreadyExistsError, CategoryNotFoundError, SystemCategoryError };

/** Chaves da paleta de categorias (cat-1 … cat-24 no tema do desktop). */
const VALID_COLOR_KEYS = Array.from({ length: 24 }, (_, i) => String(i + 1));

export interface CreateCategoryInput {
  name: string;
  icon?: string;
  colorKey?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  colorKey?: string;
}

export async function listCategories(userId: string) {
  return prisma.category.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
}

export async function getCategoryById(userId: string, id: string) {
  return prisma.category.findFirst({
    where: { id, userId },
  });
}

export async function createCategory(userId: string, input: CreateCategoryInput) {
  const trimmedName = input.name.trim();

  const existing = await prisma.category.findUnique({
    where: {
      userId_name: {
        userId,
        name: trimmedName,
      },
    },
  });

  if (existing) {
    throw new CategoryAlreadyExistsError(trimmedName);
  }

  const validKeys = VALID_COLOR_KEYS;
  const rawKey = input.colorKey?.replace(/^c[bf]/i, "") || "1";
  const normalizedColorKey = validKeys.includes(rawKey) ? rawKey : "1";

  return prisma.category.create({
    data: {
      userId,
      name: trimmedName,
      icon: input.icon || "folder",
      colorKey: normalizedColorKey,
    },
  });
}

export async function updateCategory(userId: string, id: string, input: UpdateCategoryInput) {
  const existing = await prisma.category.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    throw new CategoryNotFoundError();
  }

  if (existing.systemKey) {
    throw new SystemCategoryError();
  }

  if (input.name) {
    const trimmedName = input.name.trim();
    if (trimmedName !== existing.name) {
      const duplicate = await prisma.category.findUnique({
        where: {
          userId_name: {
            userId,
            name: trimmedName,
          },
        },
      });

      if (duplicate && duplicate.id !== id) {
        throw new CategoryAlreadyExistsError(trimmedName);
      }
    }
  }

  const validKeys = VALID_COLOR_KEYS;
  const rawKey = input.colorKey ? input.colorKey.replace(/^c[bf]/i, "") : undefined;
  const normalizedColorKey = rawKey && validKeys.includes(rawKey) ? rawKey : rawKey ? "1" : undefined;

  return prisma.category.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      icon: input.icon?.trim(),
      ...(normalizedColorKey ? { colorKey: normalizedColorKey } : {}),
    },
  });
}

/**
 * Excluir uma categoria não pode reintroduzir o estado "sem categoria nenhuma":
 * o `onDelete: SetNull` do schema faria exatamente isso. Por isso as transações
 * são reatribuídas às ocultas antes, e tudo roda numa transação — meio caminho
 * aqui deixaria linhas nulas para trás.
 */
export async function deleteCategory(userId: string, id: string) {
  const existing = await prisma.category.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    throw new CategoryNotFoundError();
  }

  if (existing.systemKey) {
    throw new SystemCategoryError();
  }

  await prisma.$transaction(async (tx) => {
    const systemIds = await ensureSystemCategories(tx, userId);

    await tx.transaction.updateMany({
      where: { userId, categoryId: id, type: TransactionType.EXPENSE },
      data: { categoryId: systemIds.UNCATEGORIZED_EXPENSE },
    });
    await tx.transaction.updateMany({
      where: { userId, categoryId: id, type: TransactionType.INCOME },
      data: { categoryId: systemIds.UNCATEGORIZED_INCOME },
    });

    await tx.category.delete({ where: { id } });
  });

  return { success: true };
}
