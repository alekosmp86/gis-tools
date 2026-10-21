import { REJECTED_CSV_HEADER, REJECTED_FILE_PREFIX } from "../../constants";
import type { RejectedRow } from "../types";
import { formatCompactDate } from "../../shared/domain/compactDate";
import { formatCsvLine } from "./csvFormat";

const CSV_EXTENSION = ".csv";

/**
 * The rejected rows as CSV text (`archivo;linea;texto;motivo`), to be encoded as UTF-8 by the
 * caller. Pure and free of node imports, so the browser builds the download itself.
 */
export function buildRejectedCsv(rows: ReadonlyArray<RejectedRow>): string {
  const lines = rows.map((row) => formatCsvLine([row.file, String(row.line), row.text, row.reason]));
  return formatCsvLine(REJECTED_CSV_HEADER) + lines.join("");
}

export function buildRejectedFileName(runDay: Date): string {
  return `${REJECTED_FILE_PREFIX}_${formatCompactDate(runDay)}${CSV_EXTENSION}`;
}
