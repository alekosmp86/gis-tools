import { MAX_FILE_BYTES, MULTIPART_OVERHEAD_BYTES } from "../constants";

export { MAX_FILE_BYTES };

/**
 * The only file that names a table of the Avance FTTH part. A rename is a one-line change here;
 * identifiers are spliced into SQL from these constants and from nothing the request carries.
 */
export const STAGING_INT = "public.avance_planilla_int";
export const STAGING_UDPEM = "public.avance_planilla_mvd";
export const AVANCE = "public.avance_uruguay_planilla";
export const HISTORY = "historico.h_avance_uruguay";
export const ZONES = "public.area_zonas_ftth_f";
export const CENTRAL_LIMITS = "public.limite_central_ftth";

const SequenceOwner = {
  STAGING_INT_GID: { table: STAGING_INT, column: "gid" },
  STAGING_UDPEM_GID: { table: STAGING_UDPEM, column: "gid" },
  AVANCE_GID: { table: AVANCE, column: "gid" },
  HISTORY_ID: { table: HISTORY, column: "id" },
} as const;

export const SEQUENCE_OWNERS: ReadonlyArray<(typeof SequenceOwner)[keyof typeof SequenceOwner]> =
  Object.values(SequenceOwner);

export const TablePrivilege = {
  SELECT: "SELECT",
  INSERT: "INSERT",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  TRUNCATE: "TRUNCATE",
} as const;

export const SEQUENCE_USAGE_PRIVILEGE = "USAGE";

export const AvanceFileKind = {
  INT: "INT",
  UDPEM: "UDPEM",
} as const;

export type AvanceFileKind = (typeof AvanceFileKind)[keyof typeof AvanceFileKind];

export const FILE_KINDS: ReadonlyArray<AvanceFileKind> = [AvanceFileKind.INT, AvanceFileKind.UDPEM];

export const FILE_KIND_LABELS: Readonly<Record<AvanceFileKind, string>> = {
  [AvanceFileKind.INT]: "Interior",
  [AvanceFileKind.UDPEM]: "Montevideo (UDPEM)",
};

export const STAGING_TABLE_BY_KIND: Readonly<Record<AvanceFileKind, string>> = {
  [AvanceFileKind.INT]: STAGING_INT,
  [AvanceFileKind.UDPEM]: STAGING_UDPEM,
};

/** Prefixes of `configArch.ini` (`sitINT`, `sitMVD`); the digits that follow are `ddMMyyyy`. */
export const FILE_PREFIX: Readonly<Record<AvanceFileKind, string>> = {
  [AvanceFileKind.INT]: "SituacionFTTH_INT_",
  [AvanceFileKind.UDPEM]: "SituacionFTTH_UDPEM_",
};

const FILE_DATE_DIGITS = 8;
const FILE_NAME_HINT_SUFFIX = "ddmmaaaa.csv";

export const FILE_NAME_FORMAT_HINTS: Readonly<Record<AvanceFileKind, string>> = {
  [AvanceFileKind.INT]: `${FILE_PREFIX[AvanceFileKind.INT]}${FILE_NAME_HINT_SUFFIX}`,
  [AvanceFileKind.UDPEM]: `${FILE_PREFIX[AvanceFileKind.UDPEM]}${FILE_NAME_HINT_SUFFIX}`,
};

export const FILE_NAME_PATTERNS: Readonly<Record<AvanceFileKind, RegExp>> = {
  [AvanceFileKind.INT]: new RegExp(`^${FILE_PREFIX[AvanceFileKind.INT]}(\\d{${FILE_DATE_DIGITS}})\\.csv$`),
  [AvanceFileKind.UDPEM]: new RegExp(`^${FILE_PREFIX[AvanceFileKind.UDPEM]}(\\d{${FILE_DATE_DIGITS}})\\.csv$`),
};

/** Legacy `nullif -`: only the Interior file has it. */
export const NULL_MARKER = "-";
export const EXPECTED_COLUMN_COUNT = 10;

export interface AvanceColumn {
  readonly key: AvanceColumnKey;
  readonly maxLength: number;
}

