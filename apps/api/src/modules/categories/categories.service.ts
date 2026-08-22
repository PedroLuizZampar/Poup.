import { CategoryKind, SuggestionSource, SuggestionStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  CategoryAlreadyExistsError,
  CategoryNotFoundError,
  SystemCategoryError,
} from "../../lib/errors";
import { ensureSystemCategories } from "../../lib/systemCategories";

export { CategoryAlreadyExistsError, CategoryNotFoundError, SystemCategoryError };

/** Chaves da paleta de categorias (cat-1 … cat-16, na ordem do círculo cromático). */
const VALID_COLOR_KEYS = Array.from({ length: 16 }, (_, i) => String(i + 1));

/** Verde — a mesma cor que o app usa quando a chave gravada não existe mais. */
const DEFAULT_COLOR_KEY = "5";

export interface CreateCategoryInput {
  name: string;
  icon?: string;
  colorKey?: string;
  kind?: CategoryKind;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  colorKey?: string;
  kind?: CategoryKind;
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

  const rawKey = input.colorKey?.replace(/^c[bf]/i, "") || DEFAULT_COLOR_KEY;
  const normalizedColorKey = VALID_COLOR_KEYS.includes(rawKey) ? rawKey : DEFAULT_COLOR_KEY;

  return prisma.category.create({
    data: {
      userId,
      name: trimmedName,
      icon: input.icon || "folder",
      colorKey: normalizedColorKey,
      kind: input.kind ?? CategoryKind.VARIABLE,
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

  const rawKey = input.colorKey ? input.colorKey.replace(/^c[bf]/i, "") : undefined;
  const normalizedColorKey = rawKey
    ? VALID_COLOR_KEYS.includes(rawKey)
      ? rawKey
      : DEFAULT_COLOR_KEY
    : undefined;

  return prisma.category.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      icon: input.icon?.trim(),
      ...(normalizedColorKey ? { colorKey: normalizedColorKey } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
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
      where: { userId, categoryId: id },
      data: { categoryId: systemIds.UNCATEGORIZED },
    });

    // A FK já faria `categoryId` virar null sozinha (ON DELETE SET NULL), mas
    // deixaria `source` mentindo: uma sugestão sem categoria anunciada como
    // vinda do histórico. Aqui as pendentes viram explicitamente "sem palpite",
    // que é o que de fato sobrou — e as transações seguem na fila de revisão.
    await tx.categorySuggestion.updateMany({
      where: { userId, categoryId: id, status: SuggestionStatus.PENDING },
      data: { categoryId: null, source: SuggestionSource.NONE, confidence: 0 },
    });

    await tx.category.delete({ where: { id } });
  });

  return { success: true };
}
