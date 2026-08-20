import type { PrismaClient } from "@prisma/client";

/**
 * Categorias com que toda conta nasce. Vivem aqui — e não no seed — porque o
 * cadastro pelo app precisa delas tanto quanto o seed: conta sem categoria não
 * consegue categorizar a primeira transação nem criar um orçamento.
 */
export const DEFAULT_CATEGORIES = [
  { name: "Renda", icon: "wallet", colorKey: "1" },
  { name: "Mercado", icon: "cart", colorKey: "1" },
  { name: "Moradia", icon: "home", colorKey: "4" },
  { name: "Transporte", icon: "car", colorKey: "2" },
  { name: "Lazer", icon: "film", colorKey: "3" },
  { name: "Restaurante", icon: "utensils", colorKey: "3" },
  { name: "Serviços", icon: "repeat", colorKey: "3" },
  { name: "Saúde", icon: "pulse", colorKey: "4" },
  { name: "Casa", icon: "sofa", colorKey: "5" },
  { name: "Eletrônicos", icon: "device", colorKey: "2" },
  { name: "Outros", icon: "dots", colorKey: "5" },
] as const;

/** Idempotente: pode rodar de novo sobre uma conta que já tem as categorias. */
export async function createDefaultCategories(
  client: Pick<PrismaClient, "category">,
  userId: string
): Promise<number> {
  for (const category of DEFAULT_CATEGORIES) {
    await client.category.upsert({
      where: { userId_name: { userId, name: category.name } },
      update: { icon: category.icon, colorKey: category.colorKey },
      create: { ...category, userId },
    });
  }

  return DEFAULT_CATEGORIES.length;
}
