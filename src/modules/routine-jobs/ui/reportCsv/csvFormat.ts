export type CsvCell = string | number | null;
export type CsvRow = readonly CsvCell[];

const BOM = "\uFEFF";
const FIELD_SEPARATOR = ",";
const ROW_SEPARATOR = "\r\n";
const FORMULA_TRIGGERS: readonly string[] = ["=", "+", "-", "@", "\t", "\r"];
const QUOTE_PATTERN = /[",\r\n]/;

const guardFormula = (text: string): string =>
  FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger)) ? `'${text}` : text;

const quoteIfNeeded = (text: string): string =>
  QUOTE_PATTERN.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

const textCellOf = (text: string): string => quoteIfNeeded(guardFormula(text));

const cellOf = (cell: CsvCell): string => {
  if (cell === null) return "";
  if (typeof cell === "number") return String(cell);
  return textCellOf(cell);
};

const rowOf = (row: CsvRow): string => row.map(cellOf).join(FIELD_SEPARATOR);

export const toCsv = (rows: readonly CsvRow[]): string => BOM + rows.map(rowOf).join(ROW_SEPARATOR);
