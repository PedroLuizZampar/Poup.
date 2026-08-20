import React, { useState, useEffect, useMemo, FormEvent } from "react";
import type { TransactionDTO, CategoryDTO } from "@poup/shared";
import { updateTransaction } from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { CategoryTile } from "../ui/CategoryTile";
import { CategorySelectModal } from "../categories/CategorySelectModal";
import { SimilarTransactionsModal } from "./SimilarTransactionsModal";
import { useToast } from "../ui/Toast";
import { formatCurrency, formatDate } from "../../lib/format";
import { useCategoryMap } from "../../hooks/useCategories";

interface TransactionDetailModalProps {
  transaction: TransactionDTO | null;
  /** Todas, inclusive as de sistema: o seletor filtra, a exibição precisa. */
  categories: CategoryDTO[];
  onClose: () => void;
  onUpdated: (updated: TransactionDTO) => void;
}

export function TransactionDetailModal({
  transaction,
  categories,
  onClose,
  onUpdated,
}: TransactionDetailModalProps) {
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  /** Categoria recém-aplicada, quando vale oferecer repeti-la nas parecidas. */
  const [similarFor, setSimilarFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (transaction) {
      setDescription(transaction.description);
      setCategoryId(transaction.categoryId);
      setNote(transaction.note || "");
    }
  }, [transaction]);

  const categoryMap = useCategoryMap(categories);
  // O mapa fica com todas para saber desenhar "Transferência entre contas";
  // o seletor recebe só o que o usuário pode escolher.
  const selectableCategories = useMemo(
    () => categories.filter((c) => !c.systemKey),
    [categories]
  );

  if (!transaction) return null;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!transaction) return;

    try {
      setLoading(true);
      const updated = await updateTransaction(transaction.id, {
        description: description.trim(),
        categoryId,
        note: note.trim() || null,
      });
      toast.success("Transação atualizada com sucesso.");
      onUpdated(updated);

      // A categoria desta transação já está salva; o modal cuida só das outras.
      // Só faz sentido quando a categoria de fato mudou para uma selecionável —
      // repetir uma oculta em massa não é uma decisão, é um estado de espera.
      const escolhida = categoryId ? categoryMap[categoryId] : null;
      const mudou = Boolean(categoryId) && categoryId !== transaction.categoryId;
      if (mudou && escolhida && !escolhida.systemKey) {
        setSimilarFor(categoryId);
        return;
      }

      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar a transação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={!!transaction}
      onClose={onClose}
      title="Detalhes da transação"
      maxWidth="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="transaction-detail-form"
            variant="primary"
            size="sm"
            loading={loading}
          >
            Salvar alterações
          </Button>
        </>
      }
    >
      <form id="transaction-detail-form" onSubmit={handleSave} className="flex flex-col gap-4">
        {/* Metadados: Valor e Data/Conta */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex flex-col justify-between">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Valor
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`font-display font-extrabold text-lg tnum ${
                  transaction.type === "INCOME" ? "text-income" : "text-expense"
                }`}
              >
                {transaction.type === "INCOME" ? "+ " : "- "}
                {formatCurrency(transaction.amount)}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex flex-col justify-between">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Data e Conta
            </span>
            <div className="mt-1">
              <span className="text-xs font-semibold text-text-primary block tnum">
                {formatDate(transaction.date)}
              </span>
              <span className="text-[11px] text-text-secondary truncate block">
                {transaction.accountName || "Conta principal"}
              </span>
            </div>
          </div>
        </div>

        {/* Descrição */}
        <Field id="tx-desc" label="Descrição" required>
          <Input
            id="tx-desc"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {/* Categoria com Modal Dedicado */}
        <Field id="tx-cat" label="Categoria">
          <button
            id="tx-cat"
            type="button"
            onClick={() => setIsCategoryModalOpen(true)}
            className="w-full h-ctl px-3.5 flex items-center justify-between gap-2 rounded-ctl bg-surface-alt text-text-primary border border-border hover:border-border-strong focus-ring cursor-pointer select-none transition-[border-color,box-shadow] duration-150 text-left text-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {categoryId && categoryMap[categoryId] ? (
                <>
                  <CategoryTile
                    icon={categoryMap[categoryId].icon}
                    colorKey={categoryMap[categoryId].colorKey}
                    size="sm"
                  />
                  <span className="truncate font-medium">
                    {categoryMap[categoryId].name}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 rounded-tile bg-surface-sunken flex items-center justify-center text-text-disabled text-xs shrink-0 border border-border">
                    ✕
                  </div>
                  <span className="text-text-disabled font-normal">Sem categoria</span>
                </>
              )}
            </div>

            <span className="text-xs font-semibold text-primary hover:underline shrink-0">
              Alterar
            </span>
          </button>

          {similarFor && (
        <SimilarTransactionsModal
          isOpen={true}
          onClose={() => {
            setSimilarFor(null);
            onClose();
          }}
          transactionId={transaction.id}
          categoryId={similarFor}
          categoryMap={categoryMap}
        />
      )}

      <CategorySelectModal
            isOpen={isCategoryModalOpen}
            onClose={() => setIsCategoryModalOpen(false)}
            categories={selectableCategories}
            selectedCategoryId={categoryId}
            onSelectCategory={setCategoryId}
          />
        </Field>

        {/* Observações */}
        <Field id="tx-note" label="Observações (opcional)">
          <Input
            id="tx-note"
            placeholder="Ex: Identificação pessoal, nota fiscal..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}



