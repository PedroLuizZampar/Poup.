/**
 * Quais compras parceladas um estorno pode cancelar.
 *
 * A Pluggy não liga uma ponta à outra: o estorno chega como um crédito solto,
 * de descrição genérica — num marketplace, a mesma string de qualquer outra
 * compra. O que resta é o valor, e por isso ele é exato: compensar por
 * aproximação tiraria do relatório uma despesa real, em silêncio.
 *
 * A escolha final é sempre da pessoa. Esta função só separa o que pode do que
 * não pode, e diz por quê — uma lista vazia não ensina nada a quem está
 * tentando entender por que a compra dele não aparece.
 */

export type MotivoInelegivel = "valor-diferente" | "ja-compensado";

/** A ponta crédito: a linha INCOME que o banco lançou ao devolver o dinheiro. */
export interface CreditoACompensar {
  id: string;
  accountId: string;
  /** Centavos inteiros. O sinal mora no `type`, então aqui é sempre positivo. */
  amountCents: number;
  compensationId: string | null;
}

/** Uma compra parcelada da conta, já reunida pelo `purchaseKey`. */
export interface GrupoDeCompra {
  purchaseKey: string;
  accountId: string;
  description: string;
  /** ISO, ou null quando o conector não informou a data da compra. */
  purchaseDate: string | null;
  installmentTotal: number;
  /** Quantas parcelas o app de fato importou — pode ser menos que o total. */
  parcelasConhecidas: number;
  totalCents: number;
  jaCompensado: boolean;
}

export interface CandidataDeCompensacao {
  purchaseKey: string;
  description: string;
  purchaseDate: string | null;
  installmentTotal: number;
  parcelasConhecidas: number;
  totalCents: number;
  elegivel: boolean;
  motivo: MotivoInelegivel | null;
  /** Ligada só quando **uma** candidata é elegível. Empate não decide. */
  preSelecionada: boolean;
}

export function candidatasDeCompensacao(
  credito: CreditoACompensar,
  grupos: GrupoDeCompra[]
): CandidataDeCompensacao[] {
  // Um crédito já compensado não escolhe de novo: desfazer vem primeiro.
  if (credito.compensationId !== null) return [];

  const daConta = grupos.filter((g) => g.accountId === credito.accountId);

  const avaliadas = daConta.map((g) => {
    const motivo: MotivoInelegivel | null = g.jaCompensado
      ? "ja-compensado"
      : g.totalCents !== credito.amountCents
        ? "valor-diferente"
        : null;

    return {
      purchaseKey: g.purchaseKey,
      description: g.description,
      purchaseDate: g.purchaseDate,
      installmentTotal: g.installmentTotal,
      parcelasConhecidas: g.parcelasConhecidas,
      totalCents: g.totalCents,
      elegivel: motivo === null,
      motivo,
      preSelecionada: false,
    };
  });

  // Estorno costuma ser de compra recente. Sem data, vai para o fim.
  avaliadas.sort((a, b) => {
    const ta = a.purchaseDate ? Date.parse(a.purchaseDate) : -Infinity;
    const tb = b.purchaseDate ? Date.parse(b.purchaseDate) : -Infinity;
    return tb - ta;
  });

  const elegiveis = avaliadas.filter((c) => c.elegivel);
  if (elegiveis.length === 1) {
    elegiveis[0].preSelecionada = true;
  }

  return avaliadas;
}
