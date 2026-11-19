import { ACCEPTED_KEYS_LIMIT } from "../../jobs/ejes-calles/constants";

export const EJES_TWIN_PICK_TEXT = {
  LIST_HELP:
    "Cada tramo tiene varias copias y ninguna regla decide cuál se queda. La copia elegida se queda; las demás no se escriben. Elija una copia por tramo y pulse «Analizar con mis elecciones».",
  COLUMN_REF: "reftramo",
  COLUMN_ID: "idcalle",
  COLUMN_NAME: "Calle",
  COLUMN_POINTS: "Puntos de acceso",
  COLUMN_WAITING: "Esperan",
  COLUMN_COPY: "Copia",
  COPY_PLACEHOLDER: "Elegir copia",
  ANALYZE: "Analizar con mis elecciones",
  APPLIED_PREFIX: "Elecciones aplicadas",
  PICKS_TITLE: "Mis elecciones",
  PICKS_EMPTY: "Todavía no eligió ninguna copia.",
  PICK_COLUMN_CHOSEN: "Copia elegida",
  PICK_COLUMN_ACTION: "Acción",
  REMOVE: "Quitar",
  MAP_COPIES_TITLE: "Copias del tramo",
  CHOOSE_COPY: "Elegir esta copia",
  CHOSEN_COPY: "Elegida",
  CLEAR_CHOICE: "Quitar elección",
  COPY_NOT_PICKABLE: "Sin departamento o localidad: no se puede elegir.",
  MAP_ANALYZE_NOTE: "Pulse «Analizar con mis elecciones» para ver el efecto.",
  CAP_NOTE: `Se admiten hasta ${ACCEPTED_KEYS_LIMIT} elecciones: quite alguna para elegir otra.`,
} as const;

export const appliedTextOf = (applied: number): string => `${EJES_TWIN_PICK_TEXT.APPLIED_PREFIX}: ${applied}`;
