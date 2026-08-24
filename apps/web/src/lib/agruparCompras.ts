import type { TransactionDTO } from "@poup/shared";

/**
 * Reunir as parcelas de uma compra numa linha so.
 *
 * A lista de Transacoes nao e mensal: ela mostra tudo o que passa pelos
 * filtros. Sem agrupar, uma compra em 8x aparece como oito linhas identicas,
 * cada uma com seu selo abrindo as mesmas oito — que e ruido, nao informacao.
 *
 * O agrupamento so acontece quando **mais de uma** parcela da compra esta na
 * lista. Isso nao e detalhe de implementacao: o painel e a tela de categorias
 * filtram por mes, e la cai exatamente uma parcela por compra. Nesses lugares a
 * linha tem de continuar sendo a parcela daquele mes, com o valor dela — e a
 * regra "so agrupa a partir de duas" entrega isso sem que ninguem precise
 * passar um sinalizador.
 */
export interface LinhaDaLista {
  /** A transacao que representa a linha. Numa compra parcelada, a 1a parcela. */
  tx: TransactionDTO;
  /** As parcelas reunidas aqui, ordenadas. Null quando a linha e uma so. */
  parcelas: TransactionDTO[] | null;
  /**
   * O valor que a linha mostra: a soma das parcelas agrupadas, ou o valor da
   * transacao sozinha.
   *
   * Soma **o que esta na lista**, e nao o total da compra que a API conhece. Se
   * um filtro esconder parcelas, a linha diz quanto ha ali — inventar o total
   * cheio faria a soma da tela nao fechar com as linhas exibidas. O total
   * verdadeiro da compra vive no rodape do dropdown, que o busca a parte.
   */
  valor: number;
}

/** Centavos, sem a sobra binaria de somar float. */
function emCentavos(valores: number[]): number {
  return Number(valores.reduce((soma, v) => soma + v, 0).toFixed(2));
}

export function agruparCompras(transactions: TransactionDTO[]): LinhaDaLista[] {
  const porChave = new Map<string, TransactionDTO[]>();
  for (const tx of transactions) {
    if (!tx.purchaseKey) continue;
    const atual = porChave.get(tx.purchaseKey);
    if (atual) atual.push(tx);
    else porChave.set(tx.purchaseKey, [tx]);
  }

  const jaEmitidas = new Set<string>();
  const linhas: LinhaDaLista[] = [];

  for (const tx of transactions) {
    const grupo = tx.purchaseKey ? porChave.get(tx.purchaseKey) : undefined;

    if (!grupo || grupo.length < 2) {
      linhas.push({ tx, parcelas: null, valor: tx.amount });
      continue;
    }

    // O grupo entra onde a primeira parcela dele aparecia, para que colapsar
    // nao reordene a lista.
    if (jaEmitidas.has(tx.purchaseKey!)) continue;
    jaEmitidas.add(tx.purchaseKey!);

    const parcelas = [...grupo].sort(
      (a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0)
    );

    linhas.push({
      tx: parcelas[0],
      parcelas,
      valor: emCentavos(parcelas.map((p) => p.amount)),
    });
  }

  return linhas;
}
