/**
 * Spanish presentation helpers.
 *
 * Pure and free of `Intl` locale surprises where it matters: sizes and relative dates are rendered
 * the same way on the server and in the browser, so a value never changes when a component
 * hydrates.
 */

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Renders a byte count at the largest unit that keeps the number readable. */
export function formatFileSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes === null || sizeBytes === undefined || Number.isNaN(sizeBytes)) {
    return "Tamaño desconocido";
  }
  if (sizeBytes <= 0) {
    return "0 B";
  }

  let remaining = sizeBytes;
  let unitIndex = 0;

  while (remaining >= BYTES_PER_UNIT && unitIndex < SIZE_UNITS.length - 1) {
    remaining /= BYTES_PER_UNIT;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 || remaining >= 100 ? 0 : 1;
  return `${remaining.toFixed(decimals)} ${SIZE_UNITS[unitIndex]}`;
}

/** Renders a portal timestamp as a fixed `dd/mm/aaaa`, or a placeholder when it is unusable. */
export function formatPublicationDate(rawTimestamp: string | null | undefined): string {
  if (!rawTimestamp) {
    return "Sin fecha";
  }

  const parsed = new Date(rawTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "Sin fecha";
  }

  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${parsed.getUTCFullYear()}`;
}

/** Pluralises the pending count into the sentence the dashboard shows. */
export function describePendingCount(pendingCount: number): string {
  if (pendingCount <= 0) {
    return "Sin novedades";
  }
  return pendingCount === 1 ? "1 archivo pendiente" : `${pendingCount} archivos pendientes`;
}
