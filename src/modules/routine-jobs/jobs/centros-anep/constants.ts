export const CENTROS_TABLE_ROLE = {
  STAGING: "centros-anep-staging",
  FINAL: "centros-anep-final",
} as const;

export type CentrosTableRole = (typeof CENTROS_TABLE_ROLE)[keyof typeof CENTROS_TABLE_ROLE];

export const CENTROS_ROLES: readonly CentrosTableRole[] = Object.values(CENTROS_TABLE_ROLE);

export const CENTROS_COLUMN = {
  RUEE: "ruee",
  SUBSISTEMA: "subsistema",
  NOMBRE: "nombre",
  GEOM: "geom",
} as const;

export const CENTROS_REQUIRED_COLUMNS_BY_ROLE: Record<CentrosTableRole, readonly string[]> = {
  [CENTROS_TABLE_ROLE.STAGING]: Object.values(CENTROS_COLUMN),
  [CENTROS_TABLE_ROLE.FINAL]: Object.values(CENTROS_COLUMN),
};

export const CENTROS_DEFAULT_TABLES: Record<CentrosTableRole, { schema: string; table: string }> = {
  [CENTROS_TABLE_ROLE.STAGING]: { schema: "bdj_carto", table: "ine_centros_anep" },
  [CENTROS_TABLE_ROLE.FINAL]: { schema: "carto", table: "ine_centros_anep" },
};

export const CENTROS_FINAL_PRIVILEGES: readonly string[] = ["SELECT", "INSERT", "DELETE"];

export const CENTROS_WFS_URL =
  "https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP";

export const CENTROS_STAGING_NOTE =
  "Antes de correr este trabajo, cargue la tabla de staging con DB vs. Shapefile (Reemplazo completo) desde el shapefile del WFS de IDEuy";

export const CENTROS_CONFIRM_REQUIRED_MESSAGE =
  "Confirme el reemplazo de los centros ANEP: la tabla final se vacía y se vuelve a llenar. Sin confirmación solo se permite el análisis.";

export const CENTROS_TEXT_TYPE_PATTERN = /^(text|character varying|character|bpchar|citext|name)(\(|$)/i;
