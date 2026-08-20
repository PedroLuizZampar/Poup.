import React, { forwardRef, TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ hasError = false, disabled = false, className = "", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        disabled={disabled}
        className={`w-full p-3.5 rounded-ctl bg-surface-alt text-text-primary text-sm placeholder:text-text-disabled border focus-ring transition-[border-color,box-shadow] duration-150 resize-y min-h-[90px] ${
          hasError
            ? "border-error focus:border-error"
            : "border-border hover:border-border-strong focus:border-primary"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
