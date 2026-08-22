import type { PrismaClient } from "@prisma/client";
import { CategoryKind } from "@prisma/client";
import { ensureSystemCategories } from "./systemCategories";

/**
 * Categorias com que toda conta nasce. Vivem aqui — e não no seed — porque o
 * cadastro pelo app precisa delas tanto quanto o seed: conta sem categoria não
 * consegue categorizar a primeira transação nem criar um orçamento.
 *
 * Cada uma tem cor própria: antes três dividiam o mesmo roxo e duas o mesmo
 * verde, e uma lista em que as cores se repetem não é código de cor nenhum.
 * A ordem é a das fixas primeiro — é o palpite inicial, e o usuário muda o que
 * discordar no modal da categoria.
 */
export const DEFAULT_CATEGORIES = [
  { name: "Renda", icon: "wallet", colorKey: "5", kind: CategoryKind.FIXED },
  { name: "Moradia", icon: "home", colorKey: "3", kind: CategoryKind.FIXED },
  { name: "Serviços", icon: "repeat", colorKey: "9", kind: CategoryKind.FIXED },
  { name: "Mercado", icon: "cart", colorKey: "4", kind: CategoryKind.VARIABLE },
  { name: "Transporte", icon: "car", colorKey: "8", kind: CategoryKind.VARIABLE },
  { name: "Restaurante", icon: "utensils", colorKey: "2", kind: CategoryKind.VARIABLE },
  { name: "Lazer", icon: "film", colorKey: "10", kind: CategoryKind.VARIABLE },
  { name: "Saúde", icon: "pulse", colorKey: "1", kind: CategoryKind.VARIABLE },
  { name: "Casa", icon: "sofa", colorKey: "14", kind: CategoryKind.VARIABLE },
  { name: "Eletrônicos", icon: "device", colorKey: "7", kind: CategoryKind.VARIABLE },
  { name: "Outros", icon: "dots", colorKey: "16", kind: CategoryKind.VARIABLE },
] as const;

/** Idempotente: pode rodar de novo sobre uma conta que já tem as categorias. */
export async function createDefaultCategories(
  client: Pick<PrismaClient, "category">,
  userId: string
): Promise<number> {
  for (const category of DEFAULT_CATEGORIES) {
    await client.category.upsert({
      where: { userId_name: { userId, name: category.name } },
      // `kind` fica de fora do update de propósito: reexecutar isto sobre uma
      // conta existente não pode desfazer o que o usuário classificou à mão.
      update: { icon: category.icon, colorKey: category.colorKey },
      create: { ...category, userId },
    });
  }

  // As de sistema vêm junto: conta nova já nasce podendo receber transação sem
  // que exista o estado "sem categoria nenhuma".
  await ensureSystemCategories(client, userId);

  return DEFAULT_CATEGORIES.length;
}
