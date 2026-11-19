import { ACCEPTED_KEYS_LIMIT } from "../../jobs/ejes-calles/constants";

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
  NO_RECEIVING_SECTION: "Sus puntos de acceso no tienen un tramo que los reciba",
  CAP_NOTE: `Aceptar todos llega al límite de ${ACCEPTED_KEYS_LIMIT} tramos aceptados en esta lista: acepta hasta ese número.`,
} as const;

export const acceptedCountTextOf = (accepted: number, total: number): string => `${accepted} aceptados de ${total}`;

export const incompleteListTextOf = (listed: number, total: number): string =>
  `Lista incompleta: se muestran ${listed} de ${total}. Aceptar todos actúa solo sobre los listados.`;
