/**
 * Standard application locale for UI number and text formatting
 */
export const APP_LOCALE = "es-UY";

/**
 * Formats an integer or general count with standard thousands separators (e.g. 12500 -> "12.500")
 */
export function formatNumber(
  value: number | string | null | undefined,
  fallback: string = "0"
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num)) return fallback;
  return num.toLocaleString(APP_LOCALE);
}

/**
 * Formats byte size into human-readable units (e.g. 1048576 -> "1,00 MB")
 */
export function formatFileSize(bytes: number | null | undefined, fallback: string = "0 B"): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) return fallback;
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);

  return `${val.toLocaleString(APP_LOCALE, {
    minimumFractionDigits: i > 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })} ${sizes[i]}`;
}
