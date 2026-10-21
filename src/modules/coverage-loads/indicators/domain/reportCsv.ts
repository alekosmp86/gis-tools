import {
  REPORT_COLUMNS,
  REPORT_FILE_DATE_SEPARATOR,
  REPORT_FILE_EXTENSION,
  REPORT_FILE_PREFIX,
  ReportColumn,
} from "../constants";
import type { ReportKind } from "../constants";
import type { ReportRow } from "../types";
import { formatCompactDate } from "../../shared/domain/compactDate";
import { formatCsvLine } from "./csvFormat";
import { encodeLatin1 } from "../../shared/domain/latin1";

const TRAILING_ZEROS = /0+$/;
const TRAILING_POINT = /\.$/;
const DECIMAL_POINT = ".";

/** `91.30 -> 91.3`, `100.00 -> 100`, `0.00 -> 0`, `12.35 -> 12.35`. */
export function formatPercentage(value: string): string {
  const text = value.trim();
  if (!text.includes(DECIMAL_POINT)) return text;
  return text.replace(TRAILING_ZEROS, "").replace(TRAILING_POINT, "");
}

function toFieldValue(column: ReportColumn, row: ReportRow): string {
  return column === ReportColumn.PORCENTAJE ? formatPercentage(row[column]) : row[column];
}

/**
 * The report as the legacy writer produced it: `;` separated, header, LF, ISO-8859-1 bytes, `"`
 * only where a value needs it. A report without rows is a 0-byte file with no header (legacy
 * behaviour); callers tell the user "sin novedades".
 */
export function buildReportCsv(kind: ReportKind, rows: ReadonlyArray<ReportRow>): Uint8Array {
  if (rows.length === 0) return new Uint8Array(0);
  const columns = REPORT_COLUMNS[kind];
  const lines = rows.map((row) => formatCsvLine(columns.map((column) => toFieldValue(column, row))));
  return encodeLatin1(formatCsvLine(columns) + lines.join(""));
}

/** `reporte_cobertura_lte_localidad__aaaammdd.csv`, dated with the server's local run day. */
export function buildReportFileName(kind: ReportKind, runDay: Date): string {
  return `${REPORT_FILE_PREFIX[kind]}${REPORT_FILE_DATE_SEPARATOR}${formatCompactDate(runDay)}${REPORT_FILE_EXTENSION}`;
}
