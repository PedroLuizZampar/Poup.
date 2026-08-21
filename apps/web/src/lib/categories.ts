import type { CategoryDTO } from "@poup/shared";

/**
 * "Sem categoria" não é mais ausência de categoria: a API guarda a transação
 * numa das duas ocultas (`UNCATEGORIZED_EXPENSE` / `UNCATEGORIZED_INCOME`) para
 * que `categoryId` nunca seja nulo. A tela, porém, continua tendo que mostrar
 * "Sem categoria" — e não "Sem categoria (despesa)", que é o nome interno.
 *
 * Estas duas funções são a tradução entre os dois mundos, para que nenhuma tela
 * precise conhecer os nomes das chaves de sistema.
 */
export function isUncategorized(category?: CategoryDTO | null): boolean {
  return (
    category?.systemKey === "UNCATEGORIZED_EXPENSE" ||
    category?.systemKey === "UNCATEGORIZED_INCOME"
  );
}

/** A categoria a exibir: `null` quando ela significa "ainda sem categoria". */
export function displayCategory(category?: CategoryDTO | null): CategoryDTO | null {
  if (!category || isUncategorized(category)) return null;
  return category;
}
