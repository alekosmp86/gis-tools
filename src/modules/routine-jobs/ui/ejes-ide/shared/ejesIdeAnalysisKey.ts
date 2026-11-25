import { EJES_ROLES } from "../../../jobs/ejes-ide/constants";
import type { EjesStartRequest } from "./ejesIdeClientTypes";

/** The connection, the tables and the department an analysis was made with. The choices are not part of it: the load applies them itself. */
export const ejesAnalysisKeyOf = (request: Pick<EjesStartRequest, "connection" | "tables" | "department">): string => {
  const { host, port, db_name: database, user } = request.connection;
  const tables = EJES_ROLES.map((role) => `${request.tables[role].schema}.${request.tables[role].table}`);
  return JSON.stringify([host, port, database, user, request.department ?? null, ...tables]);
};
