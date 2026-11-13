export const EJES_TABLE_ROLE = {
  STAGING: "ejes-origen",
  ROAD_SECTION: "ejes-tramos",
  CIRCULATION_WAY: "ejes-vias",
  ADDRESS_MASTER: "ejes-direcciones",
  VERTICES: "ejes-vertices",
  ACCESS_POINT: "ejes-accesos",
  LOCALITIES: "ejes-localidades",
  DEPARTMENTS: "ejes-departamentos",
  PADRONES: "ejes-padrones",
} as const;

export type EjesTableRole = (typeof EJES_TABLE_ROLE)[keyof typeof EJES_TABLE_ROLE];

export const EJES_ROLES: readonly EjesTableRole[] = Object.values(EJES_TABLE_ROLE);

export const EJES_WRITE_ROLES: readonly EjesTableRole[] = [
  EJES_TABLE_ROLE.ROAD_SECTION,
  EJES_TABLE_ROLE.CIRCULATION_WAY,
  EJES_TABLE_ROLE.ADDRESS_MASTER,
  EJES_TABLE_ROLE.VERTICES,
  EJES_TABLE_ROLE.ACCESS_POINT,
];

export const EJES_READ_ROLES: readonly EjesTableRole[] = EJES_ROLES.filter((role) => !EJES_WRITE_ROLES.includes(role));

export const STAGING_COLUMN = {
  REFTRAMO: "reftramo",
  IDCALLE: "idcalle",
  NOMBRE: "nombre",
  TIPO_VIALIDAD: "tipo_vialidad",
  FUENTE: "fuente",
  LOCALIDAD: "localidad",
  DEPARTAMENTO: "departamento",
  GEOM: "geom",
} as const;

export const ROAD_SECTION_COLUMN = {
  ID: "id",
  REFTRAMO: "reftramo_ideuy",
  CIRCULATION_WAY: "id_circulation_way",
  TYPE: "id_road_section_type",
  FONT: "id_font",
  ADDRESS_MASTER: "id_address_master",
  SOURCE: "source",
  TARGET: "target",
  DISTANCE: "distance",
  GEOMETRY: "geometry",
} as const;

export const CIRCULATION_WAY_COLUMN = {
  ID: "id",
  NAME: "name",
  SHORT_NAME: "short_name",
  ROAD_TYPE: "id_road_type",
  FONT: "id_font",
  CALLE: "id_calle",
} as const;

export const ADDRESS_MASTER_COLUMN = {
  ID: "addresses_master_id",
  URN: "urn",
  LATITUDE: "latitud",
  LONGITUDE: "longitud",
} as const;

export const VERTICES_COLUMN = {
  ID: "id",
  THE_GEOM: "the_geom",
} as const;

export const ACCESS_POINT_COLUMN = {
  ID: "id",
  ROAD_SECTION: "id_road_section",
} as const;

export const LOCALITIES_COLUMN = {
  CLOC_ISO: "cloc_iso",
  NAME: "nomloc",
  GEOM: "geom",
} as const;

export const DEPARTMENTS_COLUMN = {
  ISO_CODE: "iso_code_dpto",
  NAME: "name_dpto",
} as const;

export const PADRON_COLUMN = {
  TYPE: "type_padron",
  GEOMETRY: "geometry",
} as const;

export const PADRON_TYPE = {
  URBAN: "URBANO",
  RURAL: "RURAL",
} as const;

export type PadronType = (typeof PADRON_TYPE)[keyof typeof PADRON_TYPE];

export const TWIN_CLASS = {
  BOTH: "BOTH",
  URBAN: "URBAN",
  RURAL: "RURAL",
  NEITHER: "NEITHER",
} as const;

export type TwinClass = (typeof TWIN_CLASS)[keyof typeof TWIN_CLASS];

export const TWIN_PADRON_DISTANCE_M = 25;
export const TWIN_NEAR_MIN_LENGTH_M = 1;
export const RURAL_LOCALITY_SUFFIX = " RURAL";

