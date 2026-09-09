/**
 * watcher.ts
 * Domain contracts and data models for the Cartography Watcher module.
 * Integrates with CKAN API v3 (catalogodatos.gub.uy).
 */

export interface CkanResource {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly url: string;
  readonly hash?: string;
  readonly last_modified?: string | null;
  readonly metadata_modified?: string | null;
  readonly created?: string | null;
  readonly size?: number | null;
  readonly description?: string;
  readonly state?: string;
  readonly mimetype?: string;
}

export interface CkanPackage {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly notes?: string;
  readonly metadata_modified: string;
  readonly metadata_created?: string;
  readonly update_frequency?: string;
  readonly author?: string;
  readonly maintainer?: string;
  readonly resources: CkanResource[];
}

export interface CkanPackageResponse {
  readonly success: boolean;
  readonly result: CkanPackage;
  readonly error?: {
    readonly message: string;
    readonly __type: string;
  };
}

export interface VaultResourceMeta {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly format: string;
  readonly hash: string;
  readonly remoteLastModified: string;
  readonly downloadedAt: string;
  readonly fileSize: number;
  readonly localFilePath: string;
  readonly relativeFilePath: string;
}

export const DeltaStatus = {
  UP_TO_DATE: "UP_TO_DATE",
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
  NOT_DOWNLOADED: "NOT_DOWNLOADED",
} as const;

export type DeltaStatus = (typeof DeltaStatus)[keyof typeof DeltaStatus];

export interface WatchResourceDelta {
  readonly resource: CkanResource;
  readonly status: DeltaStatus;
  readonly reason?: string;
  readonly localMeta?: VaultResourceMeta | null;
}

export interface WatcherSourceCheckResult {
  readonly datasetSlug: string;
  readonly datasetTitle: string;
  readonly datasetModified: string;
  readonly updateFrequency?: string;
  readonly totalResources: number;
  readonly updatesCount: number;
  readonly resources: WatchResourceDelta[];
}

export interface WatchedSourceConfig {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly datasetSlug: string;
  readonly description?: string;
  readonly category?: string;
  readonly isDefault?: boolean;
}

export const SourceBadgeState = {
  UP_TO_DATE: "UP_TO_DATE",
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
  NOT_DOWNLOADED: "NOT_DOWNLOADED",
  CHECKING: "CHECKING",
  ERROR: "ERROR",
} as const;

export type SourceBadgeState = (typeof SourceBadgeState)[keyof typeof SourceBadgeState];

export interface SourceCheckSummary {
  readonly sourceId: string;
  readonly datasetSlug: string;
  readonly title: string;
  readonly status: SourceBadgeState;
  readonly totalResources: number;
  readonly updatesCount: number;
  readonly lastChecked?: string;
  readonly errorMessage?: string;
}

export interface CatalogResourceItem {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly size?: number | null;
  readonly lastModified?: string | null;
  readonly url?: string | null;
  readonly isCached: boolean;
}

export interface CatalogSourceGroup {
  readonly sourceSlug: string;
  readonly title: string;
  readonly description?: string;
  readonly resources: CatalogResourceItem[];
}

export const WATCHED_SOURCE_CATEGORY = {
  DEFAULT: "Predeterminado",
  CUSTOM: "Personalizado",
} as const;

export type WatchedSourceCategory =
  (typeof WATCHED_SOURCE_CATEGORY)[keyof typeof WATCHED_SOURCE_CATEGORY];

export const CATALOG_FILTER_ALL = "TODOS";

export const CatalogFormatFilter = {
  ALL: "ALL",
  CSV: "CSV",
  SHP: "SHP",
} as const;

export type CatalogFormatFilter =
  (typeof CatalogFormatFilter)[keyof typeof CatalogFormatFilter];

export const SpatialFileFormat = {
  CSV: "CSV",
  SHP: "SHP",
  ZIP: "ZIP",
  GEOJSON: "GEOJSON",
  JSON: "JSON",
} as const;

export type SpatialFileFormat =
  (typeof SpatialFileFormat)[keyof typeof SpatialFileFormat];

export function isCsvFormat(rawFormat?: string | null): boolean {
  if (!rawFormat) return false;
  return rawFormat.toUpperCase().trim() === SpatialFileFormat.CSV;
}

export function isShapefileCompatibleFormat(rawFormat?: string | null): boolean {
  if (!rawFormat) return false;
  const upper = rawFormat.toUpperCase().trim();
  return (
    upper === SpatialFileFormat.SHP ||
    upper === SpatialFileFormat.ZIP ||
    upper.includes(SpatialFileFormat.SHP) ||
    upper === SpatialFileFormat.GEOJSON ||
    upper === SpatialFileFormat.JSON
  );
}

export const WatcherApiAction = {
  SOURCES: "sources",
  CATALOG_TREE: "catalog-tree",
  CATALOG_FILE: "catalog-file",
  VAULT_FILE: "vault-file",
  SUMMARIES: "summaries",
  ADD_SOURCE: "add-source",
  REMOVE_SOURCE: "remove-source",
  DOWNLOAD: "download",
} as const;

export type WatcherApiAction =
  (typeof WatcherApiAction)[keyof typeof WatcherApiAction];

