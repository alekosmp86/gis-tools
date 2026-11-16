import { RENUMBER_SKIP_REASON, type RenumberSkipReason } from "../jobs/ejes-calles/constants";
import type { EjesSkippedRow } from "../jobs/ejes-calles/types";

export const EJES_LOAD_TITLE = "Resultado de la carga";
export const EJES_LOAD_DONE_BANNER = "Carga confirmada: las tablas de ejes de calles fueron modificadas.";
export const EJES_LOAD_UNKNOWN_BANNER =
  "No se pudo confirmar el COMMIT: verifique las tablas de ejes de calles antes de volver a cargar.";
export const EJES_LOAD_SKIPPED_TITLE = "Omitidos, sin aplicar";
export const EJES_LOAD_SURPLUS_TITLE = "Tramos sobrantes (no se borran)";
export const EJES_LOAD_BACKUP_INSTRUCTIONS = [
  "Para revertir, descomprima el .gz y ejecute el .sql completo contra la base, con psql o con pgAdmin / cualquier cliente SQL. Restaura los tramos tocados y los puntos de acceso movidos, y borra los tramos, vías y direcciones maestras insertados.",
  "El servidor guarda una copia temporal durante 7 días.",
  "Si el servidor se reinicia, los enlaces de descarga dejan de funcionar: descargue el respaldo antes.",
];

export const EJES_SKIP_KIND_TEXT: Record<EjesSkippedRow["kind"], string> = {
  split: "Tramo dividido",
  merge: "Tramos unidos",
  removal: "Sin reemplazo",
  renumber: "Renumeración no aplicada",
};

export const RENUMBER_SKIP_TEXT: Record<RenumberSkipReason, string> = {
  [RENUMBER_SKIP_REASON.REPEATED_OLD_REF]: "El reftramo actual aparece en más de un tramo",
  [RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF]: "El tramo actual tiene más de un candidato",
  [RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF]: "El reftramo nuevo tiene más de un candidato",
  [RENUMBER_SKIP_REASON.NOT_SINGLE_COPY]: "El reftramo nuevo no tiene exactamente una copia",
};
