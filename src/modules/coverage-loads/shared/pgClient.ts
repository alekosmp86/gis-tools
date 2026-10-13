import { Client } from "pg";
import { CONNECTION_TIMEOUT_MS } from "../constants";
import type { DbConnection } from "../types";

/** The slice of a driver the module's queries need; `pg.Client` and PGlite both satisfy it. */
export interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }>;
}

/** What the repository needs from a `pg` client; also what a test fake implements. */
export interface PgClientLike extends Queryable {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type PgClientFactory = (connection: DbConnection) => PgClientLike;

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
