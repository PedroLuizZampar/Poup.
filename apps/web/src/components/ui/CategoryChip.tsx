import React from "react";
import { normalizeColorKey } from "./CategoryTile";
import { getCategoryIconComponent } from "../../lib/categoryIcons";

/* Escritos por extenso de propósito: o scanner do Tailwind só gera
   `bg-cat-N-bg/40` e `border-cat-N-fg/25` se as classes aparecerem literais. */
const DOT_CLASSES: Record<string, string> = {
  "1": "bg-cat-1-fg",
  "2": "bg-cat-2-fg",
  "3": "bg-cat-3-fg",
  "4": "bg-cat-4-fg",
  "5": "bg-cat-5-fg",
  "6": "bg-cat-6-fg",
  "7": "bg-cat-7-fg",
  "8": "bg-cat-8-fg",
  "9": "bg-cat-9-fg",
  "10": "bg-cat-10-fg",
  "11": "bg-cat-11-fg",
  "12": "bg-cat-12-fg",
  "13": "bg-cat-13-fg",
  "14": "bg-cat-14-fg",
  "15": "bg-cat-15-fg",
  "16": "bg-cat-16-fg",
};

const SKIN_CLASSES: Record<string, string> = {
  "1": "bg-cat-1-bg/40 text-cat-1-fg border-cat-1-fg/25",
  "2": "bg-cat-2-bg/40 text-cat-2-fg border-cat-2-fg/25",
  "3": "bg-cat-3-bg/40 text-cat-3-fg border-cat-3-fg/25",
  "4": "bg-cat-4-bg/40 text-cat-4-fg border-cat-4-fg/25",
  "5": "bg-cat-5-bg/40 text-cat-5-fg border-cat-5-fg/25",
  "6": "bg-cat-6-bg/40 text-cat-6-fg border-cat-6-fg/25",
  "7": "bg-cat-7-bg/40 text-cat-7-fg border-cat-7-fg/25",
  "8": "bg-cat-8-bg/40 text-cat-8-fg border-cat-8-fg/25",
  "9": "bg-cat-9-bg/40 text-cat-9-fg border-cat-9-fg/25",
  "10": "bg-cat-10-bg/40 text-cat-10-fg border-cat-10-fg/25",
  "11": "bg-cat-11-bg/40 text-cat-11-fg border-cat-11-fg/25",
  "12": "bg-cat-12-bg/40 text-cat-12-fg border-cat-12-fg/25",
  "13": "bg-cat-13-bg/40 text-cat-13-fg border-cat-13-fg/25",
  "14": "bg-cat-14-bg/40 text-cat-14-fg border-cat-14-fg/25",
  "15": "bg-cat-15-bg/40 text-cat-15-fg border-cat-15-fg/25",
  "16": "bg-cat-16-bg/40 text-cat-16-fg border-cat-16-fg/25",
};

export interface CategoryChipProps {
  name: string;
  icon?: string | null;
  colorKey?: string | null;
  size?: "sm" | "md";
  className?: string;
}

export function CategoryChip({
  name,
  icon,
  colorKey,
  size = "md",
  className = "",
}: CategoryChipProps) {
  const normalizedKey = normalizeColorKey(colorKey);
  const IconComponent = getCategoryIconComponent(icon);

  const dot = DOT_CLASSES[normalizedKey];
  const skin = SKIN_CLASSES[normalizedKey];

  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5 gap-1.5" : "text-xs px-2.5 py-1 gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-chip border font-medium select-none truncate ${skin} ${sizeClasses} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}
