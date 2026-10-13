import { createPgClient, type PgClientFactory } from "../../shared/pgClient";
import { runInTransaction, type TransactionSettings } from "../../shared/runInTransaction";
import type { DbConnection } from "../../types";
import { PLAN_STATEMENT_TIMEOUT_MS } from "../constants";
import type { ShpTable } from "../job/types.ts";
import type { ShpDbInspection } from "../types";
import type { ShpPlanRepository } from "./ShpPlanRepository";
import {
  readAdvisoryLockHeld,
  readLeftovers,
  readMissingTablePrivileges,
  readPostgisAvailable,
  readRowCount,
  readSchemaCreateGranted,
} from "./queries/shpPlanQueries";

const READ_ONLY_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [`SET LOCAL statement_timeout = ${PLAN_STATEMENT_TIMEOUT_MS}`],
};

/** The plan runs in `BEGIN READ ONLY`, so Postgres itself refuses any write. */
export class PgShpPlanRepository implements ShpPlanRepository {
  constructor(private readonly createClient: PgClientFactory = createPgClient) {}

  inspect(connection: DbConnection, table: ShpTable): Promise<ShpDbInspection> {
    return runInTransaction(this.createClient(connection), READ_ONLY_TRANSACTION, false, async (client) => {
      const privileges = await readMissingTablePrivileges(client, table);
      return {
        tableExists: privileges.tableExists,
        missingTablePrivileges: privileges.missing,
        schemaCreateGranted: await readSchemaCreateGranted(client),
        postgisAvailable: await readPostgisAvailable(client),
        leftovers: await readLeftovers(client, table),
        advisoryLockHeld: await readAdvisoryLockHeld(client, table),
        currentRows: privileges.tableExists && !privileges.missing.includes("SELECT") ? await readRowCount(client, table) : null,
      };
    });
  }
}
