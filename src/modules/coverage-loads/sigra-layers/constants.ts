export const SigraLayerId = {
  ZONAS_FTTH: "zonas-ftth",
  LIMITE_CENTRAL_FTTH: "limite-central-ftth",
  AREA_CD_SR: "area-cd-sr",
  AREA_CABLE_COBRE: "area-cable-cobre",
  AREA_CABLE_FTTH: "area-cable-ftth",
  AREA_CAJITAS_COBRE: "area-cajitas-cobre",
  AREA_TFO: "area-tfo",
  LIMITE_CENTRAL_COBRE: "limite-central-cobre",
  LIMITE_ECONOMICO_COBRE: "limite-economico-cobre",
  LIMITE_MIXTO_COBRE: "limite-mixto-cobre",
  CAJA_DISTRIBUCION: "caja-distribucion",
  CAJITAS_COBRE: "cajitas-cobre",
  TFO_DIVISORES: "tfo-divisores",
  CAMARAS: "camaras",
  CENTRALES_COBRE: "centrales-cobre",
  CENTRALES_FTTH: "centrales-ftth",
  POSTES: "postes",
  ZONAS_INSEGURIDAD: "zonas-inseguridad",
} as const;

export type SigraLayerId = (typeof SigraLayerId)[keyof typeof SigraLayerId];

export const REQUIRED_LAYER_IDS: ReadonlyArray<SigraLayerId> = [
  SigraLayerId.ZONAS_FTTH,
  SigraLayerId.LIMITE_CENTRAL_FTTH,
];

export const WFS_BASE_URL =
  "http://vmlx-sgrabal-prod/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json";

export const WfsParam = {
  TYPE_NAME: "typeName",
  CQL_FILTER: "CQL_FILTER",
  SORT_BY: "sortBy",
  COUNT: "count",
  START_INDEX: "startIndex",
} as const;

export const VALIDATION_MIN_RATIO = 0.97;
export const SOURCE_LABEL = "SIGRA/WFS";
export const SOURCE_SRID = 31981;
export const GEOGRAPHIC_SRID = 4326;
export const AREA_DECIMALS = 3;

export const WFS_MAX_RETRIES = 2;
export const WFS_REQUEST_TIMEOUT_MS = 60_000;
export const WFS_RETRY_BACKOFF_BASE_MS = 500;

export const HTTP_SERVER_ERROR_MIN_STATUS = 500;

export const LOAD_STATEMENT_TIMEOUT_MS = 600_000;
export const LOAD_LOCK_TIMEOUT = "30s";
export const STAGING_TABLE = "sigra_staging";

export const AUDIT_TABLE = "public.etl_auditoria";

export const AuditState = {
  STARTED: "INICIADO",
  SUCCESS: "EXITO",
  ERROR: "ERROR",
} as const;

export const SqlPrivilege = {
  SELECT: "SELECT",
  INSERT: "INSERT",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  USAGE: "USAGE",
} as const;
