import React, { forwardRef, InputHTMLAttributes, ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  sizeVariant?: "sm" | "md" | "lg";
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  hasError?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      sizeVariant = "md",
      iconLeft,
      iconRight,
      hasError = false,
      disabled = false,
      className = "",
      ...props
    },
    ref
  ) => {
    const sizeClasses = {
      sm: "h-ctl-sm min-h-ctl-sm text-xs px-3 rounded-ctl",
      md: "h-ctl min-h-ctl text-sm px-3.5 rounded-ctl",
      lg: "h-ctl-lg min-h-ctl-lg text-sm px-4 rounded-ctl",
    }[sizeVariant];

    return (
      <div className="relative flex items-center w-full">
        {iconLeft && (
          <span className="absolute left-3 flex items-center pointer-events-none text-text-secondary">
            {iconLeft}
          </span>
        )}

        <input
          ref={ref}
          disabled={disabled}
          className={`w-full bg-surface-alt text-text-primary placeholder:text-text-disabled border focus-ring transition-[border-color,box-shadow] duration-150 ${sizeClasses} ${
            hasError
              ? "border-error focus:border-error"
              : "border-border hover:border-border-strong focus:border-primary"
          } ${iconLeft ? "pl-9" : ""} ${iconRight ? "pr-9" : ""} ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          } ${className}`}
          {...props}
        />

        {iconRight && (
          <span className="absolute right-3 flex items-center text-text-secondary">
            {iconRight}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
