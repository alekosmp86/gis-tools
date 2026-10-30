import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";

/** Text only: the tool never runs it, the user or their DBA does. */
export const buildRefreshMaterializedViewStatement = (schema: string, viewName: string): string =>
  `REFRESH MATERIALIZED VIEW ${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(viewName)};`;
