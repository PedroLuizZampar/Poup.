import React, {
  useState,
  useRef,
  useEffect,
  useId,
  useCallback,
  KeyboardEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useCoarsePointer } from "../../hooks/useMediaQuery";

export interface SelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  renderOption?: (option: SelectOption<T>, isSelected: boolean) => ReactNode;
  "aria-label"?: string;
  id?: string;
}

/** Altura máxima da lista no popover — precisa bater com `max-h-64` abaixo. */
const POPOVER_MAX_HEIGHT = 256;

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = "Selecione...",
  size = "md",
  disabled = false,
  className = "",
  renderOption,
  "aria-label": ariaLabel,
  id: customId,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  /** No desktop, abre para cima quando não há espaço embaixo. */
  const [opensUpward, setOpensUpward] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const typeaheadBufferRef = useRef<string>("");
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCoarse = useCoarsePointer();

  const autoId = useId();
  const selectId = customId || autoId;
  const listboxId = `${selectId}-listbox`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedOption = options[selectedIndex];

  // Sincroniza o highlight inicial com o item selecionado ao abrir
  useEffect(() => {
    if (isOpen) {
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      setHighlightedIndex(idx);
    }
  }, [isOpen, selectedIndex]);

  /**
   * Decide o lado antes de pintar. Um select no rodapé da tela abria a lista
   * fora da área visível — no mobile, com listas longas (categorias, contas),
   * esse era o caso comum e não a exceção.
   */
  useEffect(() => {
    if (!isOpen || isCoarse || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    setOpensUpward(below < POPOVER_MAX_HEIGHT && above > below);
  }, [isOpen, isCoarse]);

  // Scrolla opção destacada para a visão
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listboxRef.current) {
      const item = listboxRef.current.children[highlightedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  // Fecha no clique externo
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        listboxRef.current &&
        !listboxRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // A folha do mobile cobre a tela: travar o corpo evita o scroll de trás
  // acompanhar o dedo, que é o efeito mais confuso de sheet em navegador.
  useEffect(() => {
    if (!isOpen || !isCoarse) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen, isCoarse]);

  const handleSelect = useCallback(
    (val: T) => {
      onChange(val);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement | HTMLUListElement>) {
    if (disabled) return;

    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    // Navegação quando aberto
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (e.key === "Tab") {
      setIsOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev + 1;
        return next < options.length ? next : 0;
      });
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev - 1;
        return next >= 0 ? next : options.length - 1;
      });
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      setHighlightedIndex(0);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      setHighlightedIndex(options.length - 1);
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < options.length) {
        const opt = options[highlightedIndex];
        if (!opt.disabled) {
          handleSelect(opt.value);
        }
      }
      return;
    }

    // Type-ahead buffer (500ms)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (typeaheadTimeoutRef.current) {
        clearTimeout(typeaheadTimeoutRef.current);
      }
      typeaheadBufferRef.current += e.key.toLowerCase();
      typeaheadTimeoutRef.current = setTimeout(() => {
        typeaheadBufferRef.current = "";
      }, 500);

      const matchIdx = options.findIndex((opt) =>
        opt.label.toLowerCase().startsWith(typeaheadBufferRef.current)
      );
      if (matchIdx >= 0) {
        setHighlightedIndex(matchIdx);
      }
    }
  }

  const heightClasses = size === "sm" ? "h-ctl-sm text-xs px-3" : "h-ctl text-sm px-3.5";

  /** As opções são as mesmas nos dois formatos; só a moldura muda. */
  const optionItems =
    options.length === 0 ? (
      <li className="px-3 py-2 text-xs text-text-disabled select-none">Nenhuma opção</li>
    ) : (
      options.map((option, idx) => {
        const isSelected = option.value === value;
        const isHighlighted = idx === highlightedIndex;

        return (
          <li
            key={String(option.value)}
            id={`${selectId}-opt-${idx}`}
            role="option"
            aria-selected={isSelected}
            aria-disabled={option.disabled}
            onClick={() => !option.disabled && handleSelect(option.value)}
            onMouseEnter={() => setHighlightedIndex(idx)}
            className={`flex items-center justify-between gap-2 px-3 text-xs md:text-sm rounded-tile cursor-pointer select-none transition-colors duration-75 ${
              isCoarse ? "py-3.5 min-h-ctl text-sm" : "py-2"
            } ${isHighlighted ? "bg-surface-alt text-text-primary" : "text-text-primary"} ${
              isSelected ? "bg-primary/10 text-primary font-semibold" : ""
            } ${option.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <span className="truncate flex items-center gap-2">
              {renderOption ? renderOption(option, isSelected) : option.label}
            </span>

            {isSelected && (
              <svg
                className="w-4 h-4 text-primary shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </li>
        );
      })
    );

  return (
    <div className={`relative inline-block w-full min-w-0 ${className}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && highlightedIndex >= 0 ? `${selectId}-opt-${highlightedIndex}` : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center justify-between gap-2 rounded-ctl bg-surface-alt text-text-primary border border-border hover:border-border-strong focus-ring cursor-pointer select-none transition-[border-color,box-shadow] duration-150 ${heightClasses} ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <span className="truncate flex items-center gap-2 min-w-0">
          {selectedOption ? (
            renderOption ? (
              renderOption(selectedOption, true)
            ) : (
              selectedOption.label
            )
          ) : (
            <span className="text-text-disabled">{placeholder}</span>
          )}
        </span>

        <svg
          className={`w-4 h-4 shrink-0 text-text-secondary transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* No dedo, a mesma folha de rodapé dos modais: a lista sobe inteira, com
          alvos de 44px, em vez de um popover que abre para fora da tela. */}
      {isOpen && isCoarse &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm anim-fade-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}
            role="presentation"
          >
            <div className="w-full max-h-[70dvh] rounded-t-modal bg-surface border border-b-0 border-border shadow-sh3 flex flex-col px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] anim-fade-up">
              <div
                aria-hidden="true"
                className="mx-auto w-10 h-1 rounded-full bg-border-strong shrink-0 mb-3"
              />
              {ariaLabel && (
                <p className="px-3 pb-2 text-overline uppercase tracking-wider text-text-secondary shrink-0">
                  {ariaLabel}
                </p>
              )}
              <ul
                ref={listboxRef}
                id={listboxId}
                role="listbox"
                tabIndex={-1}
                aria-label={ariaLabel}
                onKeyDown={handleKeyDown}
                className="overflow-y-auto flex flex-col gap-0.5"
              >
                {optionItems}
              </ul>
            </div>
          </div>,
          document.body
        )}

      {/* Popover Listbox — mouse */}
      {isOpen && !isCoarse && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={`absolute z-50 w-full max-h-64 overflow-y-auto rounded-card bg-surface p-1 shadow-sh3 border border-border ${
            opensUpward ? "bottom-full mb-1 anim-fade-up" : "mt-1 anim-fade-down"
          }`}
        >
          {optionItems}
        </ul>
      )}
    </div>
  );
}
