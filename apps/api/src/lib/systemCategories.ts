import type { PrismaClient } from "@prisma/client";
import { SystemCategoryKey } from "@prisma/client";

/**
 * As categorias que o app cria e mantém para si.
 *
 * Elas existem por uma razão só: fazer com que `Transaction.categoryId` nunca
 * precise ser nulo. Nulo é um estado que cada consumidor — relatório, orçamento,
 * dashboard, filtro — interpretava do seu jeito; uma linha de verdade em
 * `Category` faz o `groupBy` e o join funcionarem sem ninguém saber que ela é
 * especial. O preço é `systemKey`, que os seletores escondem.
 */
export const SYSTEM_CATEGORY_DEFS = [
  {
    systemKey: SystemCategoryKey.TRANSFER,
    name: "Transferência entre contas",
    icon: "repeat",
    colorKey: "5",
  },
  {
    systemKey: SystemCategoryKey.UNCATEGORIZED,
    name: "Sem categoria",
    icon: "dots",
    colorKey: "5",
  },
] as const;

export type SystemCategoryIds = Record<SystemCategoryKey, string>;

/**
 * Idempotente, e tolerante a quem já tinha uma categoria com o nome reservado:
 * nesse caso adota a linha existente em vez de tentar criar outra e esbarrar no
 * unique (userId, name).
 */
export async function ensureSystemCategories(
  client: Pick<PrismaClient, "category">,
  userId: string
): Promise<SystemCategoryIds> {
  const ids = {} as SystemCategoryIds;

  for (const def of SYSTEM_CATEGORY_DEFS) {
    const byKey = await client.category.findFirst({
      where: { userId, systemKey: def.systemKey },
      select: { id: true },
    });
    if (byKey) {
      ids[def.systemKey] = byKey.id;
      continue;
    }

    const byName = await client.category.findUnique({
      where: { userId_name: { userId, name: def.name } },
      select: { id: true },
    });
    if (byName) {
      const adopted = await client.category.update({
        where: { id: byName.id },
        data: { systemKey: def.systemKey },
        select: { id: true },
      });
      ids[def.systemKey] = adopted.id;
      continue;
    }

    const created = await client.category.create({
      data: {
        userId,
        name: def.name,
        icon: def.icon,
        colorKey: def.colorKey,
        systemKey: def.systemKey,
      },
      select: { id: true },
    });
    ids[def.systemKey] = created.id;
  }

  return ids;
}
