import { CSV_ENCLOSURE, CSV_SEPARATOR } from "../constants";

const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";
const ESCAPED_ENCLOSURE = CSV_ENCLOSURE + CSV_ENCLOSURE;
const TRAILING_WHITESPACE = /\s+$/;

function needsEnclosure(value: string): boolean {
  return (
    value.includes(CSV_SEPARATOR) ||
    value.includes(CSV_ENCLOSURE) ||
    value.includes(LINE_FEED) ||
    value.includes(CARRIAGE_RETURN)
  );
}

/** Right-trims, then encloses in `"` only when the value contains `;`, `"` or a line break. */
export function formatCsvField(value: string): string {
  const trimmed = value.replace(TRAILING_WHITESPACE, "");
  return needsEnclosure(trimmed)
    ? CSV_ENCLOSURE + trimmed.split(CSV_ENCLOSURE).join(ESCAPED_ENCLOSURE) + CSV_ENCLOSURE
    : trimmed;
}

/** One LF-terminated CSV line. */
export function formatCsvLine(values: ReadonlyArray<string>): string {
  return values.map(formatCsvField).join(CSV_SEPARATOR) + LINE_FEED;
}
