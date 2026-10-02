import { Decision, DecisionReason, Fuente, OTHER_FUENTE_COLUMN } from "../constants";
import type { DedupSummary } from "../types";

export type FuenteColumn = Fuente | typeof OTHER_FUENTE_COLUMN;

const KNOWN_FUENTES: ReadonlySet<string> = new Set(Object.values(Fuente));

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function isKnownFuente(fuente: string): boolean {
  return KNOWN_FUENTES.has(fuente);
}

export function decisionTotal(summary: DedupSummary, decision: Decision): number {
  return sum(Object.values(summary.byDecisionAndFuente[decision] ?? {}));
}

/** Count of one decision under one column; the "other" column gathers every unknown fuente. */
export function cellCount(summary: DedupSummary, decision: Decision, column: FuenteColumn): number {
  const byFuente = summary.byDecisionAndFuente[decision] ?? {};
  if (column !== OTHER_FUENTE_COLUMN) return byFuente[column] ?? 0;
  let otherTotal = 0;
  for (const [fuente, count] of Object.entries(byFuente)) {
    if (!isKnownFuente(fuente)) otherTotal += count;
  }
  return otherTotal;
}

export function columnTotal(summary: DedupSummary, column: FuenteColumn): number {
  return cellCount(summary, Decision.KEEP, column) + cellCount(summary, Decision.REMOVE, column);
}

/** Percentage rounded to one decimal; a zero total yields 0, never NaN. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function reviewCount(summary: DedupSummary): number {
  return summary.byReason[DecisionReason.KEPT_ALONGSIDE_PROTECTED] ?? 0;
}
