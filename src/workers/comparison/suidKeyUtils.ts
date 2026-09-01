/**
 * suidKeyUtils.ts
 * Normalización y construcción de claves SUID (simples o compuestas) para comparación matricial.
 */

export function cleanValue(rawVal: unknown): string {
  if (rawVal === null || rawVal === undefined) return "";
  let text = String(rawVal).trim();
  text = text.replace(/^["']|["']$/g, "").trim();
  text = text.replace(/[\r\n\t\xa0]/g, "");
  if (text.endsWith(".0")) text = text.slice(0, -2);
  return text;
}

export function cleanSuid(rawVal: unknown): string {
  return cleanValue(rawVal).toLowerCase();
}

export function buildCompositeKeyFromRecord(
  record: Record<string, unknown>,
  columns: string[]
): string {
  const cleanedValues = columns.map((columnName) => cleanSuid(record[columnName]));
  if (columns.length === 1) {
    if (!cleanedValues[0]) return "";
  } else {
    if (cleanedValues.every((value) => !value)) return "";
  }
  return cleanedValues.join("_");
}

export function buildCompositeRawSuidFromRecord(
  record: Record<string, unknown>,
  columns: string[]
): string {
  const parts: string[] = columns.map((columnName) => {
    const value = cleanValue(record[columnName]);
    return value !== "" ? value : "NULL";
  });
  return parts.join(" | ");
}
