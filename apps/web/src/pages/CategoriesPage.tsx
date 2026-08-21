import React, { useState, useEffect, useMemo } from "react";
import type { CategoryDTO, TransactionDTO, BudgetDTO } from "@poup/shared";
import {
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  fetchTransactions,
  fetchBudgets,
} from "../lib/api";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { CategoryTile } from "../components/ui/CategoryTile";
import { ProgressBar } from "../components/ui/ProgressBar";
import { CategoryFormModal } from "../components/categories/CategoryFormModal";
import { EmptyState } from "../components/common/EmptyState";
import { CardSkeleton } from "../components/common/Skeleton";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { useToast } from "../components/ui/Toast";
import { useCoarsePointer } from "../hooks/useMediaQuery";
import { formatCurrency } from "../lib/format";
import { getCurrentMonthStr } from "../lib/date";
import { Money } from "../components/ui/Money";

export function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [transactions, setTransactions] = useState<TransactionDTO[]>([]);
  const [budgets, setBudgets] = useState<BudgetDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<"spent" | "name" | "count" | "created">("spent");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDTO | null>(null);

  const confirm = useConfirm();
  const toast = useToast();
  const currentMonthStr = getCurrentMonthStr();
  /**
   * No dedo o card inteiro deixa de ser clicável. Antes havia dois botões de
   * 28px com `stopPropagation` dentro de um alvo maior que também abria o
   * modal: no mouse funciona, no toque a chance de abrir a ação errada é alta.
   */
  const isCoarse = useCoarsePointer();

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [cats, txs, bdgs] = await Promise.all([
        fetchCategories(),
        fetchTransactions({ month: currentMonthStr }),
        fetchBudgets(currentMonthStr).catch(() => []),
      ]);
      // As de sistema o Poup mantém sozinho: não se editam, não se excluem e
      // não recebem orçamento, então não têm o que fazer nesta grade.
      setCategories(cats.filter((c) => !c.systemKey));
      setTransactions(txs);
      setBudgets(bdgs);
    } catch (err: any) {
      setError(err.message || "Não foi possível carregar as categorias.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Agrega estatísticas por categoria para o mês atual
  const categoryStats = useMemo(() => {
    const stats: Record<
      string,
      { spent: number; txCount: number; budget?: BudgetDTO }
    > = {};

    categories.forEach((cat) => {
      stats[cat.id] = { spent: 0, txCount: 0 };
    });

    transactions.forEach((tx) => {
      if (tx.categoryId && stats[tx.categoryId]) {
        if (tx.type === "EXPENSE") {
          stats[tx.categoryId].spent += tx.amount;
        }
        stats[tx.categoryId].txCount += 1;
      }
    });

    budgets.forEach((b) => {
      if (stats[b.categoryId]) {
        stats[b.categoryId].budget = b;
      }
    });

    return stats;
  }, [categories, transactions, budgets]);

  // Ordenação das categorias
  const sortedCategories = useMemo(() => {
    const list = [...categories];
    switch (sortBy) {
      case "spent":
        return list.sort(
          (a, b) => (categoryStats[b.id]?.spent || 0) - (categoryStats[a.id]?.spent || 0)
        );
      case "count":
        return list.sort(
          (a, b) => (categoryStats[b.id]?.txCount || 0) - (categoryStats[a.id]?.txCount || 0)
        );
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      case "created":
      default:
        return list;
    }
  }, [categories, sortBy, categoryStats]);

  // Métricas do resumo
  const totalCategories = categories.length;
  const categoriesWithSpending = Object.values(categoryStats).filter((s) => s.spent > 0).length;
  const unusedCategories = Object.values(categoryStats).filter((s) => s.txCount === 0).length;
  const topSpendingCategory = useMemo<{ name: string; spent: number } | null>(() => {
    let topCat: { name: string; spent: number } | null = null;
    categories.forEach((cat) => {
      const spent = categoryStats[cat.id]?.spent || 0;
      if (!topCat || spent > topCat.spent) {
        if (spent > 0) topCat = { name: cat.name, spent };
      }
    });
    return topCat;
  }, [categories, categoryStats]);

  async function handleDelete(category: CategoryDTO) {
    const stat = categoryStats[category.id];
    const txCount = stat?.txCount || 0;
    const hasBudget = !!stat?.budget;

    let messageLines: string[] = [];
    if (txCount > 0) {
      messageLines.push(
        `${txCount} ${txCount === 1 ? "transação ficará" : "transações ficarão"} sem categoria.`
      );
    }
    if (hasBudget) {
      messageLines.push(
        `O orçamento de ${formatCurrency(stat.budget!.monthlyLimit)}/mês vinculado a ela será excluído.`
      );
    }
    messageLines.push("Esta ação não pode ser desfeita.");

    const confirmed = await confirm({
      title: `Excluir a categoria "${category.name}"?`,
      message: messageLines.join("\n"),
      confirmText: "Excluir categoria",
      danger: true,
    });

    if (!confirmed) return;

    try {
      await deleteCategory(category.id);
      toast.success(`Categoria "${category.name}" excluída.`);
      setCategories((prev) => prev.filter((c) => c.id !== category.id));
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir categoria.");
    }
  }

  async function handleSaveCategory(
    data: { name: string; icon: string; colorKey: string },
    id?: string
  ): Promise<CategoryDTO> {
    if (id) {
      return updateCategory(id, data);
    }
    return createCategory(data);
  }

  function handleCategorySaved(saved: CategoryDTO) {
    setCategories((prev) => {
      const exists = prev.some((c) => c.id === saved.id);
      if (exists) {
        return prev.map((c) => (c.id === saved.id ? saved : c));
      }
      return [...prev, saved];
    });
  }

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-xl font-display font-extrabold text-text-primary">
            Categorias
          </h1>
          <p className="text-xs md:text-sm text-text-secondary mt-1">
            {totalCategories} categorias · {unusedCategories} sem movimentação este mês
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => {
            setEditingCategory(null);
            setIsModalOpen(true);
          }}
          iconLeft={
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
        >
          Nova categoria
        </Button>
      </div>

      {/* Faixa de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-surface rounded-card p-5 border border-border shadow-sh1 flex flex-col gap-1">
          <span className="text-overline uppercase tracking-wider text-text-secondary">
            Total cadastradas
          </span>
          <span className="text-num-xl font-display font-extrabold text-text-primary tnum">
            {totalCategories}
          </span>
        </div>

        <div className="bg-surface rounded-card p-5 border border-border shadow-sh1 flex flex-col gap-1">
          <span className="text-overline uppercase tracking-wider text-text-secondary">
            Com gasto no mês
          </span>
          <span className="text-num-xl font-display font-extrabold text-text-primary tnum">
            {categoriesWithSpending}
          </span>
        </div>

        <div className="bg-surface rounded-card p-5 border border-border shadow-sh1 flex flex-col gap-1">
          <span className="text-overline uppercase tracking-wider text-text-secondary">
            Maior gasto este mês
          </span>
          <span className="text-num-lg font-display font-bold text-text-primary truncate tnum">
            {topSpendingCategory ? (
              <>
                {topSpendingCategory.name} (<Money value={topSpendingCategory.spent} />)
              </>
            ) : (
              "Nenhum gasto"
            )}
          </span>
        </div>
      </div>

      {/* Barra de Ordenação */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-xs font-semibold text-text-secondary">
          Lista de categorias ({sortedCategories.length})
        </span>

        <div className="w-full sm:w-48">
          <Select
            size="sm"
            value={sortBy}
            onChange={(val) => setSortBy(val as any)}
            options={[
              { value: "spent", label: "Maior gasto" },
              { value: "count", label: "Mais usadas" },
              { value: "name", label: "Nome (A-Z)" },
              { value: "created", label: "Ordem de criação" },
            ]}
          />
        </div>
      </div>

      {/* Conteúdo: Loading, Erro, Vazio ou Grade */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <EmptyState
          title="Erro ao carregar categorias"
          description={error}
          action={{
            label: "Tentar novamente",
            onClick: loadData,
          }}
        />
      ) : sortedCategories.length === 0 ? (
        <EmptyState
          title="Nenhuma categoria encontrada"
          description="Crie categorias personalizadas para organizar suas finanças."
          action={{
            label: "Criar primeira categoria",
            onClick: () => {
              setEditingCategory(null);
              setIsModalOpen(true);
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedCategories.map((cat) => {
            const stat = categoryStats[cat.id];
            const spent = stat?.spent || 0;
            const txCount = stat?.txCount || 0;
            const budget = stat?.budget;
            const percentage = budget ? Math.round(budget.percentage) : 0;

            return (
              <div
                key={cat.id}
                onClick={
                  isCoarse
                    ? undefined
                    : () => {
                        setEditingCategory(cat);
                        setIsModalOpen(true);
                      }
                }
                className={`group bg-surface rounded-card p-5 border border-border shadow-sh1 transition-all duration-150 flex flex-col justify-between gap-4 ${
                  isCoarse ? "" : "cursor-pointer hover:shadow-sh2 hover:-translate-y-0.5"
                }`}
              >
                {/* Top: Tile + Nome + Ações */}
                <div className="flex items-start justify-between gap-3">
                  {/* O bloco de identidade é o alvo explícito de edição — e, de
                      quebra, o primeiro caminho de teclado até o modal: o card
                      com `onClick` num `div` nunca recebeu foco. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCategory(cat);
                      setIsModalOpen(true);
                    }}
                    className="flex items-center gap-3 min-w-0 text-left -m-1 p-1 rounded-tile focus-ring cursor-pointer"
                  >
                    <CategoryTile icon={cat.icon} colorKey={cat.colorKey} size="lg" />
                    <span className="min-w-0">
                      <span className="block font-display font-bold text-sm md:text-base text-text-primary truncate">
                        {cat.name}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {txCount} {txCount === 1 ? "transação" : "transações"}
                      </span>
                    </span>
                  </button>

                  {/* Ações Rápidas. O `gap-3` existe porque os alvos de toque de
                      44px se estendem 8px para fora de cada ícone de 28px. */}
                  <div className="flex items-center gap-3 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title="Editar categoria"
                      aria-label={`Editar a categoria ${cat.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCategory(cat);
                        setIsModalOpen(true);
                      }}
                      className="tap-target w-7 h-7 rounded-ctl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors focus-ring cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="Excluir categoria"
                      aria-label={`Excluir a categoria ${cat.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(cat);
                      }}
                      className="tap-target w-7 h-7 rounded-ctl flex items-center justify-center text-text-secondary hover:text-error hover:bg-error-soft transition-colors focus-ring cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Bottom: Gasto no Mês e Orçamento Vinculado */}
                <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-text-secondary font-medium">Gasto no mês</span>
                    <span className="font-display font-bold text-sm text-text-primary tnum">
                      <Money value={spent} />
                    </span>
                  </div>

                  {budget && (
                    <div className="flex flex-col gap-1 mt-1">
                      <div className="flex items-center justify-between text-[11px] text-text-secondary">
                        <span>{percentage}% do limite</span>
                        <span className="tnum font-medium">
                          <Money value={budget.monthlyLimit} />
                        </span>
                      </div>
                      <ProgressBar
                        value={budget.spent}
                        max={budget.monthlyLimit}
                        status={budget.status}
                        size="sm"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Criar / Editar */}
      <CategoryFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingCategory(null);
        }}
        categoryToEdit={editingCategory}
        existingCategories={categories}
        onSaved={handleCategorySaved}
        onSaveCategory={handleSaveCategory}
      />
    </div>
  );
}
