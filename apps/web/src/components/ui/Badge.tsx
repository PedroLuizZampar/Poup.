import React, { ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ReactNode;
  className?: string;
}

export function Badge({
  children,
  variant = "neutral",
  size = "md",
  icon,
  className = "",
}: BadgeProps) {
  const variantClasses = {
    neutral: "bg-surface-alt text-text-secondary border-border",
    success: "bg-income-soft text-income border-income/20",
    warning: "bg-warning-soft text-warning border-warning/20",
    danger: "bg-error-soft text-error border-error/20",
    info: "bg-primary-ghost text-primary border-primary/20",
  }[variant];

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5 font-semibold",
  }[size];

  return (
    <span
      className={`inline-flex items-center rounded-chip border font-medium select-none truncate ${variantClasses} ${sizeClasses} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
