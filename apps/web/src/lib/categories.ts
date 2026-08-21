import type { CategoryDTO } from "@poup/shared";

/**
 * "Sem categoria" não é mais ausência de categoria: a API guarda a transação na
 * oculta `UNCATEGORIZED` para que `categoryId` nunca seja nulo. A tela, porém,
 * continua tendo que tratá-la como "ainda não decidido" — um chip apagado, e
 * não uma categoria como as outras.
 *
 * Estas duas funções são a tradução entre os dois mundos, para que nenhuma tela
 * precise conhecer os nomes das chaves de sistema.
 */
export function isUncategorized(category?: CategoryDTO | null): boolean {
  return category?.systemKey === "UNCATEGORIZED";
}

/** A categoria a exibir: `null` quando ela significa "ainda sem categoria". */
export function displayCategory(category?: CategoryDTO | null): CategoryDTO | null {
  if (!category || isUncategorized(category)) return null;
  return category;
}
