import { CENTROS_TABLE_ROLE, type CentrosTableRole } from "../jobs/centros-anep/constants";

export const CENTROS_ROLE_TITLES: Record<CentrosTableRole, string> = {
  [CENTROS_TABLE_ROLE.STAGING]: "Centros ANEP (staging)",
  [CENTROS_TABLE_ROLE.FINAL]: "Centros ANEP (final)",
};

export const CENTROS_DRY_RUN_BANNER = "Análisis: no se modificó ninguna tabla.";
export const CENTROS_DONE_BANNER = "Carga confirmada: la tabla final de centros ANEP fue reemplazada.";
export const CENTROS_UNKNOWN_BANNER =
  "No se pudo confirmar el COMMIT: verifique la tabla final de centros ANEP antes de reintentar.";
export const CENTROS_NEXT_STEP_TITLE = "Siguiente paso sugerido";
export const CENTROS_NEXT_STEP_TEXT =
  "Refresque la capa en GeoServer si guarda caché. La capa lee la tabla directamente, así que no hace falta nada más.";
export const CENTROS_CONFIRM_LABEL =
  "Entiendo que la tabla final se vacía y se vuelve a llenar con los datos de staging.";
