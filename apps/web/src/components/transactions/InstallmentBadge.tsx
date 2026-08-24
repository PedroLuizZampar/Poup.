import React from "react";
import type { TransactionDTO } from "@poup/shared";

export interface InstallmentBadgeProps {
  transaction: TransactionDTO;
  /**
   * Quantas parcelas desta compra a lista ja reuniu nesta linha.
   *
   * Muda o que o selo diz, porque a linha significa coisas diferentes nos dois
   * casos: quando a lista reuniu a compra inteira, a linha **e** a compra e o
   * selo anuncia o parcelamento ("8x"); quando so uma parcela esta ali — o
   * painel e a tela de categorias filtram por mes —, a linha e aquela parcela e
   * o selo diz qual ela e ("3/8").
   */
  agrupadas?: number;
}

/**
 * O selo `3/10` ao lado da descricao.
 *
 * So anuncia. O detalhamento das parcelas — quais cairam, quais foram pagas,
 * qual venceu — mora no modal da transacao, que a linha inteira ja abre.
 *
 * Ele ja foi um dropdown que abria a lista ali mesmo, dentro da grid. Duas
 * coisas competindo pelo mesmo clique numa linha que tambem e um botao: o selo
 * precisava interceptar o evento para o modal nao abrir junto, e o resultado
 * era uma lista de oito parcelas espremida numa linha de tabela. O modal tem
 * espaco, ja e o lugar do detalhe, e nao disputa clique com ninguem.
 */
export function InstallmentBadge({ transaction, agrupadas }: InstallmentBadgeProps) {
  if (!transaction.installmentTotal) return null;

  const compraInteira = (agrupadas ?? 1) > 1;
  const rotulo = compraInteira
    ? `${transaction.installmentTotal}x`
    : `${transaction.installmentIndex}/${transaction.installmentTotal}`;

  return (
    <span
      title={`Compra em ${transaction.installmentTotal} parcelas — abra a transação para ver todas`}
      className="shrink-0 text-[10px] font-bold tnum px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-secondary select-none"
    >
      {rotulo}
    </span>
  );
}
