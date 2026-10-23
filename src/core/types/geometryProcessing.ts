export const OverlapPolicy = {
  BLOCK: "block",
  REPORT: "report",
} as const;

export type OverlapPolicy = (typeof OverlapPolicy)[keyof typeof OverlapPolicy];

export const DEFAULT_OVERLAP_MIN_AREA_M2 = 1;

export interface GeometryProcessingOptions {
  readonly repair: { readonly enabled: boolean };
  readonly unify: { readonly enabled: boolean; readonly keyFields: readonly string[] };
  readonly overlaps: { readonly enabled: boolean; readonly policy: OverlapPolicy; readonly minAreaM2: number };
}

export const DEFAULT_GEOMETRY_PROCESSING: GeometryProcessingOptions = {
  repair: { enabled: false },
  unify: { enabled: false, keyFields: [] },
  overlaps: { enabled: false, policy: OverlapPolicy.BLOCK, minAreaM2: DEFAULT_OVERLAP_MIN_AREA_M2 },
};

export type GroupKeyValues = Readonly<Record<string, string | null>>;

export interface LargestGroup {
  readonly key: GroupKeyValues;
  readonly size: number;
}

export interface ConflictColumnSample {
  readonly column: string;
  readonly distinctValues: ReadonlyArray<string | null>;
  readonly keptValue: string | null;
}

export interface AttributeConflictSample {
  readonly key: GroupKeyValues;
  readonly columns: ReadonlyArray<ConflictColumnSample>;
}

export interface OverlapSample {
  readonly recA: number;
  readonly recB: number;
  readonly area: number;
  readonly keyA: GroupKeyValues;
  readonly keyB: GroupKeyValues;
}

export interface StepTiming {
  readonly label: string;
  readonly ms: number;
}

export interface GeometryProcessingReport {
  readonly invalidBefore: number;
  readonly repaired: number;
  readonly emptyAfterRepair: number;
  readonly groups: number;
  readonly rowsMerged: number;
  readonly largestGroups: ReadonlyArray<LargestGroup>;
  readonly attributeConflicts: number;
  readonly attributeConflictSamples: ReadonlyArray<AttributeConflictSample>;
  readonly nullKeyRows: number;
  readonly overlapCount: number;
  readonly overlapSamples: ReadonlyArray<OverlapSample>;
  readonly overlapSkippedInvalid: number;
  readonly insertedInvalid: number;
  readonly incompatibleGeometryRows: number;
  readonly incompatibleTargetType: string | null;
  readonly wouldBlock: boolean;
  readonly stepTimings: ReadonlyArray<StepTiming>;
  readonly processingMs: number;
}

export const EMPTY_GEOMETRY_REPORT: GeometryProcessingReport = {
  invalidBefore: 0,
  repaired: 0,
  emptyAfterRepair: 0,
  groups: 0,
  rowsMerged: 0,
  largestGroups: [],
  attributeConflicts: 0,
  attributeConflictSamples: [],
  nullKeyRows: 0,
  overlapCount: 0,
  overlapSamples: [],
  overlapSkippedInvalid: 0,
  insertedInvalid: 0,
  incompatibleGeometryRows: 0,
  incompatibleTargetType: null,
  wouldBlock: false,
  stepTimings: [],
  processingMs: 0,
};
