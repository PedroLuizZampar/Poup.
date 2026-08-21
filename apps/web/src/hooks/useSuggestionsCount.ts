import { useCallback, useEffect, useState } from "react";
import { fetchSuggestionsCount } from "../lib/api";

/**
 * Quem está mostrando a contagem no momento.
 *
 * O botão de sugestões vive no cabeçalho de outra tela, longe de quem mexe na
 * fila: sincronizar acontece no Dashboard e no Perfil, aprovar acontece em
 * `/revisao`, aplicar em massa acontece dentro de um modal. Passar um `refresh`
 * por props por todos esses caminhos seria enfiar o contador em assinaturas que
 * não têm nada a ver com ele. Um aviso solto resolve: quem mexe na fila grita,
 * quem mostra a contagem escuta.
 */
const ouvintes = new Set<() => void>();

/** Chame depois de qualquer coisa que crie ou resolva sugestão. */
export function notifySuggestionsChanged(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

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

  useEffect(() => {
    const ouvinte = () => void refresh();
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  }, [refresh]);

  return { count, refresh };
}
