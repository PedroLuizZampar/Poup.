import React, { forwardRef, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      loading = false,
      disabled = false,
      iconLeft,
      iconRight,
      fullWidth = false,
      className = "",
      type = "button",
      ...props
    },
    ref
  ) => {
    const sizeClasses = {
      sm: "h-ctl-sm min-h-ctl-sm px-3 text-xs gap-1.5 rounded-ctl",
      md: "h-ctl min-h-ctl px-4 text-sm gap-2 rounded-ctl",
      lg: "h-ctl-lg min-h-ctl-lg px-6 text-sm gap-2.5 rounded-ctl font-semibold",
    }[size];

    const variantClasses = {
      primary:
        "bg-primary text-white hover:bg-primary-hover active:bg-primary-active shadow-sh1 border border-transparent",
      secondary:
        "bg-surface-alt text-text-primary hover:bg-surface-sunken border border-border hover:border-border-strong",
      ghost:
        "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-alt border border-transparent",
      danger:
        "bg-error text-white hover:bg-error/90 active:bg-error/80 shadow-sh1 border border-transparent",
    }[variant];

    const widthClass = fullWidth ? "w-full" : "";
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center font-medium select-none focus-ring cursor-pointer active:scale-[0.98] transition-[background-color,color,border-color,box-shadow,transform] duration-150 ${sizeClasses} ${variantClasses} ${widthClass} ${
          isDisabled ? "opacity-50 cursor-not-allowed active:scale-100" : ""
        } ${className}`}
        {...props}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4 text-current"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              role="status"
              aria-label="Carregando"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>{children}</span>
          </span>
        ) : (
          <>
            {iconLeft && <span className="inline-flex shrink-0">{iconLeft}</span>}
            <span>{children}</span>
            {iconRight && <span className="inline-flex shrink-0">{iconRight}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
