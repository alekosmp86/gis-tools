import { ACCEPTED_KEYS_LIMIT, MANUAL_SPLIT_REASON, type ManualSplitReason } from "../../jobs/ejes-calles/constants";
import { plural } from "../../jobs/shared/text";

export const EJES_ACCEPT_TEXT = {
  COLUMN: "Aceptar",
  ACCEPT: "Aceptar",
  REJECT: "Rechazar",
  ACCEPT_ALL: "Aceptar todos",
  REJECT_ALL: "Rechazar todos",
  NOT_ACCEPTABLE: "No aceptable: sin reftramo",
  NEEDS_REVIEW: "Requiere revisión",
  SPLIT_NOTE: "Se acepta cuando todos sus puntos de acceso tienen destino.",
  REPLACEMENT_NOTE: "Acepta: los puntos pasan al nuevo tramo y se quita el anterior",
  REPLACEMENT_REVIEW_HINT: "Tramo muy corto o mucho más largo: confirme el destino de sus puntos",
  NO_RECEIVING_SECTION: "Sus puntos de acceso no tienen un tramo que los reciba",
  CAP_NOTE: `Aceptar todos llega al límite de ${ACCEPTED_KEYS_LIMIT} tramos aceptados en esta lista: acepta hasta ese número.`,
  AUTO_REMOVAL_CAPTION: "tramos sin puntos de acceso ni reemplazo; el archivo es la fuente de verdad",
} as const;

export const acceptedCountTextOf = (accepted: number, total: number): string => `${accepted} aceptados de ${total}`;

export const autoRemovalLineOf = (count: number): string =>
  `Cargar ahora quita automáticamente ${plural(count, "tramo", "tramos")} sin puntos de acceso ni reemplazo.`;

export const incompleteListTextOf = (listed: number, total: number): string =>
  `Lista incompleta: se muestran ${listed} de ${total}. Aceptar todos actúa solo sobre los listados.`;

export const EJES_MANUAL_SPLIT_TEXT = {
  RESOLVE: "Resolver en el mapa",
  COLUMN_MAP: "Mapa",
  TITLE: (ref: string): string => `Resolver el tramo ${ref}`,
  HELP: "Elija en el mapa o en la lista los tramos nuevos que reemplazan a este tramo: uno lo reemplaza y dos o más lo dividen. Su elección solo anula el umbral de cobertura.",
  LOADING: "Cargando los tramos nuevos cerca del tramo anterior…",
  LOAD_FAILED: "No se pudieron cargar los tramos nuevos.",
  RETRY: "Reintentar",
  EMPTY: "No hay tramos nuevos cerca de este tramo con el radio elegido.",
  RADIUS: "Radio de búsqueda (m)",
  OTHER_STREETS: "Incluir otras calles",
  COLUMN_CHOOSE: "Elegir",
  COLUMN_REF: "reftramo",
  COLUMN_STREET: "Calle",
  COLUMN_LOCALITY: "Localidad",
  COLUMN_LENGTH: "Largo (m)",
  COLUMN_NEAR: "Metros cerca (m)",
  COLUMN_COVERED: "% cubierto",
  COLUMN_DISTANCE: "Distancia (m)",
  CHOSEN_COUNT: (count: number): string => `Seleccionados: ${count}.`,
  CHOSEN_NONE: "Elija al menos un tramo nuevo.",
  CHOSEN_REPLACEMENT: "Se aplicará como reemplazo.",
  CHOSEN_SPLIT: (count: number): string => `Se aplicará como división en ${count} tramos.`,
  NEAR_SUM: (near: string, old: string): string => `Metros cerca del tramo anterior: ${near} de ${old} m.`,
  APPLY: "Aplicar",
  CLEAR_SELECTION: "Quitar selección",
  APPLY_NOTE: "Pulse «Analizar con mis elecciones» para ver el efecto.",
  BADGE: "Manual",
  PANEL_TITLE: "Mis divisiones manuales",
  PANEL_EMPTY: "Todavía no eligió tramos nuevos para ningún tramo sin reemplazo.",
  PANEL_CAP_NOTE: `Se admiten hasta ${ACCEPTED_KEYS_LIMIT} divisiones manuales: quite alguna para elegir otra.`,
  PANEL_COLUMN_OLD: "reftramo anterior",
  PANEL_COLUMN_PIECES: "Tramos nuevos",
  PANEL_COLUMN_STATE: "Estado",
  PANEL_COLUMN_ACTION: "Acción",
  REMOVE: "Quitar",
  MAP_TITLE: "TRAMOS PARA RESOLVER",
  MAP_RENDER_FAILURE: (message: string): string => `No se pudo mostrar el mapa: ${message}`,
  CHOOSE_ARIA: (ref: string): string => `Elegir el tramo ${ref}`,
  FACTS: (idcalle: string, points: number): string => `idcalle ${idcalle}, puntos de acceso: ${points}`,
} as const;

export const manualAppliedTextOf = (applied: number): string => `Divisiones manuales aplicadas: ${applied}`;

export const manualLoadLineOf = (count: number): string =>
  `Cargar ahora aplicará ${plural(count, "división manual", "divisiones manuales")}.`;

export const MANUAL_SPLIT_IGNORED_TEXT: Record<ManualSplitReason, string> = {
  [MANUAL_SPLIT_REASON.NOT_REMOVED]: "No aplicada: el tramo anterior ya no se quita",
  [MANUAL_SPLIT_REASON.PIECE_UNAVAILABLE]:
    "No aplicada: un tramo nuevo ya no está disponible (varias copias, existe en carto o ya tiene destino)",
};
