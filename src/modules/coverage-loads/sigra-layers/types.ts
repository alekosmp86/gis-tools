import type { PgClientFactory } from "../shared/pgClient";
import type { SigraLayerId } from "./constants";

export const GeomColumn = {
  GEOM: "geom",
  GEOMETRY: "geometry",
} as const;

export type GeomColumn = (typeof GeomColumn)[keyof typeof GeomColumn];

export interface SigraLayerDefinition {
  readonly id: SigraLayerId;
  readonly label: string;
  readonly required: boolean;
  readonly etlName: string;
  readonly typeName: string;
  readonly cql: string | null;
  readonly pageSize: number;
  readonly sortBy: string;
  readonly finalTable: string;
  readonly keyColumn: string;
  readonly geomColumn: GeomColumn;
  readonly extraStagingColumns: ReadonlyArray<string>;
}

export interface WfsFeature {
  readonly geometry?: unknown;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface WfsPage {
  readonly features: ReadonlyArray<WfsFeature>;
  readonly numberMatched: number | null;
}

export type MappedValue = string | number | null;

export interface MappedFeature {
  readonly values: Readonly<Record<string, MappedValue>>;
  readonly geometryJson: string | null;
}

export interface ColumnMapping {
  readonly column: string;
  readonly property: string;
}

export interface DerivedColumn {
  readonly column: string;
  readonly derive: (
    properties: Readonly<Record<string, unknown>>,
    values: Readonly<Record<string, MappedValue>>,
  ) => MappedValue;
}

export const ComputedKind = {
  LOAD_DATE: "load-date",
  SOURCE: "source",
  AREA: "area",
  ROUNDED_AREA: "rounded-area",
  LATITUDE: "latitude",
  LONGITUDE: "longitude",
} as const;

export type ComputedKind = (typeof ComputedKind)[keyof typeof ComputedKind];

export interface ComputedColumn {
  readonly column: string;
  readonly kind: ComputedKind;
}

export interface LayerMapping {
  readonly direct: ReadonlyArray<ColumnMapping>;
  readonly derived: ReadonlyArray<DerivedColumn>;
  readonly computed: ReadonlyArray<ComputedColumn>;
}

export interface LayerColumns {
  readonly valueColumns: ReadonlyArray<string>;
  readonly computed: ReadonlyArray<ComputedColumn>;
  readonly stagingColumns: ReadonlyArray<string>;
  readonly swapColumns: ReadonlyArray<string>;
  readonly loadDateColumn: string;
}

export interface LoadVerdictInput {
  readonly stagedCount: number;
  readonly finalCount: number;
}

export interface LoadVerdict {
  readonly ok: boolean;
  readonly ratio: number | null;
  readonly message: string;
}

export interface WfsPageFetcher {
  fetchPage(url: string): Promise<WfsPage>;
}

export interface WfsClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface LayerDbState {
  readonly layerId: SigraLayerId;
  readonly tableExists: boolean;
  readonly rowCount: number | null;
  readonly lastUpdated: string | null;
  readonly missingPrivileges: ReadonlyArray<string>;
}

export interface SigraDbState {
  readonly layers: ReadonlyArray<LayerDbState>;
  readonly canCreateTemp: boolean;
  readonly auditAvailable: boolean;
}

export const LayerLoadStatus = {
  LOADED: "loaded",
  DRY_RUN_OK: "dry-run-ok",
  REJECTED_VALIDATION: "rejected-validation",
  FAILED: "failed",
} as const;

export type LayerLoadStatus = (typeof LayerLoadStatus)[keyof typeof LayerLoadStatus];

export const LayerLoadStep = {
  WFS: "wfs",
  INSERT: "insert",
  VALIDATION: "validacion",
  SWAP: "swap",
} as const;

export type LayerLoadStep = (typeof LayerLoadStep)[keyof typeof LayerLoadStep];

export interface LayerLoadResult {
  readonly layerId: SigraLayerId;
  readonly status: LayerLoadStatus;
  readonly downloaded: number;
  readonly staged: number;
  readonly duplicatesIgnored: number;
  readonly previousCount: number | null;
  readonly finalCount: number | null;
  readonly elapsedMs: number;
  readonly step: LayerLoadStep | null;
  readonly message: string;
  readonly auditWarning: string | null;
}

export interface LoadLayerOptions {
  readonly dryRun: boolean;
}

export interface SigraRepositoryOptions {
  readonly createClient?: PgClientFactory;
  readonly fetcher?: WfsPageFetcher;
  readonly now?: () => number;
}

export interface LayerProbe {
  readonly layerId: SigraLayerId;
  readonly numberMatched: number | null;
  readonly error: string | null;
}

export interface PlanLayer {
  readonly layerId: SigraLayerId;
  readonly label: string;
  readonly required: boolean;
  readonly tableExists: boolean;
  readonly rowCount: number | null;
  readonly lastUpdated: string | null;
  readonly missingPrivileges: ReadonlyArray<string>;
  readonly wfsCount: number | null;
  readonly wfsError: string | null;
  readonly blockers: ReadonlyArray<string>;
  readonly canLoad: boolean;
}

export interface SigraPlan {
  readonly layers: ReadonlyArray<PlanLayer>;
  readonly blockers: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly canLoad: boolean;
}

export interface SigraPlanInput {
  readonly layerIds: ReadonlyArray<SigraLayerId>;
  readonly state: SigraDbState;
  readonly probes: ReadonlyArray<LayerProbe>;
}

export interface SigraPlanResponse {
  readonly success: true;
  readonly plan: SigraPlan;
}

export interface SigraLoadResponse {
  readonly success: true;
  readonly dryRun: boolean;
  readonly results: ReadonlyArray<LayerLoadResult>;
}

export interface SigraErrorResponse {
  readonly success: false;
  readonly error: string;
  readonly plan?: SigraPlan;
}

export interface SigraLoadAnswer {
  readonly results: ReadonlyArray<LayerLoadResult>;
  readonly dryRun: boolean;
}

export interface LoadProgress {
  downloaded: number;
  staged: number;
  previousCount: number | null;
  finalCount: number | null;
}

export interface LoadOutcome {
  readonly status: LayerLoadStatus;
  readonly step: LayerLoadStep | null;
  readonly message: string;
}

export interface AuditHandle {
  readonly id: number | null;
  readonly warning: string | null;
}

export type PageWriter = (features: ReadonlyArray<WfsFeature>) => Promise<number>;

export interface PageSource {
  readonly fetchPage: (url: string) => Promise<WfsPage>;
}
