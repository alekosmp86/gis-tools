/**
 * watcherFormatters.ts
 * Pure formatting and routing helper utilities for Cartography Watcher presentation.
 */

import { isCsvFormat, isShapefileCompatibleFormat } from "../types/watcher";

/**
 * Formats a raw byte count into human-readable MB or KB strings.
 */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "Desconocido";
  const megaBytes = bytes / (1024 * 1024);
  if (megaBytes >= 1) {
    return `${megaBytes.toFixed(2)} MB`;
  }
  const kiloBytes = bytes / 1024;
  return `${kiloBytes.toFixed(1)} KB`;
}

/**
 * Formats an ISO date string into standard DD/MM/YYYY (with optional HH:mm).
 */
export function formatDate(
  dateString?: string | null,
  includeTime: boolean = false
): string {
  if (!dateString) return "Fecha no disponible";
  const parsedDate = new Date(dateString);
  if (isNaN(parsedDate.getTime())) return dateString;

  const year = parsedDate.getUTCFullYear();
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getUTCDate()).padStart(2, "0");

  if (includeTime) {
    const hours = String(parsedDate.getUTCHours()).padStart(2, "0");
    const minutes = String(parsedDate.getUTCMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  return `${day}/${month}/${year}`;
}

/**
 * Derives the target synchronization tool route based on the resource's spatial format.
 */
export function getTargetSyncUrl(
  format?: string | null,
  sourceSlug?: string,
  resourceId?: string
): string | null {
  if (!resourceId) return null;

  const isCsv = isCsvFormat(format);
  const isShp = isShapefileCompatibleFormat(format);

  const encodedSource = encodeURIComponent(sourceSlug || "");
  const encodedResource = encodeURIComponent(resourceId);

  if (isCsv) {
    return `/tools/db-csv-sync?sourceSlug=${encodedSource}&resourceId=${encodedResource}`;
  }
  if (isShp) {
    return `/tools/db-shapefile-sync?sourceSlug=${encodedSource}&resourceId=${encodedResource}`;
  }

  return null;
}
