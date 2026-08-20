import React, { useState, useMemo } from "react";
import type { CategoryDTO } from "@poup/shared";
import { Modal } from "../ui/Modal";
import { CategoryTile } from "../ui/CategoryTile";
import { SearchIcon, CheckIcon } from "../icons/Icons";

export interface CategorySelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CategoryDTO[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  title?: string;
  allowUncategorized?: boolean;
}

export function CategorySelectModal({
  isOpen,
  onClose,
  categories,
  selectedCategoryId,
  onSelectCategory,
  title = "Selecionar categoria",
  allowUncategorized = true,
}: CategorySelectModalProps) {
  const [search, setSearch] = useState("");

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, search]);

  function handleSelect(id: string | null) {
    onSelectCategory(id);
    onClose();
    setSearch("");
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setSearch("");
      }}
      title={title}
      maxWidth="md"
    >
      <div className="flex flex-col gap-4">
        {/* Campo de Busca */}
        <div className="relative flex items-center w-full">
          <SearchIcon className="w-4 h-4 text-text-secondary absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-ctl pl-10 pr-9 rounded-ctl bg-surface-alt text-sm text-text-primary placeholder:text-text-disabled border border-border hover:border-border-strong focus:border-primary focus-ring transition-colors"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 text-text-secondary hover:text-text-primary text-xs cursor-pointer focus-ring p-1 rounded-full"
              aria-label="Limpar busca"
            >
              ✕
            </button>
          )}
        </div>

        {/* Lista de Categorias */}
        <div className="flex flex-col gap-1.5 max-h-[380px] overflow-y-auto pr-1">
          {allowUncategorized && !search && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={`w-full flex items-center justify-between p-3 rounded-card text-left transition-colors cursor-pointer border ${
                !selectedCategoryId
                  ? "bg-primary-soft/30 border-primary/40 text-primary font-semibold"
                  : "bg-surface-alt/50 hover:bg-surface-alt border-transparent text-text-primary"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-tile bg-surface-sunken flex items-center justify-center text-text-disabled text-sm shrink-0 border border-border">
                  ✕
                </div>
                <span className="truncate text-sm font-medium">Sem categoria</span>
              </div>
              {!selectedCategoryId && (
                <CheckIcon className="w-5 h-5 text-primary shrink-0" />
              )}
            </button>
          )}

          {filteredCategories.length === 0 ? (
            <div className="py-8 text-center text-xs text-text-secondary">
              Nenhuma categoria encontrada com "{search}".
            </div>
          ) : (
            filteredCategories.map((cat) => {
              const isSelected = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelect(cat.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-card text-left transition-colors cursor-pointer border ${
                    isSelected
                      ? "bg-primary-soft/30 border-primary/40 text-primary font-semibold"
                      : "bg-surface-alt/50 hover:bg-surface-alt border-transparent text-text-primary"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CategoryTile
                      icon={cat.icon}
                      colorKey={cat.colorKey}
                      size="md"
                    />
                    <span className="truncate text-sm font-medium">{cat.name}</span>
                  </div>
                  {isSelected && (
                    <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
