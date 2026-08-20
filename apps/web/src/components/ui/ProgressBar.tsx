import React from "react";

export type ProgressStatus = "ok" | "warning" | "exceeded";
export type ProgressSize = "sm" | "md" | "lg";

export interface ProgressBarProps {
  value: number;
  max?: number;
  status?: ProgressStatus;
  size?: ProgressSize;
  className?: string;
  showPercentage?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  status = "ok",
  size = "md",
  className = "",
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / (max || 1)) * 100, 0), 100);

  const heightClasses = {
    sm: "h-1.5",
    md: "h-2",
    lg: "h-2.5",
  }[size];

  const colorClasses = {
    ok: "bg-primary",
    warning: "bg-warning",
    exceeded: "bg-error",
  }[status];

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      className={`w-full bg-surface-sunken rounded-full overflow-hidden ${heightClasses} ${className}`}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ease-out ${colorClasses}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
