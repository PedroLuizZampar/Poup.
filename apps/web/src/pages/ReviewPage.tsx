import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SuggestionDTO } from "@poup/shared";
import { acceptSuggestion, dismissSuggestion, fetchSuggestions } from "../lib/api";
import { useCategories } from "../hooks/useCategories";
import { CategorySelectModal } from "../components/categories/CategorySelectModal";
import { SimilarTransactionsModal } from "../components/transactions/SimilarTransactionsModal";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/ui/Button";
import { CategoryTile } from "../components/ui/CategoryTile";
import { formatCurrency, formatDate } from "../lib/format";

const SOURCE_LABEL: Record<SuggestionDTO["source"], string> = {
  HISTORY: "porque você já categorizou transações parecidas assim",
  RULE: "pelo nome do estabelecimento",
  PLUGGY: "pela categoria informada pelo banco",
};

export function ReviewPage() {
  const { categories, categoryMap } = useCategories();
  const [queue, setQueue] = useState<SuggestionDTO[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Oferta de aplicar em massa, mostrada só depois de uma troca de categoria. */
  const [offer, setOffer] = useState<{ transactionId: string; categoryId: string } | null>(
    null
  );
  const [similarOpen, setSimilarOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchSuggestions();
        setQueue(data.suggestions);
      } catch (err) {
        console.error("Erro ao carregar sugestões:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = queue[index] ?? null;

  async function resolve(categoryId?: string) {
    if (!current || saving) return;
    setSaving(true);
    try {
      await acceptSuggestion(current.id, categoryId);
      // Trocar a categoria é a decisão que vale a pena repetir em massa;
      // aprovar o que o app já sugeriu, não — abrir o modal a cada aprovação
      // transformaria oito toques em dezesseis.
      setOffer(
        categoryId && categoryId !== current.suggestedCategoryId
          ? { transactionId: current.transaction.id, categoryId }
          : null
      );
      setIndex((i) => i + 1);
    } catch (err) {
      console.error("Erro ao aplicar categoria:", err);
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    if (!current || saving) return;
    setSaving(true);
    try {
      await dismissSuggestion(current.id);
      setOffer(null);
      setIndex((i) => i + 1);
    } catch (err) {
      console.error("Erro ao pular sugestão:", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-text-secondary">Carregando sugestões…</div>;
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-6 anim-fade-up">
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Revisar categorias
        </h1>
        <EmptyState
          title="Nada para revisar"
          description="Assim que chegarem transações novas com uma categoria sugerida, elas aparecem aqui."
          action={
            <Link to="/transacoes">
              <Button variant="primary">Ver transações</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const tx = current.transaction;
  const sugerida = categoryMap[current.suggestedCategoryId];

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      <div className="flex flex-row items-start justify-between gap-4">
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Revisar categorias
        </h1>
        <span className="text-sm text-text-secondary shrink-0 mt-1">
          {index + 1} de {queue.length}
        </span>
      </div>

      {offer && (
        <button
          type="button"
          onClick={() => setSimilarOpen(true)}
          className="tap-target text-left w-full rounded-panel border border-border bg-surface-alt px-4 py-3 text-sm text-text-primary hover:border-border-strong transition-colors focus-ring"
        >
          Aplicar <strong>{categoryMap[offer.categoryId]?.name}</strong> a outras
          transações parecidas?
        </button>
      )}

      <div className="bg-surface rounded-panel p-5 shadow-sh1 border border-border flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-text-primary break-words">
            {tx.description}
          </p>
          <p
            className={`text-2xl font-display font-extrabold ${
              tx.type === "EXPENSE" ? "text-danger" : "text-success"
            }`}
          >
            {tx.type === "EXPENSE" ? "-" : "+"}
            {formatCurrency(tx.amount)}
          </p>
          <p className="text-xs text-text-secondary">
            {tx.accountName} · {formatDate(tx.date)}
          </p>
        </div>

        <div className="rounded-ctl bg-surface-alt border border-border p-4 flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Categoria sugerida
          </span>
          <div className="flex items-center gap-3">
            {sugerida && (
              <CategoryTile icon={sugerida.icon} colorKey={sugerida.colorKey} size="md" />
            )}
            <span className="text-base font-semibold text-text-primary">
              {current.suggestedCategoryName}
            </span>
          </div>
          <span className="text-xs text-text-secondary">{SOURCE_LABEL[current.source]}</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="primary" onClick={() => void resolve()} loading={saving} fullWidth>
            Aprovar
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPickerOpen(true)}
            disabled={saving}
            fullWidth
          >
            Trocar categoria
          </Button>
          <Button variant="ghost" onClick={() => void skip()} disabled={saving} fullWidth>
            Pular
          </Button>
        </div>
      </div>

      <CategorySelectModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={categories}
        selectedCategoryId={current.suggestedCategoryId}
        onSelectCategory={(id) => {
          if (id) void resolve(id);
        }}
        title="Escolher categoria"
        allowUncategorized={false}
      />

      {offer && (
        <SimilarTransactionsModal
          isOpen={similarOpen}
          onClose={() => {
            setSimilarOpen(false);
            setOffer(null);
          }}
          transactionId={offer.transactionId}
          categoryId={offer.categoryId}
          categoryMap={categoryMap}
        />
      )}
    </div>
  );
}
