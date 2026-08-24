import React, { useState } from "react";
import type { InstallmentsResponse, TransactionDTO } from "@poup/shared";
import { fetchInstallments } from "../../lib/api";
import { Money } from "../ui/Money";
import { formatDate } from "../../lib/format";

export interface InstallmentGroupProps {
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
 * O selo `3/10` que abre a compra inteira.
 *
 * A lista do mês mostra a parcela **daquele mês** — é o que você gastou ali. O
 * dropdown existe para a pergunta seguinte, que a lista não responde: "e as
 * outras nove, quando caem?". Por isso ele carrega sob demanda: quase ninguém
 * abre, e trazer as dez em toda listagem multiplicaria a resposta por dez.
 */
export function InstallmentGroup({ transaction, agrupadas }: InstallmentGroupProps) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<InstallmentsResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!transaction.installmentTotal) return null;

  const compraInteira = (agrupadas ?? 1) > 1;
  const rotulo = compraInteira
    ? `${transaction.installmentTotal}x`
    : `${transaction.installmentIndex}/${transaction.installmentTotal}`;

  async function alternar(e: React.MouseEvent | React.KeyboardEvent) {
    // A linha inteira abre o modal de detalhe: o selo não pode abrir os dois.
    e.stopPropagation();

    if (aberto) {
      setAberto(false);
      return;
    }

    setAberto(true);
    if (dados || carregando) return;

    try {
      setCarregando(true);
      setErro(null);
      setDados(await fetchInstallments(transaction.id));
    } catch (err: any) {
      setErro(err.message || "Não foi possível carregar as parcelas.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      {/*
        `span role="button"` e nao `<button>`: na lista mobile a linha inteira
        ja e um `<button>`, e botao dentro de botao e DOM invalido — o React
        avisa e o parser do navegador chegaria a quebrar a linha em duas. O
        papel e o `tabIndex` devolvem o que o elemento nativo daria.
      */}
      <span
        role="button"
        tabIndex={0}
        onClick={alternar}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            // Espaco rolaria a pagina antes de acionar o selo.
            e.preventDefault();
            void alternar(e);
          }
        }}
        aria-expanded={aberto}
        title={`Ver as ${transaction.installmentTotal} parcelas desta compra`}
        className="shrink-0 text-[10px] font-bold tnum px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors focus-ring cursor-pointer"
      >
        {rotulo}
      </span>

      {aberto && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="basis-full mt-2 p-2.5 rounded-tile bg-surface-sunken border border-border flex flex-col gap-1 anim-fade-down"
        >
          {carregando && (
            <span className="text-[11px] text-text-secondary">Carregando parcelas…</span>
          )}

          {erro && <span className="text-[11px] text-error">{erro}</span>}

          {dados?.installments.map((parcela) => (
            <div
              key={parcela.id}
              className={`flex items-center justify-between gap-3 text-[11px] px-1.5 py-1 rounded-ctl ${
                // So ha parcela a destacar quando a linha e uma parcela. Se ela
                // e a compra inteira, destacar a 1a seria apontar para nada.
                !compraInteira && parcela.id === transaction.id
                  ? "bg-primary-soft text-text-primary font-semibold"
                  : "text-text-secondary"
              }`}
            >
              <span className="tnum shrink-0">
                {parcela.installmentIndex}/{parcela.installmentTotal}
              </span>
              <span className="tnum text-text-disabled truncate">
                {parcela.dueDate ? `vence ${formatDate(parcela.dueDate)}` : "sem vencimento"}
              </span>
              <span className="tnum shrink-0">
                <Money value={parcela.amount} />
              </span>
            </div>
          ))}

          {dados && dados.installments.length > 0 && (
            <div className="flex items-center justify-between gap-3 text-[11px] px-1.5 pt-1.5 mt-0.5 border-t border-border font-bold text-text-primary">
              <span>Total da compra</span>
              <span className="tnum">
                <Money value={dados.total} />
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
