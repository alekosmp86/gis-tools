import { EJES_ROLES } from "../../jobs/ejes-calles/constants";
import type { EjesStartRequest } from "./clientTypes";

/** The connection, the tables, the department and the choices (twin picks, manual splits) an analysis was made with: another choice is another analysis. */
export const ejesAnalysisKeyOf = (request: Pick<EjesStartRequest, "connection" | "tables" | "department" | "accepted">): string => {
  const { host, port, db_name: database, user } = request.connection;
  const tables = EJES_ROLES.map((role) => `${request.tables[role].schema}.${request.tables[role].table}`);
  return JSON.stringify([host, port, database, user, request.department ?? null, ...tables, request.accepted?.twinPicks ?? [], request.accepted?.manualSplits ?? []]);
};
