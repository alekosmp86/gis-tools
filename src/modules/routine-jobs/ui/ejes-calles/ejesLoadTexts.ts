import { EJES_SKIP_KIND, EJES_SKIP_REASON, RENUMBER_SKIP_REASON, type EjesSkipKind, type EjesSkipReason, type RenumberSkipReason } from "../../jobs/ejes-calles/constants";

export const EJES_LOAD_TITLE = "Resultado de la carga";
export const EJES_LOAD_DONE_BANNER = "Carga confirmada: las tablas de ejes de calles fueron modificadas.";
export const EJES_LOAD_UNKNOWN_BANNER =
  "No se pudo confirmar el COMMIT: verifique las tablas de ejes de calles antes de volver a cargar.";
export const EJES_LOAD_SKIPPED_TITLE = "Omitidos, sin aplicar";
export const EJES_LOAD_SURPLUS_TITLE = "Tramos sobrantes (no se borran)";
export const EJES_LOAD_COUNT_TEXT = {
  TOPOLOGY_ASSIGNED: "Tramos con topología asignada",
  VERTICES_CREATED: "Vértices de ruteo creados",
  VERTICES_DELETED: "Vértices de ruteo borrados (sin uso)",
} as const;
export const EJES_LOAD_BACKUP_INSTRUCTIONS = [
  "Para revertir, descomprima el .gz y ejecute el .sql completo contra la base, con psql o con pgAdmin / cualquier cliente SQL. Restaura los vértices de ruteo borrados, los tramos tocados, los tramos y direcciones maestras borrados y los puntos de acceso movidos, y borra los tramos, vías, direcciones maestras y vértices de ruteo creados.",
  "El respaldo solo sirve antes de cualquier reconstrucción posterior de la topología: un pgr_createTopology con clean := true renumera los vértices. Los vértices de ruteo creados se borran por id, por encima del máximo previo a la carga.",
  "El servidor guarda una copia temporal durante 7 días.",
  "Si el servidor se reinicia, los enlaces de descarga dejan de funcionar: descargue el respaldo antes.",
];

export const EJES_SKIP_KIND_TEXT: Record<EjesSkipKind, string> = {
  [EJES_SKIP_KIND.SPLIT]: "Tramo dividido",
  [EJES_SKIP_KIND.MERGE]: "Tramos unidos",
  [EJES_SKIP_KIND.REMOVAL]: "Sin reemplazo",
  [EJES_SKIP_KIND.RENUMBER]: "Renumeración no aplicada",
};

export const RENUMBER_SKIP_TEXT: Record<RenumberSkipReason, string> = {
  [RENUMBER_SKIP_REASON.REPEATED_OLD_REF]: "El reftramo actual aparece en más de un tramo",
  [RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF]: "El tramo actual tiene más de un candidato",
  [RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF]: "El reftramo nuevo tiene más de un candidato",
  [RENUMBER_SKIP_REASON.NOT_SINGLE_COPY]: "El reftramo nuevo no tiene exactamente una copia",
};

export const SKIP_REASON_TEXT: Record<EjesSkipReason, string> = {
  ...RENUMBER_SKIP_TEXT,
  [EJES_SKIP_REASON.NOT_ACCEPTED]: "No aceptado en el análisis",
  [EJES_SKIP_REASON.SPLIT_PENDING]: "División pendiente: no se aplica en esta carga",
  [EJES_SKIP_REASON.HAS_POINTS]: "Tiene puntos de acceso: no se quita",
  [EJES_SKIP_REASON.NO_REFTRAMO]: "Sin reftramo: no se puede verificar",
  [EJES_SKIP_REASON.SHARED_OLD_REF]: "Un tramo actual pertenece a otra unión aceptada",
  [EJES_SKIP_REASON.ID_LINKED_POINTS]: "Puntos de acceso ligados por id: el tramo no se quita",
};

export const NO_REFTRAMO_TEXT = "sin reftramo";

export const EJES_LOAD_SKIPPED_BY_REASON_TITLE = "Omitidos por motivo (conteo completo)";

export const skippedCapTextOf = (shown: number, total: number): string =>
  `Primeras ${shown} de ${total} filas omitidas. Los conteos por motivo cubren todas.`;
