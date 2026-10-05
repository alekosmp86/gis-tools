/** Source name as carried by `carto.v_address_build.name_font`. */
export const Fuente = {
  ANTEL: "ANTEL",
  IDE: "IDE",
  TLK: "TLK",
} as const;

export type Fuente = (typeof Fuente)[keyof typeof Fuente];

export const Decision = {
  KEEP: "KEEP",
  REMOVE: "REMOVE",
} as const;

export type Decision = (typeof Decision)[keyof typeof Decision];

export const DecisionReason = {
  PROTECTED_SOURCE: "PROTECTED_SOURCE",
  INFRA_MATCHED: "INFRA_MATCHED",
  NO_DUPLICATE: "NO_DUPLICATE",
  LOWEST_URN_KEPT: "LOWEST_URN_KEPT",
  KEPT_ALONGSIDE_PROTECTED: "KEPT_ALONGSIDE_PROTECTED",
  REDUNDANT_WITH_MATCHED: "REDUNDANT_WITH_MATCHED",
  REDUNDANT_NOT_LOWEST_URN: "REDUNDANT_NOT_LOWEST_URN",
  REDUNDANT_WITH_PROTECTED: "REDUNDANT_WITH_PROTECTED",
  HAS_INTERNAL_UNITS: "HAS_INTERNAL_UNITS",
} as const;

export type DecisionReason = (typeof DecisionReason)[keyof typeof DecisionReason];

/** Reasons that flag a row as needing a human look; the one definition of "review". */
export const REVIEW_REASONS: ReadonlyArray<DecisionReason> = [
  DecisionReason.KEPT_ALONGSIDE_PROTECTED,
  DecisionReason.HAS_INTERNAL_UNITS,
];

export const DedupScope = {
  REMOVAL_GROUPS: "REMOVAL_GROUPS",
  ALL_DUPLICATE_GROUPS: "ALL_DUPLICATE_GROUPS",
} as const;

export type DedupScope = (typeof DedupScope)[keyof typeof DedupScope];

export const ExportFormat = {
  CSV: "csv",
  GEOJSON: "geojson",
  LINKS: "links",
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

/** Rules the v3 query runs with unless a request overrides them. Typed const only, no UI. */
export const DedupRules = {
  REMOVABLE_FUENTES: [Fuente.ANTEL, Fuente.TLK],
  PROTECTED_FUENTES: [Fuente.IDE],
  GEO_DECIMALS_WITH_PADRON: 2,
  GEO_DECIMALS_WITHOUT_PADRON: 3,
  PROTECTED_SIBLING_REMOVES_LONE: false,
  SCOPE: DedupScope.REMOVAL_GROUPS,
} as const;

export const DOCUMENT_TYPE_PARENT = "PARENT";

export const CONNECTION_TIMEOUT_MS = 10000;

/** The query is heavy and runs against production, so it gets a generous but finite budget. */
export const STATEMENT_TIMEOUT_MS = 180000;

export const DEFAULT_DB_HOST = "localhost";
export const DEFAULT_DB_PORT = 5432;

/** Province preselected in the UI (FLORES). */
export const DEFAULT_PROVINCE_ID = 7;

/** Delay before revoking a download URL, so the browser has started the download. */
export const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

/** Sentinel for "no filter" in the group table selects. */
export const FILTER_ALL = "ALL";

export const DecisionFilter = {
  ALL: FILTER_ALL,
  KEEP: Decision.KEEP,
  REMOVE: Decision.REMOVE,
} as const;

export type DecisionFilter = (typeof DecisionFilter)[keyof typeof DecisionFilter];

export const GroupSort = {
  GROUP_ASC: "GROUP_ASC",
  SIZE_DESC: "SIZE_DESC",
  REMOVALS_DESC: "REMOVALS_DESC",
} as const;

export type GroupSort = (typeof GroupSort)[keyof typeof GroupSort];

export const DedupTab = {
  SUMMARY: "SUMMARY",
  GROUPS: "GROUPS",
} as const;

export type DedupTab = (typeof DedupTab)[keyof typeof DedupTab];

/** Column that gathers every fuente outside ANTEL/TLK/IDE, including rows with no fuente. */
export const OTHER_FUENTE_COLUMN = "OTHER";

export const KpiTone = {
  NEUTRAL: "NEUTRAL",
  REMOVE: "REMOVE",
  KEEP: "KEEP",
  REVIEW: "REVIEW",
} as const;

export type KpiTone = (typeof KpiTone)[keyof typeof KpiTone];

/** Value of `fuente` for rows that carry none; it counts in the "other" bucket. */
export const EMPTY_FUENTE = "";
