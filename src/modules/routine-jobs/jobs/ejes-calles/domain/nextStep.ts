import { buildRefreshMaterializedViewStatement } from "../../shared/refreshSuggestion";
import { EJES_REFRESH_VIEW_NAMES, EJES_STAGING_REFRESH_VIEW } from "../constants";
import type { EjesNextStep, EjesTableRef } from "../types";

const NEXT_STEP_TEXT =
  "Las vistas materializadas de ejes no se actualizan solas. Un administrador debe refrescarlas, en este orden, para que el mapa y los servicios muestren los cambios (bdj_ejes solo mientras exista):";

export function buildEjesNextStep(roadSection: EjesTableRef, staging: EjesTableRef): EjesNextStep {
  const statements = [
    buildRefreshMaterializedViewStatement(staging.schema, EJES_STAGING_REFRESH_VIEW),
    ...EJES_REFRESH_VIEW_NAMES.map((viewName) => buildRefreshMaterializedViewStatement(roadSection.schema, viewName)),
  ];
  return { text: NEXT_STEP_TEXT, statement: statements.join("\n") };
}
