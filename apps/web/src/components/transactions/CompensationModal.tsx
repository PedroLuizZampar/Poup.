import React, { useEffect, useState } from "react";
import type { CompensationCandidateDTO, CompensationIneligibleReason } from "@poup/shared";
import { compensateTransaction, fetchCompensationCandidates } from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Money } from "../ui/Money";
import { useToast } from "../ui/Toast";
import { formatDate } from "../../lib/format";

interface CompensationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** O crédito do estorno. É dele que a ação nasce. */
  transactionId: string;
  onDone: () => void;
}

/**
 * Por que uma candidata não pode ser escolhida, em português. Mostrar o motivo
 * ao lado é o que evita a pergunta "cadê a minha compra?": ela está na lista,
 * só não é selecionável, e a linha diz por quê.
 */
const MOTIVO: Record<CompensationIneligibleReason, string> = {
  "valor-diferente": "valor diferente do estorno",
  "ja-compensado": "já compensada",
};

function Candidata({
  c,
  selecionada,
  onSelect,
}: {
  c: CompensationCandidateDTO;
  selecionada: boolean;
  onSelect: () => void;
}) {
  const parcial = c.parcelasConhecidas < c.installmentTotal;

  return (
    <label
      className={`tap-target flex items-center gap-3 px-3 py-2.5 rounded-ctl ${
        c.elegivel
          ? "hover:bg-surface-alt cursor-pointer"
          : "opacity-50 cursor-not-allowed"
      }`}
    >
      <input
        type="radio"
        name="compensacao-candidata"
        checked={selecionada}
        onChange={onSelect}
        disabled={!c.elegivel}
        className="w-4 h-4 shrink-0 accent-primary"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text-primary truncate">
          {c.description}{" "}
          <span className="text-text-secondary">{c.installmentTotal}x</span>
        </span>
        <span className="block text-xs text-text-secondary">
          {c.purchaseDate ? formatDate(c.purchaseDate) : "sem data da compra"}
          {parcial && ` · ${c.parcelasConhecidas} de ${c.installmentTotal} parcelas importadas`}
          {c.motivo && ` · ${MOTIVO[c.motivo]}`}
        </span>
      </span>
      <span className="font-display font-bold text-sm shrink-0 tnum text-expense">
        - <Money value={c.total} />
      </span>
    </label>
  );
}

export function CompensationModal({
  isOpen,
  onClose,
  transactionId,
  onDone,
}: CompensationModalProps) {
  const { success, error } = useToast();
  const [candidatas, setCandidatas] = useState<CompensationCandidateDTO[]>([]);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      setLoading(true);
      setFalhou(false);
      try {
        const { candidates } = await fetchCompensationCandidates(transactionId);
        setCandidatas(candidates);
        // A que bate no valor já nasce marcada. Quando há empate, o servidor não
        // pré-seleciona nenhuma — e escolher por ela seria adivinhar.
        setEscolhida(candidates.find((c) => c.preSelecionada)?.purchaseKey ?? null);
      } catch (err) {
        console.error("Erro ao buscar compras candidatas:", err);
        setCandidatas([]);
        setFalhou(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, transactionId]);

  async function confirmar() {
    if (!escolhida || saving) return;
    setSaving(true);
    try {
      const { afetadas } = await compensateTransaction(transactionId, escolhida);
      success(
        "Compensado",
        `${afetadas} lançamentos saíram dos totais: o estorno e as parcelas da compra.`
      );
      onDone();
      onClose();
    } catch (err) {
      error(
        "Não deu para compensar",
        err instanceof Error ? err.message : "Tente de novo em instantes."
      );
    } finally {
      setSaving(false);
    }
  }

  const vazio = !loading && !falhou && candidatas.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Compensar compra parcelada"
      description="Escolha a compra que este crédito estornou. As duas pontas saem de todos os totais."
      maxWidth="lg"
      footer={
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Agora não
          </Button>
          <Button
            variant="primary"
            onClick={() => void confirmar()}
            loading={saving}
            disabled={!escolhida}
          >
            Compensar
          </Button>
        </div>
      }
    >
      {loading && <p className="text-sm text-text-secondary">Procurando compras parceladas…</p>}

      {falhou && (
        <p className="text-sm text-text-secondary">
          Não deu para carregar as compras desta conta. Feche e tente de novo.
        </p>
      )}

      {vazio && (
        <p className="text-sm text-text-secondary">
          Nenhuma compra parcelada nesta conta. A compensação só vale para parcelamentos — uma
          compra à vista estornada já se acerta sozinha no mês.
        </p>
      )}

      {candidatas.length > 0 && (
        <div className="flex flex-col gap-1">
          {candidatas.map((c) => (
            <Candidata
              key={c.purchaseKey}
              c={c}
              selecionada={escolhida === c.purchaseKey}
              onSelect={() => setEscolhida(c.purchaseKey)}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
