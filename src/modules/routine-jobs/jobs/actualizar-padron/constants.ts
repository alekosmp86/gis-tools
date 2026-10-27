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

export const WORK_COLUMN = {
  NUMBER: "number",
  TYPE_PADRON: "type_padron",
  ID_CADASTRAL_LOCALITY: "id_cadastral_locality",
  ID_PROVINCE: "id_province",
  GEOMETRY: "geometry",
} as const;

export const PADRON_COLUMN = {
  ID: "id",
  GEOMETRY: "geometry",
} as const;

export const PROVINCE_COLUMN = {
  ID: "id",
  NAME: "name",
} as const;

export const LOCALITY_COLUMN = {
  ID: "id",
  NAME: "name",
  ID_PROVINCE: "id_province",
} as const;

export const STAGING_REQUIRED_COLUMNS: readonly string[] = Object.values(STAGING_COLUMN);
export const WORK_REQUIRED_COLUMNS: readonly string[] = Object.values(WORK_COLUMN);
export const PADRON_REQUIRED_COLUMNS: readonly string[] = Object.values(PADRON_COLUMN);
export const PROVINCE_REQUIRED_COLUMNS: readonly string[] = Object.values(PROVINCE_COLUMN);
export const LOCALITY_REQUIRED_COLUMNS: readonly string[] = Object.values(LOCALITY_COLUMN);

export const SKIPPED_SAMPLE_LIMIT = 20;
export const SKIPPED_GROUP_LIMIT = 20;
export const COLLIDING_KEY_LIMIT = 20;

export const GENERIC_SRID = 0;
export const GENERIC_GEOMETRY_TYPE = "GEOMETRY";
const POLYGON_TYPE = "POLYGON";
const MULTIPOLYGON_TYPE = "MULTIPOLYGON";
export const STAGING_GEOMETRY_TYPES: readonly string[] = [POLYGON_TYPE, MULTIPOLYGON_TYPE];
export const WORK_GEOMETRY_TYPES: readonly string[] = [MULTIPOLYGON_TYPE];

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

export const PRIVILEGE = {
  INSERT: "INSERT",
  DELETE: "DELETE",
  TRUNCATE: "TRUNCATE",
} as const;

export const TABLE_LABEL = {
  STAGING: "staging",
  WORK: "trabajo",
  PADRON: "padrón",
  PROVINCE: "provincias",
  LOCALITY: "localidades",
} as const;

const ACTUALIZAR_TABLE_ROLE = {
  STAGING: "actualizar-staging",
  TEMP: "actualizar-temp",
  PADRON: "actualizar-padron",
  PROVINCE: "actualizar-provincia",
  LOCALITY: "actualizar-localidad",
} as const;

export type ActualizarTableRole = (typeof ACTUALIZAR_TABLE_ROLE)[keyof typeof ACTUALIZAR_TABLE_ROLE];

export const ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE: Record<ActualizarTableRole, readonly string[]> = {
  [ACTUALIZAR_TABLE_ROLE.STAGING]: STAGING_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.TEMP]: WORK_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.PADRON]: PADRON_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.PROVINCE]: PROVINCE_REQUIRED_COLUMNS,
  [ACTUALIZAR_TABLE_ROLE.LOCALITY]: LOCALITY_REQUIRED_COLUMNS,
};
