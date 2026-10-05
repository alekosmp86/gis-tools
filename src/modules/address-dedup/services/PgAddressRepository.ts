import { Client } from "pg";
import { CONNECTION_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } from "../constants";
import type { AnalysisRow, DbConnection, ProvinceOption, RepositoryRequest } from "../types";
import type { AddressRepository } from "./AddressRepository";
import { mapProvinceRow } from "./queries/mapProvinceRow";
import { PROVINCES_SQL } from "./queries/provincesQuery";
import { runDuplicateAnalysis, type Queryable } from "./queries/runDuplicateAnalysis";
import { runInTransaction, type TransactionSettings } from "./runInTransaction";

/** What the repository needs from a `pg` client; also what a test fake implements. */
export interface PgClientLike extends Queryable {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type PgClientFactory = (connection: DbConnection) => PgClientLike;

const READ_ONLY_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`],
};

export function createPgClient(connection: DbConnection): PgClientLike {
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
 * Runs every read in a read-only transaction, so a write attempt is refused by Postgres itself,
 * not by this code. One connection per call; the transaction is always rolled back and the
 * connection always closed.
 */
export class PgAddressRepository implements AddressRepository {
  constructor(private readonly createClient: PgClientFactory = createPgClient) {}

  runDuplicateAnalysis(request: RepositoryRequest): Promise<AnalysisRow[]> {
    return this.readOnly(request.connection, (client) =>
      runDuplicateAnalysis(client, request.parameters)
    );
  }

  listProvinces(connection: DbConnection): Promise<ProvinceOption[]> {
    return this.readOnly(connection, async (client) => {
      const result = await client.query(PROVINCES_SQL, []);
      return result.rows.flatMap((row) => {
        const province = mapProvinceRow(row as Record<string, unknown>);
        return Number.isInteger(province.id) && province.id > 0 ? [province] : [];
      });
    });
  }

  private readOnly<TResult>(
    connection: DbConnection,
    work: (client: PgClientLike) => Promise<TResult>
  ): Promise<TResult> {
    return runInTransaction(this.createClient(connection), READ_ONLY_TRANSACTION, false, work);
  }
}
