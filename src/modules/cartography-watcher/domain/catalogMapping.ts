import { CatalogFormatFilter, DeltaStatus, SourceBadgeState } from "../types";
import type {
  CatalogResourceItem,
  CkanResource,
  ResourceDelta,
  SourceSummary,
} from "../types";

/**
 * Maps portal metadata into what the interface shows.
 *
 * Pure: which resources a tool may accept, what badge a source deserves, and how a resource reads
 * in a tree. Keeping this out of the services is what lets the rules be tested exhaustively.
 */

/** Formats the CSV sync tool can ingest. */
const CSV_FORMATS = new Set(["CSV", "TXT"]);

/** Formats the shapefile sync tool can ingest, including the zipped shapefile bundle. */
const SHAPEFILE_FORMATS = new Set(["SHP", "ZIP", "GEOJSON", "JSON"]);

function normalizeFormat(rawFormat: string | null | undefined): string {
  return (rawFormat ?? "").toUpperCase().trim();
}

export function isCsvCompatible(rawFormat: string | null | undefined): boolean {
  return CSV_FORMATS.has(normalizeFormat(rawFormat));
}

export function isShapefileCompatible(rawFormat: string | null | undefined): boolean {
  const format = normalizeFormat(rawFormat);
  return SHAPEFILE_FORMATS.has(format) || format.includes("SHP");
}

/** Whether a resource should appear under the requested filter. */
export function matchesFormatFilter(
  rawFormat: string | null | undefined,
  filter: CatalogFormatFilter
): boolean {
  if (filter === CatalogFormatFilter.ALL) {
    return true;
  }
  if (filter === CatalogFormatFilter.CSV) {
    return isCsvCompatible(rawFormat);
  }
  return isShapefileCompatible(rawFormat);
}

/** Normalises whatever arrives from the portal into a filter value. */
export function parseFormatFilter(rawValue: string | null): CatalogFormatFilter {
  const candidate = normalizeFormat(rawValue);

  if (candidate === CatalogFormatFilter.CSV) {
    return CatalogFormatFilter.CSV;
  }
  if (candidate === CatalogFormatFilter.SHP) {
    return CatalogFormatFilter.SHP;
  }
  return CatalogFormatFilter.ALL;
}

export function toCatalogResourceItem(
  resource: CkanResource,
  isCached: boolean
): CatalogResourceItem {
  return {
    id: resource.id,
    name: resource.name,
    format: normalizeFormat(resource.format),
    sizeBytes: resource.size ?? null,
    lastModified: resource.last_modified ?? resource.metadata_modified ?? null,
    isCached,
  };
}

/**
 * Reduces a source's deltas to the one badge that describes it.
 *
 * The badge must agree with the pending count beside it: a source is only "al día" when there is
 * nothing left to fetch. Reporting that state because *some* file was downloaded — while twenty
 * others were never fetched — is the misleading zero-delta state this tool exists to avoid.
 *
 * A stale copy outranks a missing one: it is the more urgent of the two, and the only one that
 * means data already in use has gone out of date.
 */
export function deriveSourceBadge(deltas: ReadonlyArray<ResourceDelta>): SourceBadgeState {
  if (deltas.length === 0) {
    return SourceBadgeState.UP_TO_DATE;
  }

  if (deltas.some((delta) => delta.status === DeltaStatus.UPDATE_AVAILABLE)) {
    return SourceBadgeState.UPDATE_AVAILABLE;
  }

  if (deltas.some((delta) => delta.status === DeltaStatus.NOT_DOWNLOADED)) {
    return SourceBadgeState.NOT_DOWNLOADED;
  }

  return SourceBadgeState.UP_TO_DATE;
}

/** Summary for a source whose inspection failed, so one unreachable portal cannot hide the rest. */
export function buildErrorSummary(
  sourceId: string,
  datasetSlug: string,
  title: string,
  errorMessage: string,
  checkedAt: string
): SourceSummary {
  return {
    sourceId,
    datasetSlug,
    title,
    status: SourceBadgeState.ERROR,
    totalResources: 0,
    pendingCount: 0,
    checkedAt,
    errorMessage,
  };
}
