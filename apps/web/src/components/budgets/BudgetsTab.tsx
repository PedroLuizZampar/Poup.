import React, { useState, FormEvent, useMemo } from "react";
import type { BudgetDTO, CategoryDTO } from "@poup/shared";
import { upsertBudget, deleteBudget } from "../../lib/api";
import { PlusIcon, TrashIcon, EditIcon } from "../icons/Icons";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { CategorySelectModal } from "../categories/CategorySelectModal";
import { CurrencyInput } from "../ui/CurrencyInput";
import { CategoryTile } from "../ui/CategoryTile";
import { ProgressBar } from "../ui/ProgressBar";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../common/EmptyState";
import { CardSkeleton } from "../common/Skeleton";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { formatCurrency } from "../../lib/format";
import { useCategoryMap } from "../../hooks/useCategories";

export interface BudgetsTabProps {
  budgets: BudgetDTO[];
  categories: CategoryDTO[];
  loading: boolean;
  onRefresh: () => void;
}

export function BudgetsTab({ budgets, categories, loading, onRefresh }: BudgetsTabProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryPickerOpen, setIsCategoryPickerOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState(0);
  const [saving, setSaving] = useState(false);
  /** Orcamento sendo editado; null significa criacao. */
  const [editing, setEditing] = useState<BudgetDTO | null>(null);

  const confirm = useConfirm();
  const toast = useToast();

  const categoryMap = useCategoryMap(categories);

  const availableCategoryOptions = useMemo(() => {
    return categories.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [categories]);

  function openCreateModal() {
    setEditing(null);
    setCategoryId(availableCategoryOptions[0]?.value || "");
    setMonthlyLimit(500);
    setIsModalOpen(true);
  }

  function openEditModal(budget: BudgetDTO) {
    setEditing(budget);
    setCategoryId(budget.categoryId);
    setMonthlyLimit(budget.monthlyLimit);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditing(null);
  }

  async function handleSaveBudget(e: FormEvent) {
    e.preventDefault();
    if (!categoryId || monthlyLimit <= 0) {
      toast.error("Selecione a categoria e informe um limite maior que zero.");
      return;
    }

    try {
      setSaving(true);
      // O endpoint e um upsert por categoria, entao editar o limite de um
      // orcamento existente e a mesma chamada de criar um novo.
      await upsertBudget({
        categoryId,
        monthlyLimit,
      });
      toast.success(editing ? "Orçamento atualizado!" : "Orçamento salvo com sucesso!");
      closeModal();
      setCategoryId("");
      setMonthlyLimit(0);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar orçamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(budget: BudgetDTO) {
    const confirmed = await confirm({
      title: `Excluir orçamento de ${budget.categoryName}?`,
      message: "O acompanhamento de gastos desta categoria será desativado.",
      confirmText: "Excluir orçamento",
      danger: true,
    });

    if (!confirmed) return;

    try {
      await deleteBudget(budget.id);
      toast.success("Orçamento excluído.");
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir orçamento.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Barra de ação do topo se tiver orçamentos */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">
          {budgets.length} {budgets.length === 1 ? "orçamento ativo" : "orçamentos ativos"}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={openCreateModal}
          iconLeft={<PlusIcon className="w-4 h-4" />}
        >
          Novo orçamento
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : budgets.length === 0 ? (
        <div className="bg-surface rounded-panel border border-border">
          <EmptyState
            title="Nenhum orçamento configurado"
            description="Defina limites mensais para suas categorias e acompanhe o ritmo de gastos."
            action={{
              label: "Criar primeiro orçamento",
              onClick: openCreateModal,
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {budgets.map((b) => {
            const cat = categoryMap[b.categoryId];
            const remaining = b.monthlyLimit - b.spent;

            return (
              <div
                key={b.id}
                className="bg-surface rounded-card p-6 shadow-sh1 border border-border flex flex-col justify-between gap-5 group hover:shadow-sh2 transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <CategoryTile
                      icon={cat?.icon}
                      colorKey={cat?.colorKey}
                      size="md"
                    />
                    <div className="min-w-0">
                      <h3 className="font-display font-bold text-sm md:text-base text-text-primary truncate">
                        {b.categoryName}
                      </h3>
                      <p className="text-caption text-text-secondary mt-0.5 tnum">
                        Limite de {formatCurrency(b.monthlyLimit)}
                      </p>
                    </div>
                  </div>

                  <Badge
                    variant={
                      b.status === "exceeded"
                        ? "danger"
                        : b.status === "warning"
                        ? "warning"
                        : "success"
                    }
                  >
                    {b.status === "exceeded"
                      ? "Estourado"
                      : b.status === "warning"
                      ? "Atenção"
                      : "Em dia"}
                  </Badge>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-caption font-semibold">
                    <span className="text-text-primary tnum">
                      {formatCurrency(b.spent)}
                    </span>
                    <span className="text-text-secondary tnum">
                      {Math.round(b.percentage)}%
                    </span>
                  </div>
                  <ProgressBar
                    value={b.spent}
                    max={b.monthlyLimit}
                    status={b.status}
                    size="md"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50 text-caption">
                  <span className="text-text-secondary tnum">
                    {remaining >= 0
                      ? `Resta ${formatCurrency(remaining)}`
                      : `Ultrapassou ${formatCurrency(Math.abs(remaining))}`}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      title="Editar orçamento"
                      aria-label={`Editar orçamento de ${b.categoryName}`}
                      onClick={() => openEditModal(b)}
                      className="tap-target text-text-disabled hover:text-primary transition-colors p-1 rounded-ctl focus-ring cursor-pointer"
                    >
                      <EditIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Excluir orçamento"
                      aria-label={`Excluir orçamento de ${b.categoryName}`}
                      onClick={() => handleDelete(b)}
                      className="tap-target text-text-disabled hover:text-error transition-colors p-1 rounded-ctl focus-ring cursor-pointer"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Novo / Editar Orçamento */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editing ? `Editar orçamento de ${editing.categoryName}` : "Novo orçamento"}
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="budget-form"
              variant="primary"
              size="sm"
              loading={saving}
            >
              {editing ? "Salvar alterações" : "Salvar orçamento"}
            </Button>
          </>
        }
      >
        <form id="budget-form" onSubmit={handleSaveBudget} className="flex flex-col gap-4">
          <Field id="b-cat" label="Categoria" required>
            {/* A categoria e a chave unica do orcamento: troca-la seria criar
                outro. Na edicao ela vira so leitura. */}
            <button
              id="b-cat"
              type="button"
              disabled={!!editing}
              onClick={() => setIsCategoryPickerOpen(true)}
              className={`w-full h-ctl px-3.5 flex items-center justify-between gap-2 rounded-ctl bg-surface-alt text-text-primary border border-border select-none transition-[border-color,box-shadow] duration-150 text-left text-sm ${
                editing
                  ? "opacity-70 cursor-not-allowed"
                  : "hover:border-border-strong focus-ring cursor-pointer"
              }`}
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
                    <span className="text-text-disabled font-normal">Selecione a categoria...</span>
                  </>
                )}
              </div>

              {!editing && (
                <span className="text-xs font-semibold text-primary hover:underline shrink-0">
                  Alterar
                </span>
              )}
            </button>

            <CategorySelectModal
              isOpen={isCategoryPickerOpen}
              onClose={() => setIsCategoryPickerOpen(false)}
              categories={categories}
              selectedCategoryId={categoryId || null}
              onSelectCategory={(id) => setCategoryId(id || "")}
              allowUncategorized={false}
            />
          </Field>

          <Field id="b-limit" label="Limite mensal" required>
            <CurrencyInput
              id="b-limit"
              value={monthlyLimit}
              onChange={setMonthlyLimit}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
