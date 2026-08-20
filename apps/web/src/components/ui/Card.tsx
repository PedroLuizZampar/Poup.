import React, { ReactNode, HTMLAttributes } from "react";

export type CardVariant = "panel" | "widget" | "flat";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: CardVariant;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({
  variant = "widget",
  title,
  subtitle,
  action,
  children,
  className = "",
  ...props
}: CardProps) {
  const variantClasses = {
    panel: "bg-surface rounded-panel p-6 md:p-8 shadow-sh2 border border-border flex flex-col gap-6",
    widget: "bg-surface rounded-card p-6 shadow-sh1 border border-border flex flex-col gap-4",
    flat: "bg-surface rounded-card p-4 border border-border flex flex-col gap-3",
  }[variant];

  return (
    <div className={`${variantClasses} ${className}`} {...props}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 -mt-1">
          <div>
            {title && (
              <h3 className="font-display font-bold text-sm md:text-base text-text-primary">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