export const AvanceColumnKey = {
  CENTRAL: "central",
  CABLE: "cable",
  ZONA: "zona",
  EMPRESA: "empresa",
  PLANO_AL_COM: "plano_al_com",
  EJECUTOR: "ejecutor",
  DIRECTOR: "director",
  ETIQUETA: "etiqueta",
  CONCA: "conca",
  EDIFICIO: "edificio",
} as const;

export type AvanceColumnKey = (typeof AvanceColumnKey)[keyof typeof AvanceColumnKey];

/** The CSV columns in file order, with the length of the target column of the staging tables. */
export const AVANCE_COLUMNS: ReadonlyArray<AvanceColumn> = [
  { key: AvanceColumnKey.CENTRAL, maxLength: 100 },
  { key: AvanceColumnKey.CABLE, maxLength: 50 },
  { key: AvanceColumnKey.ZONA, maxLength: 50 },
  { key: AvanceColumnKey.EMPRESA, maxLength: 50 },
  { key: AvanceColumnKey.PLANO_AL_COM, maxLength: 50 },
  { key: AvanceColumnKey.EJECUTOR, maxLength: 50 },
  { key: AvanceColumnKey.DIRECTOR, maxLength: 50 },
  { key: AvanceColumnKey.ETIQUETA, maxLength: 50 },
  { key: AvanceColumnKey.CONCA, maxLength: 100 },
  { key: AvanceColumnKey.EDIFICIO, maxLength: 20 },
];

/** Staging `conca` that the rebuild deletes ("basura de las planillas"): `LIKE 'CZONA%'`. */
export const JUNK_CONCA_PREFIX = "CZONA";
export const JUNK_CONCA_LIKE_PATTERN = `${JUNK_CONCA_PREFIX}%`;
export const NOT_AVAILABLE_EDIFICIO = "#N/A";

/** Zones that legacy duplicate/zone reports leave out. */
export const EXCLUDED_ZONE_NAMES: ReadonlyArray<string> = ["DO", "Primario", "PRIMARIO"];

export const STAGING_FUENTE = "EXTERNO/J.Pierri";
export const AVANCE_FUENTE = "Externo/J.Pierri + WFS/SIGRA";

/**
 * Decision O1 (parity): the legacy filter spelled the eliminated status with an accent that the
 * database does not store, so it excluded nothing. Set `[ELIMINATED_STATUS]` for the "intent".
 * Governs the rebuild and the two zone-matching reports.
 */
export const ELIMINATED_STATUS = "Proyectado/Eliminacion";
export const EXCLUDED_DISTRICT_STATUSES: ReadonlyArray<string> = [];

export const REJECTED_LIST_CAP = 200;
export const REJECTED_TEXT_MAX_LENGTH = 500;

export const INSERT_BATCH_SIZE = 1000;

export const MAX_FILES_PER_RUN = 2;
export const MAX_BODY_BYTES = MAX_FILES_PER_RUN * MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

/** The rebuild joins ~9k rows to ~7.6k zones with geometry; to be measured in the dry run. */
export const WRITE_STATEMENT_TIMEOUT_MS = 600000;
/** `ZONAS_FTTH_fuera_central` intersects every avance polygon with the central limits. */
export const REPORT_STATEMENT_TIMEOUT_MS = 900000;
/** Bounds how long a dry run can hold the table locks while it computes each report. */
export const DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS = 60_000;

export const ReportKind = {
  DUPLICADO: "duplicado_planilla_obras",
  ERROR_ESTADOS: "error_estados_modificados",
  EN_PLANILLA_NO_EN_SIGRA: "zonas_en_planilla_no_en_SIGRA",
  EN_SIGRA_NO_EN_PLANILLA: "zonas_en_SIGRA_no_en_planilla",
  FUERA_CENTRAL: "ZONAS_FTTH_fuera_central",
} as const;

export type ReportKind = (typeof ReportKind)[keyof typeof ReportKind];

export const REPORT_KINDS: ReadonlyArray<ReportKind> = Object.values(ReportKind);

