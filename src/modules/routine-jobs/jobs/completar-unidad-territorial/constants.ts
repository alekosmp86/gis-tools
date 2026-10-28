export const TERRITORIAL_UNIT_URN_PREFIX = "cgeo:territorial_unit:id:";

export const TERRITORIAL_UNIT_VIEW_NAME = "mv_territorial_unit_full";

export const ADDRESS_MASTER_INITIAL_COORDINATE = 0;

export const COMPLETAR_UNIT_COLUMN = {
  ID: "id",
  NAME: "name",
  ID_PROVINCE: "id_province",
  ID_ADDRESS_MASTER: "id_address_master",
} as const;

export const COMPLETAR_ADDRESS_MASTER_COLUMN = {
  ID: "addresses_master_id",
  URN: "urn",
  LATITUDE: "latitud",
  LONGITUDE: "longitud",
} as const;

export const COMPLETAR_ADDRESS_MASTER_WRITTEN_COLUMNS: readonly string[] = [
  COMPLETAR_ADDRESS_MASTER_COLUMN.URN,
  COMPLETAR_ADDRESS_MASTER_COLUMN.LATITUDE,
  COMPLETAR_ADDRESS_MASTER_COLUMN.LONGITUDE,
];

export const COMPLETAR_TABLE_ROLE = {
  UNIT: "completar-unidades",
  ADDRESS_MASTER: "completar-direcciones-maestras",
} as const;

export type CompletarTableRole = (typeof COMPLETAR_TABLE_ROLE)[keyof typeof COMPLETAR_TABLE_ROLE];

export const COMPLETAR_REQUIRED_COLUMNS_BY_ROLE: Record<CompletarTableRole, readonly string[]> = {
  [COMPLETAR_TABLE_ROLE.UNIT]: Object.values(COMPLETAR_UNIT_COLUMN),
  [COMPLETAR_TABLE_ROLE.ADDRESS_MASTER]: Object.values(COMPLETAR_ADDRESS_MASTER_COLUMN),
};

export const COMPLETAR_UNIT_TITLE = "de unidades territoriales";
export const COMPLETAR_ADDRESS_MASTER_TITLE = "de direcciones maestras";

export const DEFAULT_UNIT_SCHEMA = "carto";
export const DEFAULT_UNIT_TABLE = "territorial_unit";
export const DEFAULT_ADDRESS_MASTER_SCHEMA = "carto";
export const DEFAULT_ADDRESS_MASTER_TABLE = "addresses_master";
