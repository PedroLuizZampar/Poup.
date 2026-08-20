import React, { useState, useEffect, useMemo, KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { TransactionDTO, CategoryDTO, AccountDTO } from "@poup/shared";
import { fetchTransactions, fetchCategories, fetchAccounts } from "../lib/api";
import { SearchIcon, FilterIcon, CloseIcon } from "../components/icons/Icons";
import { TableRowSkeleton } from "../components/common/Skeleton";
import { EmptyState } from "../components/common/EmptyState";
import { Select } from "../components/ui/Select";
import { CategoryTile } from "../components/ui/CategoryTile";
import { CategoryChip } from "../components/ui/CategoryChip";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Field } from "../components/ui/Field";
import { TransactionDetailModal } from "../components/transactions/TransactionDetailModal";
import { formatCurrency, formatDate } from "../lib/format";
import { useCategoryMap } from "../hooks/useCategories";
import { SuggestionsButton } from "../components/suggestions/SuggestionsButton";

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isUncategorizedParam = searchParams.get("uncategorized") === "true";

  const [transactions, setTransactions] = useState<TransactionDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>(
    isUncategorizedParam ? "UNCATEGORIZED" : "ALL"
  );
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [selectedTx, setSelectedTx] = useState<TransactionDTO | null>(null);
  /** No mobile os três selects moram numa folha só, atrás de um botão. */
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // Debounce da busca (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function loadData() {
    try {
      setLoading(true);
      const isUncat = categoryFilter === "UNCATEGORIZED";
      const actualCatId =
        categoryFilter === "ALL" || isUncat ? undefined : categoryFilter;

      const [txs, cats, accs] = await Promise.all([
        fetchTransactions({
          search: debouncedSearch.trim() || undefined,
          type: typeFilter === "ALL" ? undefined : (typeFilter as any),
          categoryId: actualCatId,
          uncategorized: isUncat || undefined,
          accountId: accountFilter === "ALL" ? undefined : accountFilter,
        }),
        fetchCategories(),
        fetchAccounts(),
      ]);

      setTransactions(txs);
      setCategories(cats);
      setAccounts(accs);
    } catch (err) {
      console.error("Erro ao carregar transações:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [debouncedSearch, typeFilter, categoryFilter, accountFilter]);

  const categoryMap = useCategoryMap(categories);
  // O mapa precisa de todas para desenhar o chip "Transferência entre contas";
  // nenhum seletor deve oferecê-la.
  const selectableCategories = useMemo(
    () => categories.filter((c) => !c.systemKey),
    [categories]
  );

  // Opções para o Select de Categorias
  const categoryOptions = useMemo(() => {
    const base = [
      { value: "ALL", label: "Todas as categorias" },
      { value: "UNCATEGORIZED", label: "Sem categoria" },
    ];
    const items = selectableCategories.map((c) => ({
      value: c.id,
      label: c.name,
    }));
    return [...base, ...items];
  }, [selectableCategories]);

  // Opções para o Select de Contas
  const accountOptions = useMemo(() => {
    const base = [{ value: "ALL", label: "Todas as contas" }];
    const items = accounts.map((a) => ({
      value: a.id,
      label: a.name,
    }));
    return [...base, ...items];
  }, [accounts]);

  // Checagem de filtros ativos
  const hasActiveFilters =
    debouncedSearch !== "" ||
    typeFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    accountFilter !== "ALL";

  /** Só os três selects — a busca tem afordância própria e não entra na conta. */
  const sheetFilterCount = [typeFilter, categoryFilter, accountFilter].filter(
    (f) => f !== "ALL"
  ).length;

  function handleClearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setTypeFilter("ALL");
    setCategoryFilter("ALL");
    setAccountFilter("ALL");
    setSearchParams({});
  }

  function handleRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, tx: TransactionDTO) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedTx(tx);
    }
  }

  const accountSelect = (
    <Select
      size="md"
      value={accountFilter}
      onChange={setAccountFilter}
      options={accountOptions}
      aria-label="Conta"
    />
  );

  const typeSelect = (
    <Select
      size="md"
      value={typeFilter}
      onChange={setTypeFilter}
      options={[
        { value: "ALL", label: "Todos os tipos" },
        { value: "EXPENSE", label: "Despesas" },
        { value: "INCOME", label: "Receitas" },
      ]}
      aria-label="Tipo"
    />
  );

  const categorySelect = (
    <Select
      size="md"
      value={categoryFilter}
      onChange={setCategoryFilter}
      options={categoryOptions}
      aria-label="Categoria"
      renderOption={(opt) => {
        if (opt.value === "ALL" || opt.value === "UNCATEGORIZED") {
          return <span>{opt.label}</span>;
        }
        const cat = categoryMap[opt.value];
        return (
          <div className="flex items-center gap-2">
            <CategoryTile icon={cat?.icon} colorKey={cat?.colorKey} size="sm" />
            <span className="truncate">{opt.label}</span>
          </div>
        );
      }}
    />
  );

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      {/* Header */}
      <div className="flex flex-row items-start justify-between gap-4">
        <div>
          <h1 className="text-display-xl font-display font-extrabold text-text-primary">
            Transações
          </h1>
          <p className="text-xs md:text-sm text-text-secondary mt-0.5">
            Visualize e categorize suas movimentações financeiras
          </p>
        </div>
        <SuggestionsButton />
      </div>

      {/* Barra de Filtros */}
      <div className="bg-surface rounded-panel p-4 shadow-sh1 border border-border flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3">
          {/* Busca com Debounce. No mobile ocupa a linha inteira. */}
          <div className="flex-1 w-full md:min-w-[240px] relative">
            <SearchIcon className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por descrição ou observação..."
              aria-label="Buscar transações"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-ctl pl-10 pr-10 rounded-ctl bg-surface-alt text-xs text-text-primary placeholder:text-text-disabled border border-border hover:border-border-strong focus-ring transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                className="tap-target absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary cursor-pointer focus-ring"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Selects — inline a partir de `md`. Abaixo disso três caixas de
              larguras diferentes, centralizadas e sem alinhamento entre si; a
              folha de filtros resolve com uma coluna só. */}
          <div className="hidden md:flex items-center gap-2.5 flex-wrap">
            <div className="w-52">{accountSelect}</div>
            <div className="w-44">{typeSelect}</div>
            <div className="w-56">{categorySelect}</div>
          </div>

          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => setIsFilterSheetOpen(true)}
            className="md:hidden"
            iconLeft={<FilterIcon className="w-4 h-4" />}
          >
            Filtros
            {sheetFilterCount > 0 && (
              <span className="ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold inline-flex items-center justify-center tnum">
                {sheetFilterCount}
              </span>
            )}
          </Button>
        </div>

        {/* Chips de Filtros Ativos */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/50 text-xs">
            <span className="text-text-secondary font-medium flex items-center gap-1">
              <FilterIcon className="w-3.5 h-3.5" /> Filtros ativos:
            </span>

            {debouncedSearch && (
              <span className="px-2 py-0.5 rounded-chip bg-surface-alt border border-border text-text-primary flex items-center gap-1 max-w-full">
                <span className="truncate">Busca: "{debouncedSearch}"</span>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Remover filtro de busca"
                  className="tap-target hover:text-error ml-1 shrink-0"
                >
                  ✕
                </button>
              </span>
            )}

            {accountFilter !== "ALL" && (
              <span className="px-2 py-0.5 rounded-chip bg-surface-alt border border-border text-text-primary flex items-center gap-1 max-w-full">
                <span className="truncate">
                  Conta: {accounts.find((a) => a.id === accountFilter)?.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAccountFilter("ALL")}
                  aria-label="Remover filtro de conta"
                  className="tap-target hover:text-error ml-1 shrink-0"
                >
                  ✕
                </button>
              </span>
            )}

            {typeFilter !== "ALL" && (
              <span className="px-2 py-0.5 rounded-chip bg-surface-alt border border-border text-text-primary flex items-center gap-1">
                Tipo: {typeFilter === "EXPENSE" ? "Despesas" : "Receitas"}
                <button
                  type="button"
                  onClick={() => setTypeFilter("ALL")}
                  aria-label="Remover filtro de tipo"
                  className="tap-target hover:text-error ml-1 shrink-0"
                >
                  ✕
                </button>
              </span>
            )}

            {categoryFilter !== "ALL" && (
              <span className="px-2 py-0.5 rounded-chip bg-surface-alt border border-border text-text-primary flex items-center gap-1 max-w-full">
                <span className="truncate">
                  Categoria:{" "}
                  {categoryFilter === "UNCATEGORIZED"
                    ? "Sem categoria"
                    : categories.find((c) => c.id === categoryFilter)?.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter("ALL");
                    setSearchParams({});
                  }}
                  aria-label="Remover filtro de categoria"
                  className="tap-target hover:text-error ml-1 shrink-0"
                >
                  ✕
                </button>
              </span>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="text-primary ml-auto"
            >
              Limpar todos
            </Button>
          </div>
        )}
      </div>

      {/* Lista de Transações */}
      <div className="bg-surface rounded-panel shadow-sh2 border border-border overflow-hidden">
        {loading ? (
          <div className="flex flex-col p-4">
            <TableRowSkeleton />
            <TableRowSkeleton />
            <TableRowSkeleton />
            <TableRowSkeleton />
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            title="Nenhuma transação encontrada"
            description="Não encontramos nenhuma movimentação com os filtros selecionados."
            action={
              hasActiveFilters
                ? {
                    label: "Limpar filtros",
                    onClick: handleClearFilters,
                  }
                : undefined
            }
          />
        ) : (
          <>
            {/* Mobile: lista de cards.
                As cinco colunas da tabela somam ≈700px de largura mínima — no
                celular isso vira um card que rola na horizontal dentro de uma
                página que rola na vertical, que é a interação que mais confunde
                no toque. Aqui a linha inteira é um único alvo. */}
            <ul className="md:hidden divide-y divide-border">
              {transactions.map((tx) => {
                const cat = tx.categoryId ? categoryMap[tx.categoryId] : null;
                return (
                  <li key={tx.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTx(tx)}
                      className="w-full text-left px-4 py-3.5 flex flex-col gap-2 active:bg-surface-alt transition-colors focus-ring cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <CategoryTile
                            icon={cat?.icon}
                            colorKey={cat?.colorKey}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-text-primary truncate">
                              {tx.description}
                            </div>
                            {tx.note && (
                              <div className="text-[11px] text-text-disabled truncate">
                                {tx.note}
                              </div>
                            )}
                          </div>
                        </div>

                        {cat ? (
                          <CategoryChip
                            name={cat.name}
                            icon={cat.icon}
                            colorKey={cat.colorKey}
                            size="sm"
                            className="shrink-0 max-w-[40%]"
                          />
                        ) : (
                          <span className="shrink-0 text-caption font-semibold px-2 py-0.5 rounded-chip bg-warning-soft border border-warning/30 text-warning">
                            Sem categoria
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between gap-3 pl-10">
                        <span className="text-caption text-text-secondary truncate tnum">
                          {formatDate(tx.date)}{" "}
                          <span aria-hidden="true">·</span>{" "}
                          {tx.accountName || "Principal"}
                        </span>
                        <span
                          className={`font-display font-bold text-sm shrink-0 tnum ${
                            tx.type === "INCOME" ? "text-income" : "text-expense"
                          }`}
                        >
                          {tx.type === "INCOME" ? "+ " : "- "}
                          {formatCurrency(tx.amount)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: a tabela segue exatamente como estava. */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border text-overline font-semibold text-text-secondary uppercase tracking-wider bg-surface-alt/40">
                    <th className="py-3 px-6">Descrição</th>
                    <th className="py-3 px-6">Categoria</th>
                    <th className="py-3 px-6">Data</th>
                    <th className="py-3 px-6">Conta</th>
                    <th className="py-3 px-6 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-body-sm">
                  {transactions.map((tx) => {
                    const cat = tx.categoryId ? categoryMap[tx.categoryId] : null;
                    return (
                      <tr
                        key={tx.id}
                        tabIndex={0}
                        onClick={() => setSelectedTx(tx)}
                        onKeyDown={(e) => handleRowKeyDown(e, tx)}
                        className="hover:bg-surface-alt/60 transition-colors cursor-pointer focus-ring"
                      >
                        <td className="py-3.5 px-6">
                          <div className="flex items-center gap-3">
                            <CategoryTile
                              icon={cat?.icon}
                              colorKey={cat?.colorKey}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-xs md:text-sm text-text-primary truncate">
                                {tx.description}
                              </div>
                              {tx.note && (
                                <div className="text-[11px] text-text-disabled truncate">
                                  {tx.note}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-6">
                          {cat ? (
                            <CategoryChip
                              name={cat.name}
                              icon={cat.icon}
                              colorKey={cat.colorKey}
                            />
                          ) : (
                            <span className="text-caption font-semibold px-2.5 py-1 rounded-chip bg-warning-soft border border-warning/30 text-warning">
                              Sem categoria
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-6 text-text-secondary text-caption tnum">
                          {formatDate(tx.date)}
                        </td>

                        <td className="py-3.5 px-6 text-text-secondary text-caption truncate max-w-[140px]">
                          {tx.accountName || "Principal"}
                        </td>

                        <td
                          className={`py-3.5 px-6 text-right font-display font-bold text-xs md:text-sm tnum ${
                            tx.type === "INCOME" ? "text-income" : "text-expense"
                          }`}
                        >
                          {tx.type === "INCOME" ? "+ " : "- "}
                          {formatCurrency(tx.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Folha de filtros — só existe no mobile. O `Modal` já sobe do rodapé
          abaixo de `sm`, com safe area e trava de foco. */}
      <Modal
        isOpen={isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        title="Filtros"
        maxWidth="md"
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setTypeFilter("ALL");
                setCategoryFilter("ALL");
                setAccountFilter("ALL");
                setSearchParams({});
              }}
              disabled={sheetFilterCount === 0}
            >
              Limpar
            </Button>
            <Button variant="primary" size="md" onClick={() => setIsFilterSheetOpen(false)}>
              Ver resultados
            </Button>
          </>
        }
      >
        <Field label="Conta">{accountSelect}</Field>
        <Field label="Tipo">{typeSelect}</Field>
        <Field label="Categoria">{categorySelect}</Field>
      </Modal>

      {/* Modal Detalhe de Transação */}
      <TransactionDetailModal
        transaction={selectedTx}
        categories={categories}
        onClose={() => setSelectedTx(null)}
        onUpdated={(updated) => {
          setTransactions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        }}
      />
    </div>
  );
}
