import { Client } from "pg";
import { CONNECTION_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } from "../constants";
import type { AnalysisRow, DbConnection, RepositoryRequest } from "../types";
import type { AddressRepository } from "./AddressRepository";
import { runDuplicateAnalysis, type Queryable } from "./queries/runDuplicateAnalysis";

/** What the repository needs from a `pg` client; also what a test fake implements. */
export interface PgClientLike extends Queryable {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type PgClientFactory = (connection: DbConnection) => PgClientLike;

const SQL_BEGIN_READ_ONLY = "BEGIN READ ONLY";
const SQL_SET_STATEMENT_TIMEOUT = `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`;
const SQL_ROLLBACK = "ROLLBACK";

function createPgClient(connection: DbConnection): PgClientLike {
  return new Client({
    host: connection.host,
    port: connection.port,
    database: connection.db_name,
    user: connection.user,
    password: connection.password,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
}

/**
 * Runs the analysis in a read-only transaction, so a write attempt is refused by Postgres itself,
 * not by this code. One connection per call; the transaction is always rolled back and the
 * connection always closed.
 */
export class PgAddressRepository implements AddressRepository {
  constructor(private readonly createClient: PgClientFactory = createPgClient) {}

  async runDuplicateAnalysis(request: RepositoryRequest): Promise<AnalysisRow[]> {
    const client = this.createClient(request.connection);
    // pg emits 'error' on an unexpected disconnect; with no listener that is an uncaught exception.
    // The pending query's rejection is what reaches the caller.
    client.on("error", () => undefined);
    let isTransactionOpen = false;

    try {
      await client.connect();
      await client.query(SQL_BEGIN_READ_ONLY, []);
      isTransactionOpen = true;
      await client.query(SQL_SET_STATEMENT_TIMEOUT, []);
      return await runDuplicateAnalysis(client, request.parameters);
    } finally {
      await this.closeQuietly(client, isTransactionOpen);
    }
  }

  private async closeQuietly(client: PgClientLike, isTransactionOpen: boolean): Promise<void> {
    if (isTransactionOpen) {
      await client.query(SQL_ROLLBACK, []).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}
