import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PrivacyContextType {
  /** Ligado, todo valor em dinheiro na tela sai borrado. */
  hidden: boolean;
  toggle: () => void;
}

const STORAGE_KEY = "poup:privacy";

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

/**
 * O modo discreto: um atributo no `<html>`, e o CSS borra os valores.
 *
 * Podia ser um `useContext` lido por cada componente de valor, mas então cada
 * troca do botão remontaria a árvore inteira só para mudar um filtro. Um
 * atributo em `document.documentElement` e uma regra em `index.css`
 * (`html[data-privacy="on"] .money`) fazem o mesmo com zero re-render — e
 * funcionam em texto de SVG, que é onde os rótulos do gráfico moram.
 *
 * A preferência persiste: quem esconde os valores para olhar o app no ônibus
 * não quer que a próxima abertura mostre tudo antes de ele lembrar de esconder.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(STORAGE_KEY) === "on");

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      root.setAttribute("data-privacy", "on");
    } else {
      root.removeAttribute("data-privacy");
    }
    localStorage.setItem(STORAGE_KEY, hidden ? "on" : "off");
  }, [hidden]);

  return (
    <PrivacyContext.Provider value={{ hidden, toggle: () => setHidden((v) => !v) }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  const context = useContext(PrivacyContext);
  if (!context) {
    throw new Error("usePrivacy deve ser usado dentro de um PrivacyProvider");
  }
  return context;
}
