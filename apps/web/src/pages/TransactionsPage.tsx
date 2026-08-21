import React, { useState, useEffect, useMemo, useRef, KeyboardEvent } from "react";
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
import { CurrencyInput } from "../components/ui/CurrencyInput";
import { InstitutionLogo } from "../components/ui/InstitutionLogo";
import { TransactionDetailModal } from "../components/transactions/TransactionDetailModal";
import { formatCurrency, formatDate } from "../lib/format";
import { useCategoryMap } from "../hooks/useCategories";
import { displayCategory } from "../lib/categories";
import { SuggestionsButton } from "../components/suggestions/SuggestionsButton";
import { Money } from "../components/ui/Money";

/** "2026-08-20" -> "20/08/2026". Sem passar por Date: o input entrega o dia
 *  já no fuso do usuário, e reinterpretá-lo em UTC o atrasaria em um. */
function formatDay(day: string): string {
  const [year, month, dayOfMonth] = day.split("-");
  return `${dayOfMonth}/${month}/${year}`;
}

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
  /** Intervalo de datas, "YYYY-MM-DD". String vazia = sem limite. */
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  /** Faixa de valor, em reais. Zero = sem limite (é o vazio do CurrencyInput). */
  const [minAmount, setMinAmount] = useState(0);
  const [maxAmount, setMaxAmount] = useState(0);
  const [debouncedMinAmount, setDebouncedMinAmount] = useState(0);
  const [debouncedMaxAmount, setDebouncedMaxAmount] = useState(0);
  const [selectedTx, setSelectedTx] = useState<TransactionDTO | null>(null);
  /** No mobile os filtros moram numa folha só, atrás de um botão. */
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  /** No desktop, os mesmos filtros num popover ancorado ao botão de ícone. */
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);

  // Debounce da busca (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A faixa de valor é digitada dígito a dígito: sem esperar, "1500" dispararia
  // quatro buscas — a última delas a única que o usuário quis.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedMinAmount(minAmount);
      setDebouncedMaxAmount(maxAmount);
    }, 400);
    return () => clearTimeout(timer);
  }, [minAmount, maxAmount]);

  // O popover fecha como qualquer menu: clique fora ou Esc. Sem isso ele ficaria
  // aberto sobre a lista que o próprio filtro acabou de mudar.
  useEffect(() => {
    if (!isFilterPopoverOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      // A folha de opções do Select mora num portal: está fora do popover na
      // árvore do DOM, mas é parte dele para o usuário.
      if (target.closest?.("[data-select-sheet]")) return;
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(target)) {
        setIsFilterPopoverOpen(false);
      }
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsFilterPopoverOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isFilterPopoverOpen]);

  /** Faixas invertidas não viram busca: não há resultado possível. */
  const dateRangeInvalid = Boolean(startDate && endDate && startDate > endDate);
  const amountRangeInvalid =
    debouncedMinAmount > 0 && debouncedMaxAmount > 0 && debouncedMinAmount > debouncedMaxAmount;

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
          startDate: dateRangeInvalid ? undefined : startDate || undefined,
          endDate: dateRangeInvalid ? undefined : endDate || undefined,
          minAmount:
            amountRangeInvalid || debouncedMinAmount <= 0 ? undefined : debouncedMinAmount,
          maxAmount:
            amountRangeInvalid || debouncedMaxAmount <= 0 ? undefined : debouncedMaxAmount,
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
  }, [
    debouncedSearch,
    typeFilter,
    categoryFilter,
    accountFilter,
    startDate,
    endDate,
    debouncedMinAmount,
    debouncedMaxAmount,
  ]);

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

  const accountById = useMemo(() => {
    const map: Record<string, AccountDTO> = {};
    for (const account of accounts) map[account.id] = account;
    return map;
  }, [accounts]);

  const hasDateFilter = Boolean(startDate || endDate);
  const hasAmountFilter = minAmount > 0 || maxAmount > 0;

  // Checagem de filtros ativos
  const hasActiveFilters =
    debouncedSearch !== "" ||
    typeFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    accountFilter !== "ALL" ||
    hasDateFilter ||
    hasAmountFilter;

  /** Tudo menos a busca, que tem afordância própria e não entra na conta. */
  const sheetFilterCount =
    [typeFilter, categoryFilter, accountFilter].filter((f) => f !== "ALL").length +
    (hasDateFilter ? 1 : 0) +
    (hasAmountFilter ? 1 : 0);

  function clearSelectFilters() {
    setTypeFilter("ALL");
    setCategoryFilter("ALL");
    setAccountFilter("ALL");
    clearDateFilter();
    clearAmountFilter();
    setSearchParams({});
  }

  function clearDateFilter() {
    setStartDate("");
    setEndDate("");
  }

  function clearAmountFilter() {
    setMinAmount(0);
    setMaxAmount(0);
    setDebouncedMinAmount(0);
    setDebouncedMaxAmount(0);
  }

  function handleClearFilters() {
    setSearch("");
    setDebouncedSearch("");
    clearSelectFilters();
  }

  function handleRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, tx: TransactionDTO) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedTx(tx);
    }
  }

  /* A logo aparece só aqui: numa lista de "Conta Corrente", "Conta Corrente" e
     "Poupança", o nome sozinho não diz de que banco é cada uma. */
  const accountSelect = (
    <Select
      size="md"
      value={accountFilter}
      onChange={setAccountFilter}
      options={accountOptions}
      aria-label="Conta"
      renderOption={(opt) => {
        const account = accountById[opt.value];
        if (!account) return <span className="truncate">{opt.label}</span>;
        return (
          <span className="flex items-center gap-2 min-w-0">
            <InstitutionLogo
              size="xs"
              name={account.institutionName}
              imageUrl={account.institutionImageUrl}
              customImageUrl={account.customImageUrl}
            />
            <span className="truncate">{opt.label}</span>
          </span>
        );
      }}
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

  const dateRangeFields = (
    <div className="flex items-center gap-2">
      <input
        type="date"
        aria-label="Data inicial"
        value={startDate}
        max={endDate || undefined}
        onChange={(e) => setStartDate(e.target.value)}
        className={`w-full h-ctl px-3 rounded-ctl bg-surface-alt text-xs text-text-primary border focus-ring transition-colors tnum ${
          dateRangeInvalid
            ? "border-error"
            : "border-border hover:border-border-strong"
        }`}
      />
      <span className="text-xs text-text-secondary shrink-0">até</span>
      <input
        type="date"
        aria-label="Data final"
        value={endDate}
        min={startDate || undefined}
        onChange={(e) => setEndDate(e.target.value)}
        className={`w-full h-ctl px-3 rounded-ctl bg-surface-alt text-xs text-text-primary border focus-ring transition-colors tnum ${
          dateRangeInvalid
            ? "border-error"
            : "border-border hover:border-border-strong"
        }`}
      />
    </div>
  );

  const amountRangeFields = (
    <div className="flex items-center gap-2">
      <CurrencyInput
        value={minAmount}
        onChange={setMinAmount}
        placeholder="Mínimo"
        hasError={amountRangeInvalid}
      />
      <span className="text-xs text-text-secondary shrink-0">até</span>
      <CurrencyInput
        value={maxAmount}
        onChange={setMaxAmount}
        placeholder="Máximo"
        hasError={amountRangeInvalid}
      />
    </div>
  );

  /* Os mesmos cinco campos, na mesma ordem, nos dois lugares que os mostram: a
     folha do mobile e o popover do desktop. Antes o desktop tinha um arranjo
     próprio — três selects numa linha e mais dois campos largos noutra — que
     ocupava metade da tela acima da lista e ainda assim não cabia por inteiro. */
  const filterFields = (
    <div className="flex flex-col gap-4">
      <Field label="Conta">{accountSelect}</Field>
      <Field label="Tipo">{typeSelect}</Field>
      <Field label="Categoria">{categorySelect}</Field>
      <Field
        label="Período"
        error={dateRangeInvalid ? "A data inicial vem depois da final." : undefined}
      >
        {dateRangeFields}
      </Field>
      <Field
        label="Faixa de valor"
        error={amountRangeInvalid ? "O valor mínimo é maior que o máximo." : undefined}
      >
        {amountRangeFields}
      </Field>
    </div>
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

          {/* Desktop: um botão só, do tamanho de um ícone, e os filtros num
              popover. Os chips logo abaixo continuam dizendo o que está ativo —
              é deles o trabalho de mostrar estado, não de cinco caixas
              permanentes. */}
          <div ref={filterPopoverRef} className="hidden md:block relative shrink-0">
            <button
              type="button"
              onClick={() => setIsFilterPopoverOpen((open) => !open)}
              title="Filtros"
              aria-label="Filtros"
              aria-expanded={isFilterPopoverOpen}
              aria-haspopup="dialog"
              className={`w-11 h-ctl rounded-ctl border flex items-center justify-center relative transition-colors focus-ring cursor-pointer ${
                isFilterPopoverOpen || sheetFilterCount > 0
                  ? "bg-primary-soft border-primary/40 text-primary"
                  : "bg-surface-alt border-border hover:border-border-strong text-text-secondary hover:text-text-primary"
              }`}
            >
              <FilterIcon className="w-4 h-4" />
              {sheetFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold inline-flex items-center justify-center tnum border-2 border-surface">
                  {sheetFilterCount}
                </span>
              )}
            </button>

            {isFilterPopoverOpen && (
              <div
                role="dialog"
                aria-label="Filtros"
                className="absolute right-0 mt-2 w-[360px] rounded-card bg-surface p-4 shadow-sh3 border border-border anim-fade-down z-50 flex flex-col gap-4"
              >
                {filterFields}
                <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelectFilters}
                    disabled={sheetFilterCount === 0}
                  >
                    Limpar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setIsFilterPopoverOpen(false)}
                  >
                    Ver resultados
                  </Button>
                </div>
              </div>
            )}
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

            {hasDateFilter && (
              <span className="px-2 py-0.5 rounded-chip bg-surface-alt border border-border text-text-primary flex items-center gap-1 max-w-full">
                <span className="truncate tnum">
                  {startDate && endDate
                    ? `Período: ${formatDay(startDate)} – ${formatDay(endDate)}`
                    : startDate
                      ? `A partir de ${formatDay(startDate)}`
                      : `Até ${formatDay(endDate)}`}
                </span>
                <button
                  type="button"
                  onClick={clearDateFilter}
                  aria-label="Remover filtro de período"
                  className="tap-target hover:text-error ml-1 shrink-0"
                >
                  ✕
                </button>
              </span>
            )}

            {hasAmountFilter && (
              <span className="px-2 py-0.5 rounded-chip bg-surface-alt border border-border text-text-primary flex items-center gap-1 max-w-full">
                <span className="truncate tnum">
                  {minAmount > 0 && maxAmount > 0
                    ? `Valor: ${formatCurrency(minAmount)} – ${formatCurrency(maxAmount)}`
                    : minAmount > 0
                      ? `Valor a partir de ${formatCurrency(minAmount)}`
                      : `Valor até ${formatCurrency(maxAmount)}`}
                </span>
                <button
                  type="button"
                  onClick={clearAmountFilter}
                  aria-label="Remover filtro de valor"
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
                const cat = displayCategory(tx.categoryId ? categoryMap[tx.categoryId] : null);
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
                          <Money value={tx.amount} />
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
                    {/* `w-full` na descrição + `w-px whitespace-nowrap` nas
                        demais: quem cede espaço quando a tabela aperta é o
                        texto da descrição, que trunca, e não o valor, que
                        quebrava em duas linhas ("+" numa, o número na outra). */}
                    <th className="py-3 px-6 w-full">Descrição</th>
                    <th className="py-3 px-6 w-px whitespace-nowrap">Categoria</th>
                    <th className="py-3 px-6 w-px whitespace-nowrap">Data</th>
                    <th className="py-3 px-6 w-px whitespace-nowrap">Conta</th>
                    <th className="py-3 px-6 w-px whitespace-nowrap text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-body-sm">
                  {transactions.map((tx) => {
                    const cat = displayCategory(
                      tx.categoryId ? categoryMap[tx.categoryId] : null
                    );
                    return (
                      <tr
                        key={tx.id}
                        tabIndex={0}
                        onClick={() => setSelectedTx(tx)}
                        onKeyDown={(e) => handleRowKeyDown(e, tx)}
                        className="hover:bg-surface-alt/60 transition-colors cursor-pointer focus-ring"
                      >
                        <td className="py-3.5 px-6 max-w-0">
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

                        <td className="py-3.5 px-6 whitespace-nowrap">
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

                        <td className="py-3.5 px-6 text-text-secondary text-caption whitespace-nowrap tnum">
                          {formatDate(tx.date)}
                        </td>

                        <td className="py-3.5 px-6 text-text-secondary text-caption max-w-[140px]">
                          <span className="block truncate">
                            {tx.accountName || "Principal"}
                          </span>
                        </td>

                        <td
                          className={`py-3.5 px-6 text-right font-display font-bold text-xs md:text-sm whitespace-nowrap tnum ${
                            tx.type === "INCOME" ? "text-income" : "text-expense"
                          }`}
                        >
                          {tx.type === "INCOME" ? "+ " : "- "}
                          <Money value={tx.amount} />
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
              onClick={clearSelectFilters}
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
        {filterFields}
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
