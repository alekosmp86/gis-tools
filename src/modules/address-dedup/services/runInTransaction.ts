import type { PgClientLike } from "./PgAddressRepository";

export interface TransactionSettings {
  /** The full BEGIN statement, which fixes the isolation level and the access mode. */
  readonly begin: string;
  /** `SET LOCAL` statements applied right after BEGIN. */
  readonly settings: ReadonlyArray<string>;
}

const SQL_COMMIT = "COMMIT";
const SQL_ROLLBACK = "ROLLBACK";

async function closeQuietly(client: PgClientLike, isTransactionOpen: boolean): Promise<void> {
  if (isTransactionOpen) {
    await client.query(SQL_ROLLBACK, []).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}

/**
 * Runs `work` on one fresh connection inside one transaction. `shouldCommit` false rolls back even
 * on success (the simulation). Any failure rolls back; the connection is always closed.
 */
export async function runInTransaction<TResult>(
  client: PgClientLike,
  transaction: TransactionSettings,
  shouldCommit: boolean,
  work: (client: PgClientLike) => Promise<TResult>
): Promise<TResult> {
  // pg emits 'error' on an unexpected disconnect; with no listener that is an uncaught exception.
  // The pending query's rejection is what reaches the caller.
  client.on("error", () => undefined);
  let isTransactionOpen = false;

  try {
    await client.connect();
    await client.query(transaction.begin, []);
    isTransactionOpen = true;
    for (const setting of transaction.settings) {
      await client.query(setting, []);
    }
    const result = await work(client);
    if (shouldCommit) {
      await client.query(SQL_COMMIT, []);
      isTransactionOpen = false;
    }
    return result;
  } finally {
    await closeQuietly(client, isTransactionOpen);
  }
}
