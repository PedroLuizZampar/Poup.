import { merchantKey, normalizeDescription } from "./normalize";

/**
 * Acima disso duas descrições são tratadas como do mesmo estabelecimento.
 *
 * 0.6 no coeficiente de Dice é aproximadamente "dois terços dos tokens em
 * comum". Mais baixo começa a casar "Restaurante X" com "Restaurante Y" — que é
 * justamente o erro que faria a aplicação em massa recategorizar o que não deve.
 */
export const SIMILARITY_THRESHOLD = 0.6;

function tokenSet(raw: string): Set<string> {
  return new Set(normalizeDescription(raw).split(" ").filter(Boolean));
}

/**
 * Coeficiente de Dice sobre os conjuntos de tokens, com um atalho: chave de
 * comerciante igual vale 1 independente do resto, porque o resto é o id da
 * transação e a cidade.
 */
export function similarityScore(a: string, b: string): number {
  const keyA = merchantKey(a);
  const keyB = merchantKey(b);
  if (keyA !== null && keyA === keyB) return 1;

  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared++;
  }

  return (2 * shared) / (setA.size + setB.size);
}
