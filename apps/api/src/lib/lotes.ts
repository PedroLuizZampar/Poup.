/**
 * Trabalho em lote contra o banco.
 *
 * Existe por um motivo só: `await` dentro de um laço é um ida-e-volta até o
 * Neon por item. Com 50ms de latência, mil transações viram quase um minuto
 * de espera pura — e num host serverless isso não termina em lentidão, termina
 * em timeout. As funções aqui são o contrário disso: uma ida por lote.
 *
 * O teto de 500 não é estética. O Postgres limita os parâmetros de uma
 * consulta (~65k) e cada linha ocupa vários, então mandar o extrato inteiro de
 * uma vez falharia justamente no primeiro sync, que é o caso que mais importa.
 */
export const LOTE = 500;

export function emLotes<T>(items: T[], tamanho: number = LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamanho) {
    lotes.push(items.slice(i, i + tamanho));
  }
  return lotes;
}

/**
 * Roda uma consulta uma vez por lote de chaves e junta os resultados. Para
 * `where: { id: { in: [...] } }` sobre uma lista que pode ser grande.
 */
export async function buscarEmLotes<K, R>(
  chaves: K[],
  consulta: (lote: K[]) => Promise<R[]>,
  tamanho: number = LOTE
): Promise<R[]> {
  const resultados: R[] = [];
  for (const lote of emLotes(chaves, tamanho)) {
    resultados.push(...(await consulta(lote)));
  }
  return resultados;
}
