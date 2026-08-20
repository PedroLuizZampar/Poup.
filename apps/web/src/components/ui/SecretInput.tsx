import React, { forwardRef, useState } from "react";
import { Input, InputProps } from "./Input";
import { EyeIcon, EyeOffIcon } from "../icons/Icons";

export type SecretInputProps = Omit<InputProps, "type" | "iconRight">;

/**
 * Campo de segredo com alternância de visibilidade.
 *
 * Senha se digita de memória; client secret se cola de outro lugar e precisa
 * ser conferido caractere a caractere — mascarar sem oferecer o "mostrar"
 * transforma um erro de cópia num erro de credencial inexplicável.
 */
export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(
  ({ className = "", ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={className}
        iconRight={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar" : "Mostrar"}
            title={visible ? "Ocultar" : "Mostrar"}
            className="rounded-chip p-0.5 text-text-secondary hover:text-text-primary transition-colors focus-ring"
          >
            {visible ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
          </button>
        }
        {...props}
      />
    );
  }
);

SecretInput.displayName = "SecretInput";
