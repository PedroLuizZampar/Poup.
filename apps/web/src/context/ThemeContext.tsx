import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "poup:theme";

/** Espelha `--bg` de cada tema em `index.css`. Usado na meta `theme-color`, que
 *  pinta a barra do navegador e a moldura do app instalado — se divergir do
 *  fundo, aparece uma faixa de cor errada acima do conteúdo. */
const THEME_COLOR: Record<Theme, string> = {
  light: "#E5EDE9",
  dark: "#0F0F10",
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Tema inicial: escolha explícita do usuário, e só na falta dela a preferência
 * do sistema. O padrão fixo em claro era visível num celular em modo escuro —
 * abrir o app instalado e levar um branco na cara contraria o resto do aparelho.
 */
function resolveInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * As duas metas do `index.html` são escopadas por `prefers-color-scheme` para
 * acertar a cor antes do JS subir. Depois disso o tema pode contrariar o
 * sistema, então as duas passam a valer a mesma coisa: a que casar com o
 * sistema vence, e o valor é o certo de qualquer jeito.
 */
function syncThemeColorMeta(theme: Theme) {
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content = THEME_COLOR[theme];
    });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);
  /** Só seguimos o sistema enquanto o usuário não tiver escolhido nada. */
  const [followsSystem, setFollowsSystem] = useState(
    () => localStorage.getItem(STORAGE_KEY) === null
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // `color-scheme` é o que faz o navegador desenhar seus próprios widgets
    // (scrollbar, campos nativos, autofill) no tema certo.
    root.style.colorScheme = theme;
    syncThemeColorMeta(theme);
  }, [theme]);

  // Enquanto o app segue o sistema, ele acompanha a troca em tempo real — que é
  // o comportamento esperado de quem tem o agendamento noturno do aparelho ligado.
  useEffect(() => {
    if (!followsSystem) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(event: MediaQueryListEvent) {
      setThemeState(event.matches ? "dark" : "light");
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [followsSystem]);

  function applyTheme(next: Theme) {
    // Escolher um tema é sair do automático: a partir daqui a preferência do
    // usuário persiste e o sistema deixa de mandar.
    localStorage.setItem(STORAGE_KEY, next);
    setFollowsSystem(false);
    setThemeState(next);
  }

  function toggleTheme() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: applyTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme deve ser usado dentro de um ThemeProvider");
  }
  return context;
}
