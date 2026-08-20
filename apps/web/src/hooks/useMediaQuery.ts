import { useEffect, useState } from "react";

/**
 * Assina uma media query do CSS a partir do React.
 *
 * Existe para os casos em que a diferença não é de estilo e sim de **estrutura**
 * — um `Select` que no dedo vira uma folha no rodapé e no mouse continua um
 * popover não é a mesma árvore de elementos com outra classe.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

/**
 * `true` num aparelho de toque. É a pergunta certa para decidir alvo e forma de
 * um controle — melhor que largura de tela, que confunde tablet com janela
 * estreita no desktop.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
