import React, { useEffect, useState } from "react";
import type { SimilarTransactionDTO } from "@poup/shared";
import { bulkCategorize, fetchSimilarTransactions } from "../../lib/api";
import type { CategoryMap } from "../../hooks/useCategories";
import { notifySuggestionsChanged } from "../../hooks/useSuggestionsCount";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { formatDate } from "../../lib/format";
import { Money } from "../ui/Money";

interface SimilarTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** A transação que você acabou de categorizar. Ela não entra na lista. */
  transactionId: string;
  categoryId: string;
  categoryMap: CategoryMap;
  onApplied?: (updated: number) => void;
}

function Linha({
  tx,
  checked,
  onToggle,
}: {
  tx: SimilarTransactionDTO;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="tap-target flex items-center gap-3 px-3 py-2.5 rounded-ctl hover:bg-surface-alt cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 shrink-0 accent-primary"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text-primary truncate">{tx.description}</span>
        <span className="block text-xs text-text-secondary">
          {formatDate(tx.date)} · {tx.accountName}
          {tx.currentCategoryName ? ` · hoje em ${tx.currentCategoryName}` : ""}
        </span>
      </span>
      <span
        className={`font-display font-bold text-sm shrink-0 tnum ${
          tx.type === "INCOME" ? "text-income" : "text-expense"
        }`}
      >
        {tx.type === "INCOME" ? "+ " : "- "}
        <Money value={tx.amount} />
      </span>
    </label>
  );
}

export function SimilarTransactionsModal({
  isOpen,
  onClose,
  transactionId,
  categoryId,
  categoryMap,
  onApplied,
}: SimilarTransactionsModalProps) {
  const [semCategoria, setSemCategoria] = useState<SimilarTransactionDTO[]>([]);
  const [divergentes, setDivergentes] = useState<SimilarTransactionDTO[]>([]);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      setLoading(true);
      try {
        const data = await fetchSimilarTransactions(transactionId, categoryId);
        setSemCategoria(data.uncategorized);
        setDivergentes(data.differentCategory);
        // Pré-marcar só as que ainda não têm categoria: as outras já são uma
        // decisão sua, e desfazê-la em massa tem que ser deliberado.
        setSelecionadas(new Set(data.uncategorized.map((t) => t.id)));
      } catch (err) {
        console.error("Erro ao buscar transações parecidas:", err);
        setSemCategoria([]);
        setDivergentes([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, transactionId, categoryId]);

  function toggle(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function aplicar() {
    if (selecionadas.size === 0 || saving) return;
    setSaving(true);
    try {
      const { updated } = await bulkCategorize(Array.from(selecionadas), categoryId);
      // Aplicar em massa resolve as sugestões pendentes das transações afetadas.
      notifySuggestionsChanged();
      onApplied?.(updated);
      onClose();
    } catch (err) {
      console.error("Erro ao aplicar em massa:", err);
    } finally {
      setSaving(false);
    }
  }

  const nomeCategoria = categoryMap[categoryId]?.name ?? "esta categoria";
  const vazio = !loading && semCategoria.length === 0 && divergentes.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Aplicar em transações parecidas"
      description={`Marque as que também são ${nomeCategoria}.`}
      maxWidth="lg"
      footer={
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Agora não
          </Button>
          <Button
            variant="primary"
            onClick={() => void aplicar()}
            loading={saving}
            disabled={selecionadas.size === 0}
          >
            Aplicar em {selecionadas.size}
          </Button>
        </div>
      }
    >
      {loading && <p className="text-sm text-text-secondary">Procurando parecidas…</p>}

      {vazio && (
        <p className="text-sm text-text-secondary">
          Nenhuma outra transação parecida com esta.
        </p>
      )}

      {semCategoria.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary px-3 pt-1">
            Sem categoria
          </h3>
          {semCategoria.map((tx) => (
            <Linha
              key={tx.id}
              tx={tx}
              checked={selecionadas.has(tx.id)}
              onToggle={() => toggle(tx.id)}
            />
          ))}
        </section>
      )}

      {divergentes.length > 0 && (
        <section className="flex flex-col gap-1 mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary px-3">
            Já categorizadas de outro jeito
          </h3>
          <p className="text-xs text-text-secondary px-3 pb-1">
            Marcar uma destas substitui a categoria que ela tem hoje.
          </p>
          {divergentes.map((tx) => (
            <Linha
              key={tx.id}
              tx={tx}
              checked={selecionadas.has(tx.id)}
              onToggle={() => toggle(tx.id)}
            />
          ))}
        </section>
      )}
    </Modal>
  );
}
