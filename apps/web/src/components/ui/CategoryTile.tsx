import React from "react";
import { getCategoryIconComponent } from "../../lib/categoryIcons";

export type CategoryTileSize = "sm" | "md" | "lg";

export interface CategoryTileProps {
  icon?: string | null;
  colorKey?: string | null;
  size?: CategoryTileSize;
  className?: string;
}

export type ColorKey =
  | "1" | "2"  | "3"  | "4"  | "5"  | "6"  | "7"  | "8"  | "9"  | "10" | "11" | "12"
  | "13" | "14" | "15" | "16" | "17" | "18" | "19" | "20" | "21" | "22" | "23" | "24";

/** Todas as chaves de cor, na ordem em que a paleta é apresentada. */
export const COLOR_KEYS: ColorKey[] = Array.from(
  { length: 24 },
  (_, i) => String(i + 1) as ColorKey
);

export function normalizeColorKey(colorKey?: string | null): ColorKey {
  if (!colorKey) return "1";
  const cleaned = colorKey.toString().replace(/^c[bf]/i, "").trim();
  if ((COLOR_KEYS as string[]).includes(cleaned)) {
    return cleaned as ColorKey;
  }
  return "1";
}

export function CategoryTile({
  icon,
  colorKey,
  size = "md",
  className = "",
}: CategoryTileProps) {
  const normalizedKey = normalizeColorKey(colorKey);
  const IconComponent = getCategoryIconComponent(icon);

  const sizeClasses = {
    sm: "w-7 h-7 min-w-[28px] rounded-tile",
    md: "w-9 h-9 min-w-[36px] rounded-tile",
    lg: "w-[46px] h-[46px] min-w-[46px] rounded-tile",
  }[size];

  const iconSizes = {
    sm: "w-3.5 h-3.5",
    md: "w-4.5 h-4.5",
    lg: "w-5.5 h-5.5",
  }[size];

  // As classes são geradas dinamicamente; o safelist do Tailwind cobre cat-1..24.
  const colorClasses = `bg-cat-${normalizedKey}-bg text-cat-${normalizedKey}-fg`;

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 select-none ${sizeClasses} ${colorClasses} ${className}`}
      aria-hidden="true"
    >
      <IconComponent className={iconSizes} />
    </div>
  );
}
