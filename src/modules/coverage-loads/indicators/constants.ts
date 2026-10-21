import { MAX_FILE_BYTES, MULTIPART_OVERHEAD_BYTES } from "../constants";

/** Value stored in `usuario` (history) and `fuente` (staging) for every row this tool loads. */
export const FUENTE = "EXTERNO/F.Maresca";

export const HISTORY_TABLE = "historico.h_cobertura_lte_localidad";
export const STAGING_TABLE = "public.indicadores_lte";

export const HistoryPrivilege = {
  SELECT: "SELECT",
  INSERT: "INSERT",
  DELETE: "DELETE",
} as const;

/** `IndicadoresLTE_aaaammdd.csv`: the prefix and the extension are case-sensitive. */
export const FILE_NAME_PATTERN = /^IndicadoresLTE_(\d{4})(\d{2})(\d{2})\.csv$/;

export const FILE_NAME_FORMAT_HINT = "IndicadoresLTE_aaaammdd.csv";

export const NULL_MARKER = "-";

export const CsvColumn = {
  DEPARTAMENTO: 0,
  LOCALIDAD: 1,
  PORCENTAJE: 2,
  COBERTURA: 3,
} as const;

export const EXPECTED_COLUMN_COUNT = 4;

export const NOMBDEPTO_MAX_LENGTH = 15;
export const NOMBLOC_MAX_LENGTH = 40;
export const PORCENTAJE_MAX = 100;

export const Cobertura = {
  YES: "SI",
  NO: "NO",
} as const;

export const MAX_FILES_PER_RUN = 24;
export const MAX_BODY_BYTES = MAX_FILES_PER_RUN * MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

export const ReportKind = {
  LOCALIDAD: "localidad",
  MAYOR50: "mayor50",
  NOVEDAD: "novedad",
} as const;

export type ReportKind = (typeof ReportKind)[keyof typeof ReportKind];

export const REPORT_KIND_LABELS: Readonly<Record<ReportKind, string>> = {
  [ReportKind.LOCALIDAD]: "Cobertura LTE por localidad",
  [ReportKind.MAYOR50]: "Localidades con cobertura LTE mayor al 50%",
  [ReportKind.NOVEDAD]: "Novedades de cobertura LTE",
};

export const REPORT_FILE_PREFIX: Readonly<Record<ReportKind, string>> = {
  [ReportKind.LOCALIDAD]: "reporte_cobertura_lte_localidad",
  [ReportKind.MAYOR50]: "reporte_cobertura_lte_localidad_mayor50",
  [ReportKind.NOVEDAD]: "reporte_cobertura_lte_localidad_novedad",
};

/** The two underscores before the date are intentional: they are what the legacy files carry. */
export const REPORT_FILE_DATE_SEPARATOR = "__";
export const REPORT_FILE_EXTENSION = ".csv";

export const ReportColumn = {
  DEPARTAMENTO: "departamento",
  LOCALIDAD: "localidad",
  PORCENTAJE: "porcentajecobertura",
  FECHA_NOVEDAD: "fecha_novedad",
} as const;

export type ReportColumn = (typeof ReportColumn)[keyof typeof ReportColumn];

export const REPORT_COLUMNS: Readonly<Record<ReportKind, ReadonlyArray<ReportColumn>>> = {
  [ReportKind.LOCALIDAD]: [
    ReportColumn.DEPARTAMENTO,
    ReportColumn.LOCALIDAD,
    ReportColumn.PORCENTAJE,
    ReportColumn.FECHA_NOVEDAD,
  ],
  [ReportKind.MAYOR50]: [ReportColumn.DEPARTAMENTO, ReportColumn.LOCALIDAD, ReportColumn.FECHA_NOVEDAD],
  [ReportKind.NOVEDAD]: [ReportColumn.DEPARTAMENTO, ReportColumn.LOCALIDAD, ReportColumn.FECHA_NOVEDAD],
};

export const REPORT_CONTENT_TYPE = "text/csv; charset=iso-8859-1";
