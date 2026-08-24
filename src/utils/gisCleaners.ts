/**
 * Normalizes attribute string values according to GIS domain rules:
 * - Strips surrounding single or double quotes (e.g. '"TA014I111T9"' -> 'TA014I111T9').
 * - Strips non-breaking spaces (\xa0), tabs, and newlines.
 * - Strips floating point '.0' suffixes (e.g. '1002.0' -> '1002').
 */
export function cleanValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  // Strip surrounding quotes if present
  str = str.replace(/^["']|["']$/g, "").trim();
  str = str.replace(/[\r\n\t\xa0]/g, "");
  if (str.endsWith(".0")) {
    str = str.slice(0, -2);
  }
  return str;
}

/**
 * Normalizes SUID key strings (lowercased for key lookups).
 */
export function cleanSuid(val: unknown): string {
  return cleanValue(val).toLowerCase();
}