export const EJES_REQUIRED_COLUMNS_BY_ROLE: Record<EjesTableRole, readonly string[]> = {
  [EJES_TABLE_ROLE.STAGING]: Object.values(STAGING_COLUMN),
  [EJES_TABLE_ROLE.ROAD_SECTION]: Object.values(ROAD_SECTION_COLUMN),
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: Object.values(CIRCULATION_WAY_COLUMN),
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: Object.values(ADDRESS_MASTER_COLUMN),
  [EJES_TABLE_ROLE.VERTICES]: Object.values(VERTICES_COLUMN),
  [EJES_TABLE_ROLE.ACCESS_POINT]: Object.values(ACCESS_POINT_COLUMN),
  [EJES_TABLE_ROLE.LOCALITIES]: Object.values(LOCALITIES_COLUMN),
  [EJES_TABLE_ROLE.DEPARTMENTS]: Object.values(DEPARTMENTS_COLUMN),
  [EJES_TABLE_ROLE.PADRONES]: Object.values(PADRON_COLUMN),
};

export const EJES_ID_LOGICAL_BY_ROLE: Partial<Record<EjesTableRole, string>> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: ROAD_SECTION_COLUMN.ID,
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: CIRCULATION_WAY_COLUMN.ID,
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: ADDRESS_MASTER_COLUMN.ID,
  [EJES_TABLE_ROLE.VERTICES]: VERTICES_COLUMN.ID,
};

export const EJES_DEFAULT_TABLES: Record<EjesTableRole, { schema: string; table: string }> = {
  [EJES_TABLE_ROLE.STAGING]: { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
  [EJES_TABLE_ROLE.ROAD_SECTION]: { schema: "carto", table: "road_section" },
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: { schema: "carto", table: "circulation_way" },
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: { schema: "carto", table: "addresses_master" },
  [EJES_TABLE_ROLE.VERTICES]: { schema: "carto", table: "road_section_vertices_pgr" },
  [EJES_TABLE_ROLE.ACCESS_POINT]: { schema: "carto", table: "access_point" },
  [EJES_TABLE_ROLE.LOCALITIES]: { schema: "bdj_carto", table: "ine_localidades_pg" },
  [EJES_TABLE_ROLE.DEPARTMENTS]: { schema: "carto", table: "mv_country_province" },
  [EJES_TABLE_ROLE.PADRONES]: { schema: "carto", table: "padron" },
};

export const EJES_SRID = 32721;

export const TIPO_VIALIDAD_IDS: Readonly<Record<string, number>> = {
  CALLE: 4,
  "CALLE INTERNA": 20,
  PASAJE: 10,
  "PASAJE INTERNO": 21,
  PEATONAL: 11,
  Ruta: 1,
  SENDERO: 15,
  VIRTUAL: 19,
};

export const FUENTE_IDS: Readonly<Record<string, number>> = {
  ANC: 8,
  CARGA_MASIVA: 35,
  DESDE_TSUBASA: 34,
  Google: 33,
  IDE: 1,
  INE: 3,
  INTENDENCIA_DE_CANELONES: 13,
  INTENDENCIA_DE_CERRO_LARGO: 14,
  INTENDENCIA_DE_DURAZNO: 16,
  INTENDENCIA_DE_FLORES: 17,
  INTENDENCIA_DE_FLORIDA: 18,
  INTENDENCIA_DE_MALDONADO: 20,
  INTENDENCIA_DE_MONTEVIDEO: 21,
  INTENDENCIA_DE_RIVERA: 24,
  INTENDENCIA_DE_ROCHA: 25,
  INTENDENCIA_DE_SALTO: 26,
  INTENDENCIA_DE_SAN_JOSE: 27,
  INTENDENCIA_DE_SORIANO: 28,
  INTENDENCIA_DE_TACUAREMBÓ: 29,
  MTOP: 7,
  OSM: 32,
  UTE: 31,
};

export const GEOMETRY_EQUALITY_DECIMALS = 4;
export const COVERAGE_RATIO = 0.95;
export const COVERAGE_TOLERANCE_M = 1;
export const RENUMBER_HAUSDORFF_M = 0.5;
export const RENUMBER_CANDIDATE_DISTANCE_M = COVERAGE_TOLERANCE_M;

export const REAL_RUN_UNAVAILABLE_MESSAGE = "La carga real de ejes de calles todavía no está disponible.";
