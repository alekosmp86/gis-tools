import { defaultClientFactory } from "./createClient.ts";
import type { JobPgClientFactory } from "./createClient.ts";
import type { JobDbConnection } from "../types.ts";

const SQL_CANCEL_BACKEND = "SELECT pg_cancel_backend($1) AS cancelled";

/**
 * Cancels the statement running on backend `pid` from a SHORT second connection (the work
 * connection is busy inside that very statement). Resolves whether the server reported success.
 */
export async function cancelBackend(
  connection: JobDbConnection,
  pid: number,
  factory: JobPgClientFactory = defaultClientFactory
): Promise<boolean> {
  const client = factory(connection);
  client.on("error", () => undefined);
  try {
    await client.connect();
    const result = await client.query(SQL_CANCEL_BACKEND, [pid]);
    return (result.rows[0] as { cancelled?: boolean } | undefined)?.cancelled === true;
  } finally {
    await client.end().catch(() => undefined);
  }
}
