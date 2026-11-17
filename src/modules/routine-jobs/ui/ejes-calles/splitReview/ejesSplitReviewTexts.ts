import { ACCEPTED_CHOICES_LIMIT, ACCEPTED_KEYS_LIMIT, EJES_POINT_REASON, type EjesPointReason } from "../../../jobs/ejes-calles/constants";

export const EJES_SPLIT_REVIEW_TEXT = {
  OPEN_BUTTON: "Revisar puntos",
  MODAL_TITLE: "Revisar puntos de la división",
  NO_REFTRAMO: "Sin reftramo: no se puede revisar.",
  LOADING: "Cargando los puntos del tramo…",
  LOAD_FAILED: "No se pudieron cargar los puntos del tramo.",
  ANALYSIS_CHANGED: "El análisis cambió, vuelva a analizar.",
  COUNT_MISMATCH: "Los puntos guardados no coinciden con el resumen del análisis: no se puede elegir. Vuelva a analizar.",
  INCOMPLETE_REVIEW: "Hay más puntos a revisar de los que el análisis guarda: este tramo no se puede aceptar. Vuelva a analizar con menos tramos.",
  RETRY: "Reintentar",
  NO_PASSWORD: "Escriba la contraseña de la conexión en el paso de conexión para revisar los puntos.",
  EMPTY: "No hay puntos que revisar con este filtro.",
  POINT_TITLE: "Punto de acceso",
  SUGGESTED: "Sugerido",
  CHOSEN: "Elegido",
  CHOOSE: "Elegir",
  UNCHOOSE: "Quitar elección",
  NO_DISTANCE: "Sin distancia",
  SHOW_MAP: "Ver en mapa",
  HIDE_MAP: "Ocultar mapa",
  MAP_TITLE: "PUNTO Y TRAMOS",
  MAP_EMPTY: "No hay geometría que mostrar para este punto.",
  MAP_RENDER_FAILURE: (message: string): string => `No se pudo mostrar el mapa: ${message}`,
  ACCEPT_SUGGESTED: "Aceptar sugeridos",
  ACCEPT_SPLIT: "Aceptar tramo",
  REJECT_SPLIT: "Rechazar tramo",
  ACCEPTED_NOTE: "Tramo aceptado: sus destinos se envían con Cargar ahora.",
  SPLIT_NOT_YET: "El tramo se acepta en la lista cuando todos sus puntos tienen destino.",
  FILTER_REASON: "Motivo",
  FILTER_STREET: "Calle (idcalle)",
  FILTER_STREET_PLACEHOLDER: "Todas las calles",
  FILTERED_LIST: (shown: number, total: number): string => `Filtro activo: se muestran ${shown} de ${total} tramos.`,
  PROGRESS: (resolved: number, total: number): string => `${resolved} de ${total} puntos resueltos`,
  ACCEPT_SUGGESTED_HINT: (count: number): string => `${count} puntos ambiguos sin elegir tienen sugerencia.`,
  ACCEPT_SUGGESTED_CAPPED: (added: number): string =>
    `Solo caben ${added} destinos más antes del límite de ${ACCEPTED_CHOICES_LIMIT}.`,
  CHOICE_CAP_NOTE: `Se alcanzó el límite de ${ACCEPTED_CHOICES_LIMIT} destinos de puntos: no se eligen más.`,
  SPLIT_CAP_NOTE: `Se alcanzó el límite de ${ACCEPTED_KEYS_LIMIT} tramos aceptados: no se aceptan más.`,
  ADDRESS_NOTE_PREFIX: "Geometría de direcciones: ",
  PIECE_LABEL: (newRef: string): string => `Tramo nuevo ${newRef}`,
  OLD_SECTION_LABEL: (oldRef: string): string => `Tramo anterior ${oldRef}`,
  DISTANCE_TEXT: (meters: number): string => `${meters} m del punto`,
  HEADING: (oldRef: string, idcalle: string | null): string => `Tramo ${oldRef} · idcalle ${idcalle ?? "sin dato"}`,
} as const;

export const EJES_SPLIT_REASON_TEXT: Record<EjesPointReason, string> = {
  [EJES_POINT_REASON.AMBIGUOUS]: "Ambiguo",
  [EJES_POINT_REASON.NO_GEOMETRY]: "Sin coordenada",
};

export const EJES_SPLIT_REASON_NOTE: Record<EjesPointReason, string> = {
  [EJES_POINT_REASON.AMBIGUOUS]: "Dos tramos están casi a la misma distancia: el sugerido es el más cercano.",
  [EJES_POINT_REASON.NO_GEOMETRY]: "El punto no tiene coordenada: no tiene distancias ni sugerencia. Elija un tramo.",
};

export const EJES_SPLIT_DOOR_TEXT = {
  NUMBER: "Número",
  LETTER: "Letra",
  KM: "Km",
  CIRCULATION_WAY: "Vía",
} as const;

export const EJES_SPLIT_REASON_FILTER_TEXT = {
  ALL: "Todos los motivos",
  AMBIGUOUS: "Ambiguos",
  NO_GEOMETRY: "Sin coordenada",
} as const;
