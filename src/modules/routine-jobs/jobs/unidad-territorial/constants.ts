import { UNIT_SUBJECT_SPEC } from "../shared/addressMasterLinkSpec";

export const DEFAULT_LOCALITY_TYPE_NAME = "LOCALIDAD CATASTRAL";

export const TERRITORIAL_UNIT_VIEW_NAME = "mv_territorial_unit_full";

export const UNIT_SKIP_REASON = {
  NOMBRE_NULO: "NOMBRE_NULO",
  PROVINCIA_NULA: "PROVINCIA_NULA",
  FUENTE_NULA: "FUENTE_NULA",
  SIN_GEOMETRIA: "SIN_GEOMETRIA",
  CLAVE_DUPLICADA: "CLAVE_DUPLICADA",
} as const;

export type UnitSkipReason = (typeof UNIT_SKIP_REASON)[keyof typeof UNIT_SKIP_REASON];

export const UNIT_SOURCE_COLUMN = {
  NAME: "name",
  ID_FONT_TYPE: "id_font_type",
  ID_PROVINCE: "id_province",
  GEOMETRY: "geometry",
} as const;

export const UNIT_TYPE_COLUMN = {
  ID: "id",
  NAME: "name",
} as const;

export const UNIT_TARGET_COLUMN = {
  ID: "id",
  NAME: "name",
  ID_TERRITORIAL_UNIT_TYPE: "id_territorial_unit_type",
  ID_FONT: "id_font",
  ID_PROVINCE: "id_province",
  GEOMETRY: "geometry",
} as const;

export const UNIT_TARGET_WRITTEN_COLUMNS: readonly string[] = [
  UNIT_TARGET_COLUMN.NAME,
  UNIT_TARGET_COLUMN.ID_TERRITORIAL_UNIT_TYPE,
  UNIT_TARGET_COLUMN.ID_FONT,
  UNIT_TARGET_COLUMN.ID_PROVINCE,
  UNIT_TARGET_COLUMN.GEOMETRY,
];

export const UNIT_TABLE_ROLE = {
  SOURCE: "unidades-origen-localidad",
  TYPE: "unidades-tipo",
  TARGET: "unidades-destino",
  TARGET_LINKED: "unidades-destino-enlazado",
} as const;

export type UnitTableRole = (typeof UNIT_TABLE_ROLE)[keyof typeof UNIT_TABLE_ROLE];

export const UNIT_REQUIRED_COLUMNS_BY_ROLE: Record<UnitTableRole, readonly string[]> = {
  [UNIT_TABLE_ROLE.SOURCE]: Object.values(UNIT_SOURCE_COLUMN),
  [UNIT_TABLE_ROLE.TYPE]: Object.values(UNIT_TYPE_COLUMN),
  [UNIT_TABLE_ROLE.TARGET]: Object.values(UNIT_TARGET_COLUMN),
  [UNIT_TABLE_ROLE.TARGET_LINKED]: [...Object.values(UNIT_TARGET_COLUMN), UNIT_SUBJECT_SPEC.addressMasterColumn],
};

export const UNIT_TARGET_TITLE = "de unidades territoriales";
