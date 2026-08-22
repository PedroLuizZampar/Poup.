import React, { KeyboardEvent, useRef } from "react";
import { normalizeColorKey, ColorKey, COLOR_KEYS } from "../ui/CategoryTile";

export interface ColorPickerProps {
  value: string;
  onChange: (colorKey: string) => void;
  className?: string;
}

/**
 * A paleta tem 16 cores em duas fileiras de oito. A primeira fileira sai do
 * vermelho e caminha até o azul; a segunda fecha a volta no círculo cromático
 * — índigo, roxo, fúcsia, pink, carmim — e termina nos três tons quebrados,
 * para a categoria que não quer chamar atenção.
 *
 * Eram 24, e metade não sobrevivia ao teste que importa: duas categorias
 * vizinhas numa lista. Esmeralda, floresta e sálvia eram o mesmo verde; azul
 * real, índigo e marinho, o mesmo azul; carmim, vermelho e vinho, o mesmo
 * vermelho. Uma paleta em que é preciso comparar dois quadrados lado a lado
 * para saber se são cores diferentes não está oferecendo 24 escolhas.
 *
 * As classes são escritas por extenso porque o scanner do Tailwind não enxerga
 * nomes montados em tempo de execução.
 */
const SWATCH: Record<ColorKey, { bg: string; fg: string; label: string }> = {
  "1":  { bg: "bg-cat-1-bg",  fg: "bg-cat-1-fg",  label: "Vermelho" },
  "2":  { bg: "bg-cat-2-bg",  fg: "bg-cat-2-fg",  label: "Laranja" },
  "3":  { bg: "bg-cat-3-bg",  fg: "bg-cat-3-fg",  label: "Âmbar" },
  "4":  { bg: "bg-cat-4-bg",  fg: "bg-cat-4-fg",  label: "Lima" },
  "5":  { bg: "bg-cat-5-bg",  fg: "bg-cat-5-fg",  label: "Verde" },
  "6":  { bg: "bg-cat-6-bg",  fg: "bg-cat-6-fg",  label: "Turquesa" },
  "7":  { bg: "bg-cat-7-bg",  fg: "bg-cat-7-fg",  label: "Ciano" },
  "8":  { bg: "bg-cat-8-bg",  fg: "bg-cat-8-fg",  label: "Azul" },
  "9":  { bg: "bg-cat-9-bg",  fg: "bg-cat-9-fg",  label: "Índigo" },
  "10": { bg: "bg-cat-10-bg", fg: "bg-cat-10-fg", label: "Roxo" },
  "11": { bg: "bg-cat-11-bg", fg: "bg-cat-11-fg", label: "Fúcsia" },
  "12": { bg: "bg-cat-12-bg", fg: "bg-cat-12-fg", label: "Pink" },
  "13": { bg: "bg-cat-13-bg", fg: "bg-cat-13-fg", label: "Carmim" },
  "14": { bg: "bg-cat-14-bg", fg: "bg-cat-14-fg", label: "Café" },
  "15": { bg: "bg-cat-15-bg", fg: "bg-cat-15-fg", label: "Sálvia" },
  "16": { bg: "bg-cat-16-bg", fg: "bg-cat-16-fg", label: "Grafite" },
};

const COLUMNS = 8;

export function ColorPicker({ value, onChange, className = "" }: ColorPickerProps) {
  const currentKey = normalizeColorKey(value);
  const groupRef = useRef<HTMLDivElement>(null);

  /** Move a seleção e leva o foco junto — o radiogroup usa roving tabindex. */
  function move(delta: number) {
    const index = COLOR_KEYS.indexOf(currentKey);
    if (index === -1) return;
    const next = COLOR_KEYS[(index + delta + COLOR_KEYS.length) % COLOR_KEYS.length];
    onChange(next);
    requestAnimationFrame(() => {
      groupRef.current
        ?.querySelector<HTMLButtonElement>(`[data-color-key="${next}"]`)
        ?.focus();
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step =
      e.key === "ArrowRight" ? 1 :
      e.key === "ArrowLeft" ? -1 :
      e.key === "ArrowDown" ? COLUMNS :
      e.key === "ArrowUp" ? -COLUMNS :
      0;
    if (step === 0) return;
    e.preventDefault();
    move(step);
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Cor da categoria"
      onKeyDown={handleKeyDown}
      className={`grid grid-cols-8 gap-1.5 w-full ${className}`}
    >
      {COLOR_KEYS.map((key) => {
        const swatch = SWATCH[key];
        const isSelected = key === currentKey;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            data-color-key={key}
            aria-checked={isSelected}
            aria-label={swatch.label}
            title={swatch.label}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(key)}
            className={`aspect-square w-full rounded-tile ${swatch.bg} flex items-center justify-center cursor-pointer transition-transform duration-150 ${
              isSelected ? "scale-105" : "hover:scale-110"
            }`}
          >
            {/* Não-selecionado: um ponto no traço da cor — o mesmo traço que
                colore o ícone da categoria nas listas. Selecionado: o traço
                toma a casa inteira e o visto aparece na cor da superfície. */}
            {isSelected ? (
              <span
                className={`w-full h-full rounded-tile flex items-center justify-center ${swatch.fg}`}
              >
                <svg
                  className="w-4 h-4 text-surface"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : (
              <span className={`w-2.5 h-2.5 rounded-full ${swatch.fg}`} />
            )}
          </button>
        );
      })}
    </div>
  );
}
