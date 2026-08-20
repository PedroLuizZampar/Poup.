import React, { useState, useMemo, useRef, KeyboardEvent } from "react";
import {
  CATEGORY_ICONS,
  searchIcons,
  getCategoryIconComponent,
} from "../../lib/categoryIcons";

export interface IconPickerProps {
  value: string;
  onChange: (iconKey: string) => void;
  /** Altura da grade. `tall` é usada no modal de categoria, em coluna própria. */
  height?: "default" | "tall";
  className?: string;
}

export function IconPicker({
  value,
  onChange,
  height = "default",
  className = "",
}: IconPickerProps) {
  const [search, setSearch] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

  const filteredKeys = useMemo(() => searchIcons(search), [search]);

  /**
   * Roving tabindex: a grade inteira ocupa uma parada de Tab, e as setas andam
   * pelos ícones. Sem isso, um Tab teria que atravessar 45 botões.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const columns = getColumnCount(gridRef.current);
    const step =
      e.key === "ArrowRight" ? 1 :
      e.key === "ArrowLeft" ? -1 :
      e.key === "ArrowDown" ? columns :
      e.key === "ArrowUp" ? -columns :
      0;
    if (step === 0 || filteredKeys.length === 0) return;
    e.preventDefault();

    const index = filteredKeys.indexOf(value);
    const from = index === -1 ? 0 : index;
    const next = filteredKeys[(from + step + filteredKeys.length) % filteredKeys.length];
    onChange(next);
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-icon-key="${next}"]`)
        ?.focus();
    });
  }

  const gridHeight = height === "tall" ? "max-h-[248px]" : "max-h-56";

  // Se a busca escondeu o ícone selecionado, o primeiro visível assume a parada
  // de Tab — senão a grade inteira ficaria inalcançável pelo teclado.
  const tabbableKey = filteredKeys.includes(value) ? value : filteredKeys[0];

  return (
    <div className={`flex flex-col gap-2.5 min-h-0 ${className}`}>
      {/* Busca */}
      <div className="relative">
        <svg
          className="w-4 h-4 text-text-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar ícone: comida, carro, casa…"
          aria-label="Buscar ícone"
          className="w-full h-ctl-sm pl-9 pr-8 rounded-ctl bg-surface-alt text-xs text-text-primary placeholder:text-text-secondary border border-border hover:border-border-strong transition-colors"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-sunken cursor-pointer transition-colors"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Grade */}
      <div
        ref={gridRef}
        role="radiogroup"
        aria-label="Ícone da categoria"
        onKeyDown={handleKeyDown}
        className={`grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5 p-2 rounded-card bg-surface-alt/50 border border-border overflow-y-auto ${gridHeight}`}
      >
        {filteredKeys.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-text-secondary">
            Nenhum ícone corresponde a “{search}”.
          </p>
        ) : (
          filteredKeys.map((key) => {
            const isSelected = value.toLowerCase() === key.toLowerCase();
            const item = CATEGORY_ICONS[key];
            const Icon = getCategoryIconComponent(key);

            return (
              <button
                key={key}
                type="button"
                role="radio"
                data-icon-key={key}
                aria-checked={isSelected}
                aria-label={item?.label || key}
                title={item?.label || key}
                tabIndex={key === tabbableKey ? 0 : -1}
                onClick={() => onChange(key)}
                className={`aspect-square w-full rounded-tile flex items-center justify-center cursor-pointer transition-colors duration-100 ${
                  isSelected
                    ? "bg-primary text-primary-fg shadow-sh1"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-sunken"
                }`}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Lê quantas colunas o grid auto-fill resolveu, para as setas ↑/↓ andarem certo. */
function getColumnCount(grid: HTMLDivElement | null): number {
  if (!grid) return 1;
  const template = getComputedStyle(grid).gridTemplateColumns;
  return template ? template.split(" ").filter(Boolean).length : 1;
}
