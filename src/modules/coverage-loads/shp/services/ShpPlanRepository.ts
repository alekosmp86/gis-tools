import type { DbConnection } from "../../types";
import type { ShpTable } from "../job/types.ts";
import type { ShpDbInspection } from "../types";

/** Read-only view of the database for the plan; injectable so tests never need a server. */
export interface ShpPlanRepository {
  inspect(connection: DbConnection, table: ShpTable): Promise<ShpDbInspection>;
}
