export const COLUMN = {
  GID: "gid",
  GEOM: "geom",
  NOMDEPTO: "nomdepto",
  CODDEPTO: "coddepto",
  NOMOFIDEL: "nomofidel",
  PADRON: "padron",
  SECCAT: "seccat",
  LAMINA: "lamina",
  CAUDRICULA: "caudricula",
  AREAHA: "areaha",
  AREAMC: "areamc",
  VALREAL: "valreal",
  NOMLOCCAT: "nomloccat",
  CODLOCCAT: "codloccat",
  NUMCARCAT: "numcarcat",
  NUMMANCAT: "nummancat",
  VALAREAM2: "valaream2",
  TIPOREGIME: "tiporegime",
  UNIDADCAT: "unidadcat",
  ARCHIVO: "archivo",
} as const;

export const RURAL_REQUIRED_COLUMNS: readonly string[] = [
  COLUMN.GID,
  COLUMN.NOMDEPTO,
  COLUMN.CODDEPTO,
  COLUMN.NOMOFIDEL,
  COLUMN.PADRON,
  COLUMN.SECCAT,
  COLUMN.LAMINA,
  COLUMN.CAUDRICULA,
  COLUMN.AREAHA,
  COLUMN.AREAMC,
  COLUMN.VALREAL,
  COLUMN.GEOM,
];

export const URBANO_REQUIRED_COLUMNS: readonly string[] = [
  COLUMN.GID,
  COLUMN.NOMDEPTO,
  COLUMN.CODDEPTO,
  COLUMN.NOMOFIDEL,
  COLUMN.NOMLOCCAT,
  COLUMN.CODLOCCAT,
  COLUMN.PADRON,
  COLUMN.NUMCARCAT,
  COLUMN.NUMMANCAT,
  COLUMN.VALAREAM2,
  COLUMN.TIPOREGIME,
  COLUMN.GEOM,
];

export const TARGET_REQUIRED_COLUMNS: readonly string[] = [
  COLUMN.UNIDADCAT,
  COLUMN.NOMDEPTO,
  COLUMN.CODDEPTO,
  COLUMN.NOMOFIDEL,
  COLUMN.NOMLOCCAT,
  COLUMN.CODLOCCAT,
  COLUMN.PADRON,
  COLUMN.NUMCARCAT,
  COLUMN.NUMMANCAT,
  COLUMN.VALAREAM2,
  COLUMN.TIPOREGIME,
  COLUMN.SECCAT,
  COLUMN.LAMINA,
  COLUMN.CAUDRICULA,
  COLUMN.AREAHA,
  COLUMN.AREAMC,
  COLUMN.VALREAL,
  COLUMN.ARCHIVO,
  COLUMN.GEOM,
];

export const PADRON_UNIT = {
  RURAL: "RURAL",
  URBANO: "URBANO",
} as const;

export type PadronUnit = (typeof PADRON_UNIT)[keyof typeof PADRON_UNIT];

export const CLEAR_MODE = {
  DELETE: "delete",
  TRUNCATE: "truncate",
} as const;

export type ClearMode = (typeof CLEAR_MODE)[keyof typeof CLEAR_MODE];

export const CONFLICT_SAMPLE_LIMIT = 20;
export const CONFLICT_VALUES_LIMIT = 5;
export const AMBIGUOUS_LOCALITY_LIMIT = 20;
export const POLYGONAL_DIMENSION = 3;

export const POLYGON_TYPE = "POLYGON";
export const MULTIPOLYGON_TYPE = "MULTIPOLYGON";

export const TABLE_ROLE = {
  RURAL: "rural",
  URBANO: "urbano",
  TARGET: "target",
} as const;

export type TableRole = (typeof TABLE_ROLE)[keyof typeof TABLE_ROLE];

export const REQUIRED_COLUMNS_BY_ROLE: Record<TableRole, readonly string[]> = {
  [TABLE_ROLE.RURAL]: RURAL_REQUIRED_COLUMNS,
  [TABLE_ROLE.URBANO]: URBANO_REQUIRED_COLUMNS,
  [TABLE_ROLE.TARGET]: TARGET_REQUIRED_COLUMNS,
};
