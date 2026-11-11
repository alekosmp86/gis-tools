/**
 * Domain contracts for the cartography watcher.
 *
 * Owned by the module: nothing here belongs in core, because nothing outside this folder has any
 * reason to know that CKAN, vaults or deltas exist.
 *
 * Shapes prefixed `Ckan` mirror the CKAN Action API v3 as served by catalogodatos.gub.uy.
 */

export interface CkanResource {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly url: string;
  readonly hash?: string;
  readonly last_modified?: string | null;
  readonly metadata_modified?: string | null;
  readonly size?: number | null;
  readonly description?: string;
}

export interface CkanPackage {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly notes?: string;
  readonly metadata_modified: string;
  readonly resources: ReadonlyArray<CkanResource>;
}

export interface CkanPackageResponse {
  readonly success: boolean;
  readonly result?: CkanPackage;
  readonly error?: { readonly message?: string };
}

/** How a watched source is reached. A row persisted without `kind` is a CKAN dataset. */
export const WatchedSourceKind = {
  CKAN: "ckan",
  DIRECT_URL: "direct-url",
} as const;

export type WatchedSourceKind = (typeof WatchedSourceKind)[keyof typeof WatchedSourceKind];

/** A portal dataset, or a direct service URL, the user is watching. */
export interface WatchedSource {
  readonly id: string;
  readonly title: string;
  readonly datasetSlug: string;
  readonly portalHost: string;
  readonly description?: string;
  /** Shipped with the module and not removable, as opposed to one the user added. */
  readonly isDefault: boolean;
  readonly kind?: WatchedSourceKind;
  /** Only for `direct-url` sources: the `http(s)` URL that serves the zipped shapefile. */
  readonly directUrl?: string;
  /** Non-blocking findings from the last validation of a `direct-url` source. */
  readonly warnings?: ReadonlyArray<string>;
}

/** Body the client sends to add a source. */
export type AddSourceRequest =
  | { readonly kind: typeof WatchedSourceKind.CKAN; readonly url: string }
  | {
      readonly kind: typeof WatchedSourceKind.DIRECT_URL;
      readonly title: string;
      readonly url: string;
    };

/** Fields of a source the user may change through an edit. */
export interface SourceEditChanges {
  readonly title?: string;
  readonly url?: string;
}

/** A source list plus the non-blocking warnings the operation produced. */
export interface SourceMutationResult {
  readonly sources: ReadonlyArray<WatchedSource>;
  readonly warnings: ReadonlyArray<string>;
}

/** Sidecar metadata written beside every file the vault stores. */
export interface VaultResourceMeta {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly format: string;
  readonly hash: string;
  readonly remoteLastModified: string;
  readonly downloadedAt: string;
  readonly fileSize: number;
  readonly relativeFilePath: string;
}

/** Outcome of renaming a source vault directory across a slug change. */
export const VaultRenameResult = {
  RENAMED: "RENAMED",
  SOURCE_ABSENT: "SOURCE_ABSENT",
  DESTINATION_EXISTS: "DESTINATION_EXISTS",
  FAILED: "FAILED",
} as const;

export type VaultRenameResult = (typeof VaultRenameResult)[keyof typeof VaultRenameResult];

/** How a remote resource compares with the copy in the vault. */
export const DeltaStatus = {
  UP_TO_DATE: "UP_TO_DATE",
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
  NOT_DOWNLOADED: "NOT_DOWNLOADED",
} as const;

export type DeltaStatus = (typeof DeltaStatus)[keyof typeof DeltaStatus];

export interface ResourceDelta {
  readonly resource: CkanResource;
  readonly status: DeltaStatus;
  /** Why the status was reached, in Spanish, for direct display. */
  readonly reason: string;
  readonly localMeta: VaultResourceMeta | null;
}

/** Aggregate state of one watched source. */
export const SourceBadgeState = {
  UP_TO_DATE: "UP_TO_DATE",
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
  NOT_DOWNLOADED: "NOT_DOWNLOADED",
  ON_DEMAND: "ON_DEMAND",
  ERROR: "ERROR",
} as const;

export type SourceBadgeState = (typeof SourceBadgeState)[keyof typeof SourceBadgeState];

export interface SourceSummary {
  readonly sourceId: string;
  readonly datasetSlug: string;
  readonly title: string;
  readonly status: SourceBadgeState;
  readonly totalResources: number;
  /** Resources that are either outdated or absent locally — everything worth acting on. */
  readonly pendingCount: number;
  readonly checkedAt: string;
  readonly errorMessage?: string;
}

/** One selectable file in the catalogue tree. */
export interface CatalogResourceItem {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly sizeBytes: number | null;
  readonly lastModified: string | null;
  readonly isCached: boolean;
}

export interface CatalogSourceGroup {
  readonly sourceId: string;
  readonly datasetSlug: string;
  readonly title: string;
  readonly description?: string;
  readonly resources: ReadonlyArray<CatalogResourceItem>;
}

/** Formats the catalogue can be filtered to, matching what the sync tools accept. */
export const CatalogFormatFilter = {
  ALL: "ALL",
  CSV: "CSV",
  SHP: "SHP",
} as const;

export type CatalogFormatFilter =
  (typeof CatalogFormatFilter)[keyof typeof CatalogFormatFilter];

/** Live download progress payload for a catalogue resource. */
export interface CatalogDownloadProgress {
  readonly phase: string;
  readonly current: number;
  readonly total: number;
}

/** Selection request bundling the selected resource with its parent group. */
export interface CatalogSelectionRequest {
  readonly group: CatalogSourceGroup;
  readonly resource: CatalogResourceItem;
}
