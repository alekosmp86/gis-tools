import { FILE_KIND_LABELS, REPORT_KIND_LABELS, type AvanceFileKind } from "../constants";
import type {
  AvanceLoadResult,
  HistoryOutcome,
  LoadedFile,
  ParsedAvanceFile,
  ReportData,
  ReportOutcome,
  StatusCount,
} from "../types";

const VerificationMessage = {
  stagingMismatch: (kind: AvanceFileKind, found: number, expected: number) =>
    `La planilla de ${FILE_KIND_LABELS[kind]} quedó con ${found} filas y se esperaban ${expected}; se deshizo la carga.`,
  avanceMismatch: (found: number, expected: number) =>
    `El Avance quedó con ${found} filas y los inserts escribieron ${expected}; se deshizo la carga.`,
} as const;

class LoadVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadVerificationError";
  }
}

export interface VerificationInput {
  readonly files: ReadonlyArray<LoadedFile>;
  readonly stagingCounts: Readonly<Record<AvanceFileKind, number>>;
  readonly avanceCount: number;
}

/**
 * AC-18: each staging table holds what was loaded minus the junk; the Avance holds exactly what the
 * two INSERT statements wrote (duplicates collapse, so it is not the staging count).
 */
export function assertConsistentCounts({ files, stagingCounts, avanceCount }: VerificationInput): void {
  for (const file of files) {
    const expected = file.rowsLoaded - file.junkDeleted;
    if (stagingCounts[file.kind] !== expected) {
      throw new LoadVerificationError(VerificationMessage.stagingMismatch(file.kind, stagingCounts[file.kind], expected));
    }
  }
  const expectedAvance = files.reduce((total, file) => total + file.avanceInserted, 0);
  if (avanceCount !== expectedAvance) {
    throw new LoadVerificationError(VerificationMessage.avanceMismatch(avanceCount, expectedAvance));
  }
}

/** Sums the per-file breakdowns into one count per district status. */
export function mergeStatusCounts(groups: ReadonlyArray<ReadonlyArray<StatusCount>>): StatusCount[] {
  const totals = new Map<string, number>();
  for (const entry of groups.flat()) totals.set(entry.status, (totals.get(entry.status) ?? 0) + entry.count);
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => ({ status, count }));
}

function toReportOutcomes(reports: ReadonlyArray<ReportData>): ReportOutcome[] {
  return reports.map((report) => ({
    kind: report.kind,
    rows: report.rows === null ? null : report.rows.length,
    error: report.error,
  }));
}

const ResultMessage = {
  unmatched: (fileName: string, total: number) =>
    `${fileName}: ${total} claves (edificio, cable, zona) no encontraron zona en SIGRA y no se insertaron.`,
  reportFailed: (outcome: ReportOutcome) =>
    `El reporte "${REPORT_KIND_LABELS[outcome.kind]}" no se pudo generar: ${outcome.error}`,
} as const;

function collectWarnings(
  files: ReadonlyArray<LoadedFile>,
  history: HistoryOutcome,
  reports: ReadonlyArray<ReportOutcome>
): string[] {
  const warnings: string[] = [];
  if (history.skipped && history.reason !== null) warnings.push(history.reason);
  for (const file of files) {
    if (file.unmatchedKeys > 0) warnings.push(ResultMessage.unmatched(file.fileName, file.unmatchedKeys));
  }
  for (const report of reports) {
    if (report.error !== null) warnings.push(ResultMessage.reportFailed(report));
  }
  return warnings;
}

export interface LoadResultInput {
  readonly dryRun: boolean;
  readonly files: ReadonlyArray<LoadedFile>;
  readonly history: HistoryOutcome;
  readonly byStatus: ReadonlyArray<StatusCount>;
  readonly reports: ReadonlyArray<ReportData>;
  readonly elapsedMs: number;
  readonly parsed: ReadonlyArray<ParsedAvanceFile>;
}

/** Joins what the transaction wrote with the rows that were rejected, in file order. */
export function buildLoadResult(input: LoadResultInput): AvanceLoadResult {
  const reports = toReportOutcomes(input.reports);
  return {
    dryRun: input.dryRun,
    files: input.files,
    history: input.history,
    avanceInserted: input.files.reduce((total, file) => total + file.avanceInserted, 0),
    byStatus: input.byStatus,
    reports,
    elapsedMs: input.elapsedMs,
    warnings: collectWarnings(input.files, input.history, reports),
    rejectedRows: input.parsed.flatMap((file) => file.rejected),
    rejectedTotal: input.parsed.reduce((total, file) => total + file.rejectedTotal, 0),
  };
}
