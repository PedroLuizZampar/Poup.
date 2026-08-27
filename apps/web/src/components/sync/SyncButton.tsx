import React, { useEffect, useRef, useState } from "react";
import { Button, ButtonSize } from "../ui/Button";
import { ChevronDownIcon, RefreshIcon } from "../icons/Icons";

export interface SyncButtonProps {
  /** Sincronização normal: só o que mudou na janela recente. */
  onIncremental: () => void;
  /** Busca o extrato inteiro, desde o começo. */
  onFull: () => void;
  /** Rótulo do botão fechado. Já vem com o marcador de pendência, se houver. */
  label?: string;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Substitui o rótulo enquanto algo roda — ex.: "Conta 2 de 4". */
  loadingLabel?: string;
  title?: string;
  className?: string;
}

/**
 * Botão único de sincronização: um clique abre as duas formas de buscar dados.
 *
 * Antes as duas moravam em botões separados — e o "período completo" ocupava a
 * linha inteira do lado de uma ação que o usuário aciona dez vezes mais. Aqui a
 * frequente é a primeira do menu e a cara fica um degrau abaixo, sem sumir.
 */
export function SyncButton({
  onIncremental,
  onFull,
  label = "Sincronizar",
  size = "md",
  loading = false,
  disabled = false,
  loadingLabel,
  title = "Buscar movimentações",
  className = "",
}: SyncButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha em clique externo. O menu não é modal: ele não deve prender o foco
  // nem escurecer a tela para uma escolha de duas linhas.
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  // Enquanto uma busca roda o menu não faz sentido: fecha sozinho.
  useEffect(() => {
    if (loading) setIsOpen(false);
  }, [loading]);

  function escolher(acao: () => void) {
    setIsOpen(false);
    acao();
  }

  const itemClasses =
    "w-full text-left px-3 py-2 rounded-tile hover:bg-surface-alt transition-colors focus-ring cursor-pointer flex flex-col gap-0.5";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <Button
        variant="secondary"
        size={size}
        onClick={() => setIsOpen((aberto) => !aberto)}
        loading={loading}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        fullWidth
        iconLeft={
          <RefreshIcon className={size === "sm" ? "w-3.5 h-3.5 text-primary" : "w-4 h-4 text-primary"} />
        }
        iconRight={
          loading ? undefined : (
            <ChevronDownIcon
              className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          )
        }
      >
        {loading && loadingLabel ? loadingLabel : label}
      </Button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-card bg-surface p-1.5 shadow-sh3 border border-border anim-fade-down z-50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => escolher(onIncremental)}
            className={itemClasses}
          >
            <span className="text-xs font-semibold text-text-primary">
              Sincronização diferencial
            </span>
            <span className="text-[11px] text-text-secondary leading-snug">
              Busca só as movimentações recentes. É rápida.
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => escolher(onFull)}
            className={itemClasses}
          >
            <span className="text-xs font-semibold text-text-primary">
              Buscar todo o período
            </span>
            <span className="text-[11px] text-text-secondary leading-snug">
              Extrato completo, desde o começo. Pode demorar.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
