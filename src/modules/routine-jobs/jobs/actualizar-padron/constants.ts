import { ADDRESS_MASTER_REQUIRED_COLUMNS, PADRON_SUBJECT_SPEC } from "../shared/addressMasterLinkSpec";

export const SKIP_REASON = {
  PROVINCIA_NO_ENCONTRADA: "PROVINCIA_NO_ENCONTRADA",
  PROVINCIA_AMBIGUA: "PROVINCIA_AMBIGUA",
  LOCALIDAD_NO_ENCONTRADA: "LOCALIDAD_NO_ENCONTRADA",
  LOCALIDAD_AMBIGUA: "LOCALIDAD_AMBIGUA",
  CLAVE_NULA: "CLAVE_NULA",
  SIN_GEOMETRIA: "SIN_GEOMETRIA",
  CLAVE_DUPLICADA: "CLAVE_DUPLICADA",
} as const;

export type SkipReason = (typeof SKIP_REASON)[keyof typeof SKIP_REASON];

export const STAGING_COLUMN = {
  UNIDADCAT: "unidadcat",
  NOMDEPTO: "nomdepto",
  NOMLOCCAT: "nomloccat",
  PADRON: "padron",
  GEOM: "geom",
} as const;

export const DESTINATION_COLUMN = {
  ID: "id",
  NUMBER: "number",
  TYPE_PADRON: "type_padron",
  ID_CADASTRAL_LOCALITY: "id_cadastral_locality",
  ID_PROVINCE: "id_province",
  GEOMETRY: "geometry",
} as const;

export const DESTINATION_WRITTEN_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.NUMBER,
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.ID_PROVINCE,
  DESTINATION_COLUMN.GEOMETRY,
];

export const PROVINCE_COLUMN = {
  ID: "id",
  NAME: "name",
} as const;

export const LOCALITY_COLUMN = {
  ID: "id",
  NAME: "name",
  ID_PROVINCE: "id_province",
} as const;

export const LOCALITY_TYPE_COLUMN = {
  ID_TERRITORIAL_UNIT_TYPE: "id_territorial_unit_type",
} as const;

export const TYPE_COLUMN = {
  ID: "id",
  NAME: "name",
} as const;

const STAGING_REQUIRED_COLUMNS: readonly string[] = Object.values(STAGING_COLUMN);
const DESTINATION_REQUIRED_COLUMNS: readonly string[] = Object.values(DESTINATION_COLUMN);
const PROVINCE_REQUIRED_COLUMNS: readonly string[] = Object.values(PROVINCE_COLUMN);
const LOCALITY_REQUIRED_COLUMNS: readonly string[] = Object.values(LOCALITY_COLUMN);
const LOCALITY_TYPED_REQUIRED_COLUMNS: readonly string[] = [
  ...LOCALITY_REQUIRED_COLUMNS,
  LOCALITY_TYPE_COLUMN.ID_TERRITORIAL_UNIT_TYPE,
];
const TYPE_REQUIRED_COLUMNS: readonly string[] = Object.values(TYPE_COLUMN);

export const DEFAULT_LOCALITY_TYPE = "LOCALIDAD CATASTRAL";

export const SKIPPED_GROUP_LIMIT = 20;
export const LOCALITY_REASON_GROUP_LIMIT = 20;

export const GENERIC_SRID = 0;
export const GENERIC_GEOMETRY_TYPE = "GEOMETRY";
const POLYGON_TYPE = "POLYGON";
const MULTIPOLYGON_TYPE = "MULTIPOLYGON";
export const STAGING_GEOMETRY_TYPES: readonly string[] = [POLYGON_TYPE, MULTIPOLYGON_TYPE];

export const RELATION_FACT_KIND = {
  TRIGGER: "trigger",
  RULE: "rule",
} as const;

export type RelationFactKind = (typeof RELATION_FACT_KIND)[keyof typeof RELATION_FACT_KIND];

export const RETURN_RULE_NAME = "_RETURN";

export const RELATION_KIND = {
  TABLE: "r",
  PARTITIONED: "p",
} as const;

export const NUMERIC_TYPE_NAMES: ReadonlySet<string> = new Set([
  "smallint",
  "integer",
  "bigint",
  "decimal",
  "numeric",
  "real",
  "double precision",
]);

export const TABLE_LABEL = {
  STAGING: "staging",
  TARGET: "destino",
  PROVINCE: "provincias",
  LOCALITY: "localidades",
  TYPE: "tipos de unidad",
  ADDRESS_MASTER: "direcciones maestras",
} as const;

export const ACTUALIZAR_TABLE_ROLE = {
  STAGING: "actualizar-staging",
  TARGET: "actualizar-destino",
  TARGET_LINKED: "actualizar-destino-enlazado",
  PROVINCE: "actualizar-provincia",
  LOCALITY: "actualizar-localidad",
  LOCALITY_TYPED: "actualizar-localidad-tipada",
  TYPE: "actualizar-tipo",
  ADDRESS_MASTER: "actualizar-direcciones-maestras",
} as const;

export type ActualizarTableRole = (typeof ACTUALIZAR_TABLE_ROLE)[keyof typeof ACTUALIZAR_TABLE_ROLE];

export const ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE: Record<ActualizarTableRole, readonly string[]> = {
  [ACTUALIZAR_TABLE_ROLE.STAGING]: STAGING_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.TARGET]: DESTINATION_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.TARGET_LINKED]: [...DESTINATION_REQUIRED_COLUMNS, PADRON_SUBJECT_SPEC.addressMasterColumn],
  [ACTUALIZAR_TABLE_ROLE.PROVINCE]: PROVINCE_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.LOCALITY]: LOCALITY_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.LOCALITY_TYPED]: LOCALITY_TYPED_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.TYPE]: TYPE_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.ADDRESS_MASTER]: ADDRESS_MASTER_REQUIRED_COLUMNS,
};

export const DESTINATION_TITLE = "de destino";
export const DEFAULT_PADRON_TARGET_TABLE = "padron";
