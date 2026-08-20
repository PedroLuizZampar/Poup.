import React, {
  useEffect,
  useRef,
  useId,
  ReactNode,
  KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl";
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = "lg",
  closeOnOverlayClick = true,
  closeOnEsc = true,
  showCloseButton = true,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Armazena elemento ativo anterior e controla lock do scroll
  useEffect(() => {
    if (isOpen) {
      triggerElementRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";

      // Foca no primeiro elemento focável ou no container
      const focusTimer = setTimeout(() => {
        if (modalRef.current) {
          const focusable = modalRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 50);

      return () => {
        clearTimeout(focusTimer);
        document.body.style.overflow = "";
        triggerElementRef.current?.focus();
      };
    }
  }, [isOpen]);

  // Focus trap e Esc listener
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!isOpen) return;

    if (e.key === "Escape" && closeOnEsc) {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === "Tab" && modalRef.current) {
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);

      if (focusable.length === 0) return;

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  }

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }[maxWidth];

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm anim-fade-in"
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`w-full ${maxWidthClass} max-h-[90vh] rounded-modal bg-surface text-text-primary shadow-sh3 border border-border p-6 md:p-8 flex flex-col gap-6 anim-scale-in`}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4 shrink-0">
            <div>
              {title && (
                <h2
                  id={titleId}
                  className="font-display font-bold text-lg md:text-xl text-text-primary"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="text-xs md:text-sm text-text-secondary mt-1">
                  {description}
                </p>
              )}
            </div>

            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar modal"
                className="w-8 h-8 rounded-full bg-surface-alt flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-sunken focus-ring cursor-pointer transition-colors shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        {/* O `overflow-y-auto` recorta nos quatro lados, cortando o anel de foco
            dos campos nas bordas — na vertical isso aparecia no último campo do
            formulário, cujo anel ficava decepado. O padding devolve a folga e a
            margem negativa a desconta, então o conteúdo não muda de lugar. */}
        <div className="flex flex-col gap-4 overflow-y-auto flex-1 px-1.5 -mx-1.5 py-1.5 -my-1.5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-auto shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modalContent, document.body)
    : modalContent;
}

