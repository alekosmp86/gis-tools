import { buildRefreshMaterializedViewStatement } from "../../shared/refreshSuggestion";
import { EJES_REFRESH_VIEW_NAMES } from "../constants";
import type { EjesNextStep, EjesTableRef } from "../types";

const NEXT_STEP_TEXT =
  "Las vistas materializadas de ejes no se actualizan solas. Un administrador debe refrescarlas, en este orden, para que el mapa y los servicios muestren los cambios:";

export function buildEjesNextStep(roadSection: EjesTableRef): EjesNextStep {
  const statements = EJES_REFRESH_VIEW_NAMES.map((viewName) => buildRefreshMaterializedViewStatement(roadSection.schema, viewName));
  return { text: NEXT_STEP_TEXT, statement: statements.join("\n") };
}
