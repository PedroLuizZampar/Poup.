import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toast: (options: {
    title: string;
    message?: string;
    type?: ToastType;
    duration?: number;
  }) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({
      title,
      message,
      type = "info",
      duration = 4000,
    }: {
      title: string;
      message?: string;
      type?: ToastType;
      duration?: number;
    }) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const newToast: ToastItem = { id, title, message, type, duration };

      setToasts((prev) => [...prev.slice(-2), newToast]); // Mantém no máximo 3 visíveis

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const success = useCallback((title: string, message?: string) => addToast({ title, message, type: "success" }), [addToast]);
  const error = useCallback((title: string, message?: string) => addToast({ title, message, type: "error", duration: 6000 }), [addToast]);
  const warning = useCallback((title: string, message?: string) => addToast({ title, message, type: "warning" }), [addToast]);
  const info = useCallback((title: string, message?: string) => addToast({ title, message, type: "info" }), [addToast]);

  return (
    <ToastContext.Provider value={{ toast: addToast, success, error, warning, info }}>
      {children}
      {/* Toast Container.
          `right-5 w-full` dava, em 360px, uma caixa de 360px deslocada 20px da
          direita: 20px ficavam fora da tela. No mobile a pilha passa a ocupar a
          largura entre as margens e a subir acima da barra inferior, com que ela
          colidiria de frente. */}
      <div
        className="fixed z-50 flex flex-col gap-2.5 pointer-events-none inset-x-4 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1rem)] sm:inset-x-auto sm:right-5 sm:max-w-sm sm:w-full md:bottom-5"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const isError = t.type === "error";
          const borderClasses = {
            success: "border-income/30 bg-surface shadow-sh3 text-text-primary",
            error: "border-error/30 bg-surface shadow-sh3 text-text-primary",
            warning: "border-warning/30 bg-surface shadow-sh3 text-text-primary",
            info: "border-primary/30 bg-surface shadow-sh3 text-text-primary",
          }[t.type];

          const icon = {
            success: (
              <span className="w-5 h-5 rounded-full bg-income/15 text-income flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ),
            error: (
              <span className="w-5 h-5 rounded-full bg-error/15 text-error flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
            ),
            warning: (
              <span className="w-5 h-5 rounded-full bg-warning/15 text-warning flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
            ),
            info: (
              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </span>
            ),
          }[t.type];

          return (
            <div
              key={t.id}
              role={isError ? "alert" : "status"}
              className={`pointer-events-auto p-4 rounded-card border ${borderClasses} flex items-start gap-3 anim-fade-up`}
            >
              {icon}
              <div className="flex-1 min-w-0">
                <h4 className="text-xs md:text-sm font-semibold text-text-primary">
                  {t.title}
                </h4>
                {t.message && (
                  <p className="text-xs text-text-secondary mt-0.5 whitespace-pre-line leading-relaxed">
                    {t.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                aria-label="Fechar notificação"
                className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors shrink-0 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de um ToastProvider");
  }
  return context;
}
