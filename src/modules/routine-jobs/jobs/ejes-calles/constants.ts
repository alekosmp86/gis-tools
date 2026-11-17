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
  ADDRESS: "ejes-address",
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

export const EJES_STAGING_COLUMN = {
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
  CNT: "cnt",
  CHK: "chk",
  EIN: "ein",
  EOUT: "eout",
} as const;

export const ACCESS_POINT_COLUMN = {
  ID: "id",
  ROAD_SECTION: "id_road_section",
} as const;

/** Door fields of an access point, read by name from the row when the table has them (a missing one reads as no data). */
export const ACCESS_POINT_DOOR_KEY = {
  NUMBER: "number",
  LETTER: "letter",
  KM: "km",
  CIRCULATION_WAY: "id_circulation_way",
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
  ADDRESS_MASTER: "id_address_master",
} as const;

export const ADDRESS_COLUMN = {
  ADDRESS_MASTER: "id_address_master",
  ID: "id",
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

/** Roles of a geometric twin member: a keeper holds access points; the winner is the single member kept when none holds one. */
export const GEO_TWIN_ROLE = {
  KEEPER: "keeper",
  WINNER: "winner",
  LOSER: "loser",
} as const;

export type GeoTwinRole = (typeof GEO_TWIN_ROLE)[keyof typeof GEO_TWIN_ROLE];

export const TWIN_PADRON_DISTANCE_M = 25;
export const TWIN_NEAR_MIN_LENGTH_M = 1;
export const RURAL_LOCALITY_SUFFIX = " RURAL";

export const EJES_REQUIRED_COLUMNS_BY_ROLE: Record<EjesTableRole, readonly string[]> = {
  [EJES_TABLE_ROLE.STAGING]: Object.values(EJES_STAGING_COLUMN),
  [EJES_TABLE_ROLE.ROAD_SECTION]: Object.values(ROAD_SECTION_COLUMN),
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: Object.values(CIRCULATION_WAY_COLUMN),
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: Object.values(ADDRESS_MASTER_COLUMN),
  [EJES_TABLE_ROLE.VERTICES]: Object.values(VERTICES_COLUMN),
  [EJES_TABLE_ROLE.ACCESS_POINT]: Object.values(ACCESS_POINT_COLUMN),
  [EJES_TABLE_ROLE.LOCALITIES]: Object.values(LOCALITIES_COLUMN),
  [EJES_TABLE_ROLE.DEPARTMENTS]: Object.values(DEPARTMENTS_COLUMN),
  [EJES_TABLE_ROLE.PADRONES]: Object.values(PADRON_COLUMN),
  [EJES_TABLE_ROLE.ADDRESS]: Object.values(ADDRESS_COLUMN),
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
  [EJES_TABLE_ROLE.ADDRESS]: { schema: "carto", table: "address" },
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
export const GEOMETRY_TOLERANCE_M = 0.001;
export const COVERAGE_RATIO = 0.95;
export const COVERAGE_TOLERANCE_M = 1;
export const RENUMBER_HAUSDORFF_M = 0.5;
export const RENUMBER_CANDIDATE_DISTANCE_M = COVERAGE_TOLERANCE_M;
/** A new section of the same idcalle counts as a piece or a merge member of an old section only when it covers more than this many metres of it (EJ-10). Touching neighbours at a bend overlap 4-5 m on dev (old 1001462 / new 1030829, old 1001823 / new 1030832), so 2 m was too short. */
export const SPLIT_PIECE_MIN_COVER_M = 10;
/** A new section that counts as a piece must also lie mostly on the old section: at least this share of its own length (EJ-10). */
export const PIECE_OWN_FRACTION = 0.5;
/** A split point goes to its nearest piece only when the second nearest is at least this much farther (EJS-5). */
export const AMBIGUOUS_POINT_GAP_M = 5;
/** Split points farther than this from every piece are counted in the report only (EJS-8, informational). */
export const FAR_POINT_REPORT_M = 25;
/** Review points of one split are read in pages of this size; the review screen reads pages until every review point is loaded (EJS-6). */
export const SPLIT_POINTS_PAGE_LIMIT = 200;
/** The old `reftramo`s named in the abort message of an invalid choice: the first ones, in order. */
export const INVALID_CHOICE_REFS_LIMIT = 5;
/** The review points one dry run keeps for the review screen; a split whose points would pass this is not stored and is flagged incomplete. */
export const REVIEW_POINTS_STORE_LIMIT = 20000;
/** The tables the review points read by primary key or small lookups: the access points, their addresses, the old sections, the new pieces and the circulation ways (street names). */
export const EJES_SPLIT_POINTS_ROLES = [
  EJES_TABLE_ROLE.STAGING,
  EJES_TABLE_ROLE.ROAD_SECTION,
  EJES_TABLE_ROLE.ACCESS_POINT,
  EJES_TABLE_ROLE.ADDRESS,
  EJES_TABLE_ROLE.CIRCULATION_WAY,
] as const;
/** The answer of the review read when its dry run is no longer kept (evicted, or never stored because it was a real run). */
export const SPLIT_REVIEW_GONE_MESSAGE = "El análisis ya no está disponible. Vuelva a analizar.";

export const REAL_RUN_ENV_VAR = "EJES_CALLES_REAL_RUN_ENABLED";
export const REAL_RUN_UNAVAILABLE_MESSAGE = "La carga real de ejes de calles todavía no está disponible.";

export const LOAD_LOCK_TIMEOUT_MS = 15000;
export const LOAD_CHUNK_SIZE = 500;
export const REVERT_PAGE_SIZE = 500;
export const DISTANCE_DECIMALS = 2;
export const MASTER_URN_PREFIX = "cgeo:road_section:id:";
export const EJES_REFRESH_VIEW_NAMES = ["mv_road_section", "mv_road_section2", "mv_addresses_2_0"] as const;
export const EJES_STAGING_REFRESH_VIEW = "bdj_ejes";

export const TOPOLOGY_TOLERANCE_M = 0.1;

export const EJES_LOAD_ROLES = [
  EJES_TABLE_ROLE.ROAD_SECTION,
  EJES_TABLE_ROLE.CIRCULATION_WAY,
  EJES_TABLE_ROLE.ADDRESS_MASTER,
  EJES_TABLE_ROLE.ACCESS_POINT,
  EJES_TABLE_ROLE.VERTICES,
] as const;

export const RENUMBER_SKIP_REASON = {
  REPEATED_OLD_REF: "repeated_old_ref",
  AMBIGUOUS_OLD_REF: "ambiguous_old_ref",
  AMBIGUOUS_NEW_REF: "ambiguous_new_ref",
  NOT_SINGLE_COPY: "not_single_copy",
} as const;

export type RenumberSkipReason = (typeof RENUMBER_SKIP_REASON)[keyof typeof RENUMBER_SKIP_REASON];

export const EJES_SKIP_REASON = {
  ...RENUMBER_SKIP_REASON,
  NOT_ACCEPTED: "not_accepted",
  HAS_POINTS: "has_points",
  NO_REFTRAMO: "no_reftramo",
  SHARED_OLD_REF: "shared_old_ref",
  SHARED_PIECE: "shared_piece",
  REVIEW_REQUIRED: "review_required",
  ID_LINKED_POINTS: "points_by_id",
} as const;

export const EJES_POINT_REASON = {
  AMBIGUOUS: "ambiguous",
  NO_GEOMETRY: "no_geometry",
} as const;

export type EjesPointReason = (typeof EJES_POINT_REASON)[keyof typeof EJES_POINT_REASON];

export type EjesSkipReason = (typeof EJES_SKIP_REASON)[keyof typeof EJES_SKIP_REASON];

export const EJES_SKIP_KIND = {
  SPLIT: "split",
  MERGE: "merge",
  REMOVAL: "removal",
  RENUMBER: "renumber",
  TWIN: "twin",
} as const;

export type EjesSkipKind = (typeof EJES_SKIP_KIND)[keyof typeof EJES_SKIP_KIND];

export const ACCEPTED_KEYS_LIMIT = 5000;
export const ACCEPTED_CHOICES_LIMIT = 20000;

export const EJES_SUMMARY_COUNT_KEYS = [
  "newSections",
  "unchanged",
  "attr",
  "geom",
  "both",
  "removed",
  "splits",
  "merges",
  "plainRemovals",
  "renumbered",
  "renumberSkipped",
  "splitPointsAuto",
  "splitPointsReview",
  "splitPointsNoGeometry",
  "geoTwinLosersRemovable",
  "geoTwinLosersOmitted",
] as const;
