export const EMPTY_CELL = "—";

/** Raw value for a table cell; an em dash when null or blank, never the text "null". */
export function formatCell(value: string | null): string {
  return value === null || value.trim().length === 0 ? EMPTY_CELL : value;
}

/** Spanish plural: the singular form for exactly one, the plural form otherwise. */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
