import pg from "pg";
import {
  PG_APPLICATION_NAME,
  PG_CONNECTION_TIMEOUT_MS,
  PG_KEEPALIVE_INITIAL_DELAY_MS,
  PG_TCP_KEEPALIVES_COUNT,
  PG_TCP_KEEPALIVES_IDLE_S,
  PG_TCP_KEEPALIVES_INTERVAL_S,
} from "../constants.ts";
import { LOG_LEVEL } from "../types.ts";
import type { JobDbConnection, LogLevel } from "../types.ts";

/** The slice of `pg.Client` the job uses; also what a test fake implements. */
export interface JobPgClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type JobPgClientFactory = (connection: JobDbConnection) => JobPgClient;
export type PgLogFn = (level: LogLevel, message: string) => void;

export function defaultClientFactory(connection: JobDbConnection): JobPgClient {
  return new pg.Client({
    host: connection.host,
    port: connection.port,
    database: connection.db_name,
    user: connection.user,
    password: connection.password,
    application_name: PG_APPLICATION_NAME,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: PG_KEEPALIVE_INITIAL_DELAY_MS,
  }) as unknown as JobPgClient;
}

const KEEPALIVE_SETTINGS = [
  `SET tcp_keepalives_idle = ${PG_TCP_KEEPALIVES_IDLE_S}`,
  `SET tcp_keepalives_interval = ${PG_TCP_KEEPALIVES_INTERVAL_S}`,
  `SET tcp_keepalives_count = ${PG_TCP_KEEPALIVES_COUNT}`,
] as const;

async function applyKeepaliveSettings(client: JobPgClient, log: PgLogFn): Promise<void> {
  for (const setting of KEEPALIVE_SETTINGS) {
    try {
      await client.query(setting);
    } catch {
      log(LOG_LEVEL.WARN, "El servidor rechazó un ajuste de keepalive de sesión; se continúa sin él.");
    }
  }
}

/**
 * Opens the long-lived work connection: keepalive on, no statement timeout, and an `error`
 * listener so a dropped connection can never become an uncaught exception (the pending query
 * rejects instead).
 */
export async function createJobClient(
  connection: JobDbConnection,
  log: PgLogFn,
  factory: JobPgClientFactory = defaultClientFactory
): Promise<JobPgClient> {
  const client = factory(connection);
  client.on("error", () => log(LOG_LEVEL.WARN, "La conexión a la base de datos informó un error."));
  await client.connect();
  await client.query("SET statement_timeout = 0");
  await applyKeepaliveSettings(client, log);
  return client;
}
