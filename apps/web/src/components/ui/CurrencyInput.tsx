import React, { ChangeEvent } from "react";

export interface CurrencyInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  hasError?: boolean;
  placeholder?: string;
  className?: string;
  sizeVariant?: "sm" | "md" | "lg";
}

export function CurrencyInput({
  id,
  value,
  onChange,
  disabled = false,
  hasError = false,
  placeholder = "0,00",
  className = "",
  sizeVariant = "md",
}: CurrencyInputProps) {
  // Converte valor numérico em string com centavos
  const formattedDisplay =
    value > 0
      ? (value).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const rawDigits = e.target.value.replace(/\D/g, "");
    if (!rawDigits) {
      onChange(0);
      return;
    }
    const numericValue = parseInt(rawDigits, 10) / 100;
    onChange(numericValue);
  }

  const sizeClasses = {
    sm: "h-ctl-sm min-h-ctl-sm text-xs px-3 rounded-ctl",
    md: "h-ctl min-h-ctl text-sm px-3.5 rounded-ctl",
    lg: "h-ctl-lg min-h-ctl-lg text-base px-4 rounded-ctl font-semibold",
  }[sizeVariant];

  return (
    <div className={`relative flex items-center w-full ${className}`}>
      <span className="absolute left-3.5 text-text-secondary text-sm font-semibold select-none pointer-events-none">
        R$
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={formattedDisplay}
        onChange={handleChange}
        className={`w-full pl-10 pr-3.5 bg-surface-alt text-text-primary placeholder:text-text-disabled border tnum font-display focus-ring transition-[border-color,box-shadow] duration-150 ${sizeClasses} ${
          hasError
            ? "border-error focus:border-error"
            : "border-border hover:border-border-strong focus:border-primary"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      />
    </div>
  );
}
