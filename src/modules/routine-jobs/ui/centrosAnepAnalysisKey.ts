import { CENTROS_ROLES } from "../jobs/centros-anep/constants";
import type { CentrosAnepStartRequest } from "./clientTypes";

export const centrosAnepAnalysisKeyOf = (request: Pick<CentrosAnepStartRequest, "connection" | "tables">): string => {
  const { host, port, db_name: database, user } = request.connection;
  const tables = CENTROS_ROLES.map((role) => `${request.tables[role].schema}.${request.tables[role].table}`);
  return JSON.stringify([host, port, database, user, ...tables]);
};
