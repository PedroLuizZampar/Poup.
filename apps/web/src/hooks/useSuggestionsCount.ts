import { useCallback, useEffect, useState } from "react";
import { fetchSuggestionsCount } from "../lib/api";

/**
 * Contagem de sugestões pendentes.
 *
 * É de sugestões, não de transações sem categoria: a fila é feita de decisões
 * que o app propôs, e uma transação sem palpite não é uma proposta — ela mora
 * no filtro "sem categoria" da tela de Transações.
 */
export function useSuggestionsCount(): { count: number; refresh: () => Promise<void> } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await fetchSuggestionsCount());
    } catch {
      // A contagem é enfeite: falhar aqui não pode derrubar a tela que a usa.
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { count, refresh };
}
