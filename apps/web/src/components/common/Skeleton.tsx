import React from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer-effect rounded-ctl ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="bg-surface rounded-card p-6 shadow-sh1 border border-border flex flex-col gap-3">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-40" />
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div className="py-4 px-6 flex items-center justify-between gap-4 border-b border-border">
      <div className="flex items-center gap-3">
        <Skeleton className="w-8 h-8 rounded-tile flex-none" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-5 w-20 rounded-chip" />
    </div>
  );
}

