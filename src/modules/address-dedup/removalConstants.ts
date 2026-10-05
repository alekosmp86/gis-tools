/** Tables the removal deletes from, named as they appear in `RemovalCounts.rowsByTable`. */
export const RemovalTable = {
  INTERNAL_ADDRESS_ACCESS_POINT: "internal_address_access_point",
  TERRITORIAL_UNIT_ACCESS_POINT: "territorial_unit_access_point",
  COMPACT_ADDRESS: "compact_address",
  INTERNAL_ADDRESS: "internal_address",
  ACCESS_POINT: "access_point",
  ADDRESS: "address",
  ADDRESSES_MASTER: "addresses_master",
} as const;

export type RemovalTable = (typeof RemovalTable)[keyof typeof RemovalTable];

export const RemovalBlockReason = {
  URN_BLANK: "URN_BLANK",
  URN_NOT_FOUND: "URN_NOT_FOUND",
  URN_AMBIGUOUS: "URN_AMBIGUOUS",
  MASTER_SHARED: "MASTER_SHARED",
  NOT_A_DOOR: "NOT_A_DOOR",
  IS_INTERNAL: "IS_INTERNAL",
  HAS_INTERNAL_UNITS: "HAS_INTERNAL_UNITS",
  LINKED_AS_INTERNAL: "LINKED_AS_INTERNAL",
  MASTER_REFERENCED: "MASTER_REFERENCED",
} as const;

export type RemovalBlockReason = (typeof RemovalBlockReason)[keyof typeof RemovalBlockReason];

/** The nine tables `carto.baja_direccion_base_v1` locks; the removal locks the same set. */
export const LOCKED_TABLES: ReadonlyArray<string> = [
  "carto.address",
  "carto.addresses_master",
  "carto.access_point",
  "carto.internal_address",
  "carto.internal_address_access_point",
  "carto.territorial_unit_access_point",
  "carto.compact_address",
  "carto.comments_address",
  "carto.plural_entity_access_point",
];

/** Tables whose any row stops the removal outright, as in `carto.baja_direccion_base_v1`. */
export const GLOBAL_GUARD_TABLES: ReadonlyArray<string> = [
  "carto.comments_address",
  "carto.plural_entity_access_point",
];

/** Columns that mark a table as referencing an address master; every such table is scanned. */
export const MASTER_REFERENCE_COLUMNS: ReadonlyArray<string> = [
  "id_address_master",
  "address_master_id",
  "addresses_master_id",
];

/** Tables the master scan never inspects: they are the ones being deleted from. */
export const MASTER_SCAN_EXCLUDED_TABLES: ReadonlyArray<string> = ["address", "addresses_master"];

export const AUDIT_TABLE_NAME = "baja_direccion_operacion";

/** The audit table of `carto.baja_direccion`. It must already exist: the app never issues DDL. */
export const AUDIT_TABLE = `carto.${AUDIT_TABLE_NAME}`;

/** Columns of the audit table; `creado_en` is the ninth and takes its default. */
export const AUDIT_REQUIRED_COLUMNS: ReadonlyArray<string> = [
  "operacion",
  "referencia",
  "incluir_internas",
  "huella",
  "responsable",
  "motivo",
  "ejecutor_bd",
  "creado_en",
  "resultado",
];

export const ADVISORY_LOCK_NAMESPACE = "carto.address-dedup.removal";

export const REMOVAL_LOCK_TIMEOUT = "5s";

export const RemovalState = {
  DELETED_PENDING_INDEXES: "BD_ELIMINADA_PENDIENTE_INDICES",
} as const;

export type RemovalState = (typeof RemovalState)[keyof typeof RemovalState];

/** Same wording `carto.baja_direccion` returns: the removal never touches Solr or the materialized views. */
export const REMOVAL_PENDING_MESSAGE =
  "La API debe retirar los IDs y URN de Solr y aplicar el procedimiento de vistas materializadas.";

export const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RESPONSABLE_MAX_LENGTH = 120;

export const MOTIVO_MAX_LENGTH = 1000;

export const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/;

/** Steps of the confirmation dialog; a destructive call is only reachable from REVIEW. */
export const RemovalPhase = {
  CLOSED: "CLOSED",
  FORM: "FORM",
  SIMULATING: "SIMULATING",
  REVIEW: "REVIEW",
  EXECUTING: "EXECUTING",
  DONE: "DONE",
} as const;

export type RemovalPhase = (typeof RemovalPhase)[keyof typeof RemovalPhase];
