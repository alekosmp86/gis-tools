export const FONT_TYPE_ID = 4;
export const SNAP_GRID_M = 0.001;

export const LOCALITY_SKIP_REASON = {
  SIN_GEOMETRIA: "SIN_GEOMETRIA",
  PROVINCIA_NO_ENCONTRADA: "PROVINCIA_NO_ENCONTRADA",
  PROVINCIA_AMBIGUA: "PROVINCIA_AMBIGUA",
  CODIGO_NULO: "CODIGO_NULO",
  CLAVE_DUPLICADA: "CLAVE_DUPLICADA",
} as const;

export type LocalitySkipReason = (typeof LOCALITY_SKIP_REASON)[keyof typeof LOCALITY_SKIP_REASON];

export const LOCALITY_CLASS = {
  NEW: "NEW",
  UNCHANGED: "UNCHANGED",
  WITHIN_TOLERANCE: "WITHIN_TOLERANCE",
  CHANGED: "CHANGED",
  AMBIGUOUS: "AMBIGUOUS",
} as const;

export const STAGING_PADRON_COLUMN = {
  UNIDADCAT: "unidadcat",
  NOMDEPTO: "nomdepto",
  CODDEPTO: "coddepto",
  NOMOFIDEL: "nomofidel",
  NOMLOCCAT: "nomloccat",
  CODLOCCAT: "codloccat",
  PADRON: "padron",
} as const;

export const STAGING_LOCALITY_COLUMN = {
  LOCALIDAD: "localidad",
  CODDEPTO: "coddepto",
  GEOM: "geom",
} as const;

export const PROVINCE_SOURCE_COLUMN = {
  ID: "id",
  NAME: "name",
} as const;

export const TARGET_COLUMN = {
  ID: "id",
  CODE: "code",
  NAME: "name",
  GEOMETRY: "geometry",
  ID_FONT_TYPE: "id_font_type",
  ID_PROVINCE: "id_province",
} as const;

export const TARGET_WRITTEN_COLUMNS: readonly string[] = [
  TARGET_COLUMN.CODE,
  TARGET_COLUMN.NAME,
  TARGET_COLUMN.GEOMETRY,
  TARGET_COLUMN.ID_FONT_TYPE,
  TARGET_COLUMN.ID_PROVINCE,
];

export const LOCALIDADES_TABLE_ROLE = {
  STAGING_PADRON: "localidades-staging-padron",
  STAGING_LOCALIDAD: "localidades-staging-localidad",
  PROVINCE: "localidades-provincia",
  TARGET: "localidades-destino",
} as const;

export type LocalidadesTableRole = (typeof LOCALIDADES_TABLE_ROLE)[keyof typeof LOCALIDADES_TABLE_ROLE];

export const LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE: Record<LocalidadesTableRole, readonly string[]> = {
  [LOCALIDADES_TABLE_ROLE.STAGING_PADRON]: Object.values(STAGING_PADRON_COLUMN),
  [LOCALIDADES_TABLE_ROLE.STAGING_LOCALIDAD]: Object.values(STAGING_LOCALITY_COLUMN),
  [LOCALIDADES_TABLE_ROLE.PROVINCE]: Object.values(PROVINCE_SOURCE_COLUMN),
  [LOCALIDADES_TABLE_ROLE.TARGET]: Object.values(TARGET_COLUMN),
};

export const MAX_TARGETS = 2;
export const SAMPLE_LIMIT = 20;
export const GEOMETRY_CHANGE_LIMIT = 20;
export const INSERTED_LIST_LIMIT = 500;

export const POLYGON_TYPES: readonly string[] = ["POLYGON", "MULTIPOLYGON"];
export const TARGET_GEOMETRY_TYPE = "MULTIPOLYGON";
