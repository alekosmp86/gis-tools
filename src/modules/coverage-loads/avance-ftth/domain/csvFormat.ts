import { CSV_ENCLOSURE, CSV_SEPARATOR } from "../../constants";

const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";
const ESCAPED_ENCLOSURE = CSV_ENCLOSURE + CSV_ENCLOSURE;

function needsEnclosure(value: string): boolean {
  return (
    value.includes(CSV_SEPARATOR) ||
    value.includes(CSV_ENCLOSURE) ||
    value.includes(LINE_FEED) ||
    value.includes(CARRIAGE_RETURN)
  );
}

/** Encloses in `"` only when the value contains `;`, `"` or a line break (legacy `enclosure_forced N`). */
function formatCsvField(value: string): string {
  return needsEnclosure(value) ? CSV_ENCLOSURE + value.split(CSV_ENCLOSURE).join(ESCAPED_ENCLOSURE) + CSV_ENCLOSURE : value;
}

/** One LF-terminated CSV line. */
export function formatCsvLine(values: ReadonlyArray<string>): string {
  return values.map(formatCsvField).join(CSV_SEPARATOR) + LINE_FEED;
}
