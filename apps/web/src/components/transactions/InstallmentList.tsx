import React, { useEffect, useState } from "react";
import type { InstallmentsResponse, InstallmentStatus } from "@poup/shared";
import { fetchInstallments } from "../../lib/api";
import { Money } from "../ui/Money";
import { contagem } from "../../lib/format";
import { descricaoDaParcela } from "../../lib/parcelas";

/**
 * A cor de cada estado.
 *
 * A cor acompanha o texto, nunca o substitui: quem nao distingue verde de
 * vermelho le "paga em" e "venceu" do mesmo jeito. Ver `descricaoDaParcela`.
 *
 * `FORECAST` nao ganha ponto de proposito. Ele cobre tanto "ainda vai ser
 * faturada" quanto "a fatura nao chegou ao app", e um marcador ali sugeriria
 * uma afirmacao que o app nao tem como fazer.
 */
const CORES: Record<InstallmentStatus, { ponto: string | null; texto: string }> = {
  PAID: { ponto: "bg-income", texto: "text-income" },
  OVERDUE: { ponto: "bg-error", texto: "text-error" },
  OPEN: { ponto: "bg-warning", texto: "text-warning" },
  FORECAST: { ponto: null, texto: "text-text-disabled" },
};

export interface InstallmentListProps {
  /** A transação de onde partir — qualquer parcela da compra serve. */
  transactionId: string;
  /** A parcela a destacar: a que a pessoa abriu. */
  destacar?: string;
}

/**
 * As parcelas de uma compra, com o que ja foi pago e o que venceu.
 *
 * Carrega sob demanda porque so o modal a usa, e so quando a transacao aberta e
 * parcelada: trazer as dez parcelas em toda listagem multiplicaria a resposta
 * por dez para uma pergunta que quase ninguem faz.
 */
export function InstallmentList({ transactionId, destacar }: InstallmentListProps) {
  const [dados, setDados] = useState<InstallmentsResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;

    setCarregando(true);
    setErro(null);

    fetchInstallments(transactionId)
      .then((res) => {
        // O modal pode ter sido fechado, ou trocado de transação, enquanto a
        // resposta vinha. Escrever aqui mostraria as parcelas da compra errada.
        if (ativo) setDados(res);
      })
      .catch((err: any) => {
        if (ativo) setErro(err.message || "Não foi possível carregar as parcelas.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [transactionId]);

  if (carregando) {
    return <span className="text-[11px] text-text-secondary">Carregando parcelas…</span>;
  }

  if (erro) {
    return <span className="text-[11px] text-error">{erro}</span>;
  }

  if (!dados || dados.installments.length === 0) return null;

  const pagas = dados.installments.filter((p) => p.status === "PAID").length;

  return (
    <div className="flex flex-col gap-1">
      {dados.installments.map((parcela) => {
        const cor = CORES[parcela.status];
        const destacada = parcela.id === destacar;

        return (
          <div
            key={parcela.id}
            className={`flex items-center justify-between gap-3 text-[11px] px-1.5 py-1 rounded-ctl
            }`}
          >
            <span className="flex items-center gap-1.5 shrink-0">
              {/* `aria-hidden`: o texto ao lado ja diz o estado, e um ponto
                  anunciado viraria ruido a cada linha. */}
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${cor.ponto ?? "bg-transparent"}`}
              />
              <span className="tnum text-text-primary">
                {parcela.installmentIndex}/{parcela.installmentTotal}
              </span>
            </span>

            <span className={`tnum truncate ${cor.texto}`}>
              {descricaoDaParcela(parcela)}
            </span>

            <span className="tnum shrink-0 text-text-primary">
              <Money value={parcela.amount} />
            </span>
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3 text-[11px] px-1.5 pt-1.5 mt-0.5 border-t border-border font-bold text-text-primary">
        <span>Total da compra</span>
        <span className="flex items-center gap-2">
          {pagas > 0 && (
            <span className="font-medium text-income">
              {contagem(pagas, "paga", "pagas")} · <Money value={dados.paidTotal} />
            </span>
          )}
          <span className="tnum">
            <Money value={dados.total} />
          </span>
        </span>
      </div>
    </div>
  );
}
