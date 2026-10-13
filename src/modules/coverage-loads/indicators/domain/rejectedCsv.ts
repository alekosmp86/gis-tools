import { REJECTED_CSV_HEADER, REJECTED_FILE_PREFIX, REPORT_FILE_EXTENSION } from "../constants";
import type { RejectedRow } from "../types";
import { formatCompactDate } from "./compactDate";
import { formatCsvLine } from "./csvFormat";

/**
 * The rejected rows as CSV text (`archivo;linea;texto;motivo`), to be encoded as UTF-8 by the
 * caller. Pure and free of node imports, so the browser builds the download itself.
 */
export function buildRejectedCsv(rows: ReadonlyArray<RejectedRow>): string {
  const lines = rows.map((row) => formatCsvLine([row.file, String(row.line), row.text, row.reason]));
  return formatCsvLine(REJECTED_CSV_HEADER) + lines.join("");
}

export function buildRejectedFileName(runDay: Date): string {
  return `${REJECTED_FILE_PREFIX}_${formatCompactDate(runDay)}${REPORT_FILE_EXTENSION}`;
}
