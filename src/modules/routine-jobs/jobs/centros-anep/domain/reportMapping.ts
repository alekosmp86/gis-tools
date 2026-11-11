import { listOf, numberOf, textOf, type Row } from "../../shared/rowMapping";
import type {
  CentrosComparison,
  CentrosComparisonRow,
  CentrosCountRow,
  CentrosFinalCounts,
  CentrosRepeatedRuee,
  CentrosStagingReport,
} from "../types";

const countRowOf = (row: Row): CentrosCountRow => ({ value: textOf(row.value), rows: numberOf(row.rows) });

const repeatedOf = (row: Row): CentrosRepeatedRuee => ({ ruee: String(row.ruee), rows: numberOf(row.rows) });

export function toCentrosStagingReport(row: Row, unsupportedSridRows: number): CentrosStagingReport {
  return {
    rows: numberOf(row.rows),
    bySubsistema: listOf(row.by_subsistema).map(countRowOf),
    emptyGeometry: numberOf(row.empty_geometry),
    nullRuee: numberOf(row.null_ruee),
    nullSubsistema: numberOf(row.null_subsistema),
    repeatedGroups: numberOf(row.repeated_groups),
    repeatedRows: numberOf(row.repeated_rows),
    repeatedRuee: listOf(row.repeated_ruee).map(repeatedOf),
    damagedTextRows: numberOf(row.damaged_text_rows),
    unsupportedSridRows,
  };
}

export const toCentrosFinalCounts = (row: Row): CentrosFinalCounts => ({
  rows: numberOf(row.rows),
  bySubsistema: listOf(row.by_subsistema).map(countRowOf),
});

const countOf = (rows: readonly CentrosCountRow[], value: string | null): number =>
  rows.find((entry) => entry.value === value)?.rows ?? 0;

const compareValues = (left: string | null, right: string | null): number => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
};

export function compareWithFinal(current: CentrosFinalCounts, staging: CentrosStagingReport): CentrosComparison {
  const values = [...new Set([...current.bySubsistema, ...staging.bySubsistema].map((entry) => entry.value))].sort(compareValues);
  const bySubsistema: CentrosComparisonRow[] = values.map((value) => {
    const before = countOf(current.bySubsistema, value);
    const after = countOf(staging.bySubsistema, value);
    return { value, current: before, after, difference: after - before };
  });
  return { currentRows: current.rows, afterRows: staging.rows, bySubsistema };
}
