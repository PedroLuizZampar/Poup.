import { CATEGORIZATION_RULES } from "./rules";

export type { CategorizationRule } from "./rules";
export { CATEGORIZATION_RULES } from "./rules";

export interface CategoryRef {
  id: string;
  name: string;
}

/**
 * Escolhe uma categoria do usuário para a transação importada, ou `null` quando
 * nenhuma regra se aplica — deixar sem categoria é melhor que chutar errado, já
 * que a tela de transações destaca as pendentes e o usuário corrige em um
 * clique.
 *
 * A ordem é deliberada: as regras de palavra-chave vêm antes do nome da
 * categoria da Pluggy porque são específicas do português e do comércio
 * brasileiro; o casamento por nome é a rede de segurança para quem criou uma
 * categoria com o mesmo nome que a Pluggy usa.
 */
export function findBestCategoryMatch(
  description: string,
  pluggyCategory: string | undefined | null,
  userCategories: CategoryRef[]
): string | null {
  if (userCategories.length === 0) return null;

  const text = `${description} ${pluggyCategory ?? ""}`.toLowerCase();

  for (const rule of CATEGORIZATION_RULES) {
    if (!rule.keywords.some((keyword) => text.includes(keyword))) continue;

    const match = userCategories.find(
      (category) => category.name.toLowerCase() === rule.targetName.toLowerCase()
    );
    if (match) return match.id;
  }

  if (pluggyCategory) {
    const pluggyName = pluggyCategory.toLowerCase();
    const direct = userCategories.find((category) => {
      const name = category.name.toLowerCase();
      return name.includes(pluggyName) || pluggyName.includes(name);
    });
    if (direct) return direct.id;
  }

  return null;
}
