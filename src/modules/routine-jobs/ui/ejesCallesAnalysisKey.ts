import { EJES_ROLES } from "../jobs/ejes-calles/constants";
import type { EjesStartRequest } from "./clientTypes";

export const ejesAnalysisKeyOf = (request: Pick<EjesStartRequest, "connection" | "tables">): string => {
  const { host, port, db_name: database, user } = request.connection;
  const tables = EJES_ROLES.map((role) => `${request.tables[role].schema}.${request.tables[role].table}`);
  return JSON.stringify([host, port, database, user, ...tables]);
};
