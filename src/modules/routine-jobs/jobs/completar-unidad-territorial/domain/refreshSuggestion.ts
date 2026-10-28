import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";
import { TERRITORIAL_UNIT_VIEW_NAME } from "../constants";

/** Text only: the tool never runs it, the user or their DBA does. */
export const buildRefreshViewStatement = (unitSchema: string): string =>
  `REFRESH MATERIALIZED VIEW ${quoteIdentifier(resolveSchemaName(unitSchema))}.${quoteIdentifier(TERRITORIAL_UNIT_VIEW_NAME)};`;
