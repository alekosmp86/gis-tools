import { buildRefreshMaterializedViewStatement } from "../../shared/refreshSuggestion";
import { TERRITORIAL_UNIT_VIEW_NAME } from "../constants";

export const buildRefreshViewStatement = (unitSchema: string): string =>
  buildRefreshMaterializedViewStatement(unitSchema, TERRITORIAL_UNIT_VIEW_NAME);
