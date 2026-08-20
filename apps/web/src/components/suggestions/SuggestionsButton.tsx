import React from "react";
import { Link } from "react-router-dom";
import { useSuggestionsCount } from "../../hooks/useSuggestionsCount";

/**
 * Não renderiza nada com a fila vazia. Um botão permanente que quase sempre
 * mostra zero vira parte do cenário, e quando enfim tem algo ninguém repara.
 */
export function SuggestionsButton() {
  const { count } = useSuggestionsCount();

  if (count === 0) return null;

  return (
    <Link
      to="/revisao"
      className="tap-target inline-flex items-center gap-2 h-ctl px-3 rounded-ctl bg-surface border border-border hover:border-border-strong hover:bg-surface-alt transition-colors focus-ring shrink-0"
      title="Revisar categorias sugeridas"
    >
      <span className="text-sm font-semibold text-text-primary">Sugestões</span>
      <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
        {count > 99 ? "99+" : count}
      </span>
    </Link>
  );
}
