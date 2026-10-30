import { buildRefreshMaterializedViewStatement } from "../../shared/refreshSuggestion";
import { PADRON_REFRESH_VIEW_NAMES } from "../constants";

export const buildPadronRefreshStatement = (schema: string): string =>
  PADRON_REFRESH_VIEW_NAMES.map((viewName) => buildRefreshMaterializedViewStatement(schema, viewName)).join("\n");
