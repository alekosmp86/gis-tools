import {
  REPORT_COLUMNS,
  REPORT_FILE_EXTENSION,
  REPORT_FILE_PREFIX,
  REPORT_KINDS,
  REPORT_ZIP_EXTENSION,
  REPORT_ZIP_PREFIX,
  type ReportKind,
} from "../constants";
import type { ReportData, ReportRow } from "../types";
import { formatCompactDate } from "../../shared/domain/compactDate";
import { formatCsvLine } from "./csvFormat";
import { encodeLatin1 } from "../../shared/domain/latin1";
import { buildZip } from "./zipWriter";

function toFieldValues(kind: ReportKind, row: ReportRow): string[] {
  return REPORT_COLUMNS[kind].map((column, index) => (column.trims ? row[index].trim() : row[index]));
}

/**
 * One report as the legacy writer produced it: `;` separated, header always (an empty report is
 * header-only), LF, ISO-8859-1 bytes, `"` only where a value needs it.
 */
export function buildReportText(kind: ReportKind, rows: ReadonlyArray<ReportRow>): Uint8Array {
  const header = formatCsvLine(REPORT_COLUMNS[kind].map((column) => column.name));
  const lines = rows.map((row) => formatCsvLine(toFieldValues(kind, row)));
  return encodeLatin1(header + lines.join(""));
}

/** `reporte_avance_duplicado_planilla_obras_aaaammdd.txt`, dated with the server's run day. */
export function buildReportFileName(kind: ReportKind, runDay: Date): string {
  return `${REPORT_FILE_PREFIX[kind]}${formatCompactDate(runDay)}${REPORT_FILE_EXTENSION}`;
}

/** `AvanceFTTH_Reportesaaaammdd.zip`, the legacy zip name. */
export function buildReportZipName(runDay: Date): string {
  return `${REPORT_ZIP_PREFIX}${formatCompactDate(runDay)}${REPORT_ZIP_EXTENSION}`;
}

function orderedReports(reports: ReadonlyArray<ReportData>): ReportData[] {
  return REPORT_KINDS.flatMap((kind) => reports.filter((report) => report.kind === kind));
}

/** All five reports in one zip, in the legacy order; a report that failed has no rows and is not packed. */
export function buildReportZip(reports: ReadonlyArray<ReportData>, runDay: Date): Uint8Array {
  const entries = orderedReports(reports).flatMap((report) =>
    report.rows === null
      ? []
      : [{ name: buildReportFileName(report.kind, runDay), bytes: buildReportText(report.kind, report.rows) }]
  );
  return buildZip(entries, runDay);
}