export const REPORT_KIND_LABELS: Readonly<Record<ReportKind, string>> = {
  [ReportKind.DUPLICADO]: "Duplicados en las planillas de obras",
  [ReportKind.ERROR_ESTADOS]: "Estados modificados con error",
  [ReportKind.EN_PLANILLA_NO_EN_SIGRA]: "Zonas en la planilla y no en SIGRA",
  [ReportKind.EN_SIGRA_NO_EN_PLANILLA]: "Zonas en SIGRA y no en la planilla",
  [ReportKind.FUERA_CENTRAL]: "Zonas FTTH fuera de la central",
};

/** Prefixes of `configArch.ini` (`repDuplicado`, `repZonasnoSIGRA`, ...). */
export const REPORT_FILE_PREFIX: Readonly<Record<ReportKind, string>> = {
  [ReportKind.DUPLICADO]: "reporte_avance_duplicado_planilla_obras_",
  [ReportKind.ERROR_ESTADOS]: "reporte_avance_error_estados_modificados_",
  [ReportKind.EN_PLANILLA_NO_EN_SIGRA]: "reporte_avance_zonas_en_planilla_no_en_SIGRA_",
  [ReportKind.EN_SIGRA_NO_EN_PLANILLA]: "reporte_avance_zonas_en_SIGRA_no_en_planilla_",
  [ReportKind.FUERA_CENTRAL]: "reporte_avance_ZONAS_FTTH_fuera_central_",
};

export const REPORT_FILE_EXTENSION = ".txt";
export const REPORT_ZIP_PREFIX = "AvanceFTTH_Reportes";
export const REPORT_ZIP_EXTENSION = ".zip";
export const REPORT_TEXT_CONTENT_TYPE = "text/plain; charset=iso-8859-1";
export const REPORT_ZIP_CONTENT_TYPE = "application/zip";

export interface ReportColumnDefinition {
  readonly name: string;
  /** Legacy `trim_type both` on the output field; `estados` keeps `edificio` untouched. */
  readonly trims: boolean;
}

function trimmedColumns(...names: ReadonlyArray<string>): ReadonlyArray<ReportColumnDefinition> {
  return names.map((name) => ({ name, trims: true }));
}

/** Columns exactly as the legacy `SelectValues`/`TextFileOutput` field lists. */
export const REPORT_COLUMNS: Readonly<Record<ReportKind, ReadonlyArray<ReportColumnDefinition>>> = {
  [ReportKind.DUPLICADO]: trimmedColumns(
    "central", "cable", "zona", "empresa", "plano_al_com", "ejecutor", "director",
    "etiqueta", "conca", "edificio", "fechaact", "fuente", "fechacarga"
  ),
  [ReportKind.ERROR_ESTADOS]: [
    { name: "edificio", trims: false },
    ...trimmedColumns(
      "historico_edificio", "cable", "historico_cable", "zona", "historico_zona", "estado",
      "historico_estado", "empresa", "historico_empresa", "fecha", "historico_fecha", "director",
      "historico_director", "ejecutor", "historico_ejecutor", "historico_fechacarga"
    ),
  ],
  [ReportKind.EN_PLANILLA_NO_EN_SIGRA]: trimmedColumns("edificio", "cable", "zona", "conca", "etiqueta"),
  [ReportKind.EN_SIGRA_NO_EN_PLANILLA]: trimmedColumns(
    "id_distrito", "edificio", "identificacion_de_la_central", "codigo_distrito", "nombre_central",
    "cable", "zona", "conca", "situacion_distrito", "id_terminalfibraoptica", "codigo_terminalfibraoptica"
  ),
  [ReportKind.FUERA_CENTRAL]: trimmedColumns(
    "gid", "central", "cable", "zona", "conca", "edificio", "fecha", "estado", "fechacarga"
  ),
};

/** Reports run in groups, one read-only transaction each, so the slow one cannot hold the others. */
export const REPORT_GROUPS: ReadonlyArray<ReadonlyArray<ReportKind>> = [
  [
    ReportKind.DUPLICADO,
    ReportKind.ERROR_ESTADOS,
    ReportKind.EN_PLANILLA_NO_EN_SIGRA,
    ReportKind.EN_SIGRA_NO_EN_PLANILLA,
  ],
  [ReportKind.FUERA_CENTRAL],
];

export const SQL_DATE_FORMAT = "YYYY-MM-DD";
