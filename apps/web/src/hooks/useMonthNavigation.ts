import { useCallback, useMemo, useState } from "react";
import {
  formatMonthFull,
  formatMonthName,
  getCurrentMonthStr,
  getOffsetMonthStr,
} from "../lib/date";

export interface MonthNavigation {
  /** Mês selecionado, "YYYY-MM" — o formato que a API espera. */
  month: string;
  /** Distância em meses até o mês corrente. 0 é o mês de hoje. */
  offset: number;
  isCurrentMonth: boolean;
  /** "Agosto de 2026" — para título. */
  fullName: string;
  /** "Agosto" — para rótulos dentro de frases. */
  shortName: string;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  goToCurrentMonth: () => void;
}

/**
 * Estado e formatação do mês em navegação.
 *
 * O par "offset numérico + `getOffsetMonthStr`" era remontado à mão em cada
 * página que navega por mês, cada uma com a sua combinação de `useMemo`. Aqui a
 * regra fica num lugar só, incluindo o formato do rótulo.
 */
export function useMonthNavigation(initialOffset = 0): MonthNavigation {
  const [offset, setOffset] = useState(initialOffset);

  const month = useMemo(() => getOffsetMonthStr(getCurrentMonthStr(), offset), [offset]);

  return {
    month,
    offset,
    isCurrentMonth: offset === 0,
    fullName: useMemo(() => formatMonthFull(month), [month]),
    shortName: useMemo(() => formatMonthName(month), [month]),
    goToPreviousMonth: useCallback(() => setOffset((value) => value - 1), []),
    goToNextMonth: useCallback(() => setOffset((value) => value + 1), []),
    goToCurrentMonth: useCallback(() => setOffset(0), []),
  };
}
