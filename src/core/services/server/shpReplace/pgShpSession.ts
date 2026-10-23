import type { Writable } from "node:stream";
import { Client } from "pg";
import * as copyStreams from "pg-copy-streams";
import type { ShpQueryResult, ShpReplaceSession } from "@/core/services/server/shpReplace/shpReplaceTypes";

export interface PgShpConfig {
  host: string;
  port: number;
  db_name: string;
  user: string;
  password: string;
}

export interface PgClientLike {
  connect(): Promise<void>;
  query(arg: unknown, values?: unknown[]): unknown;
  end(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export type CopyStream = Writable & { rowCount?: number };

export interface PgShpSessionDeps {
  createClient?: (config: PgShpConfig) => PgClientLike;
  createCopyStream?: (sql: string) => CopyStream;
}

const SESSION_SETUP_STATEMENTS = [
  "SET statement_timeout = '4h'",
  "SET lock_timeout = '30s'",
  "SET client_encoding = 'UTF8'",
  "SET work_mem = '128MB'",
  "SET maintenance_work_mem = '256MB'",
] as const;
const CLIENT_CONNECT_TIMEOUT_MS = 10_000;

const defaultCreateClient = (config: PgShpConfig): PgClientLike =>
  new Client({
    host: config.host,
    port: config.port,
    database: config.db_name,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: CLIENT_CONNECT_TIMEOUT_MS,
  }) as unknown as PgClientLike;

const connectErrorMessage = (config: PgShpConfig): string =>
  `No se pudo conectar a PostgreSQL en ${config.host}:${config.port} (base "${config.db_name}"). Revise los datos de conexión.`;

interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

const toQueryResult = (result: PgQueryResult): ShpQueryResult => ({
  rows: result.rows,
  rowCount: result.rowCount ?? 0,
});

const ignoreIdleClientError = (): void => undefined;

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

function pumpLines(stream: CopyStream, lines: Iterable<string>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const iterator = lines[Symbol.iterator]();
    const pump = (): void => {
      try {
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
          if (!stream.write(next.value)) {
            stream.once("drain", pump);
            return;
          }
        }
        stream.end();
      } catch (error) {
        const failure = asError(error);
        stream.destroy(failure);
        reject(failure);
      }
    };
    stream.on("error", reject);
    stream.once("finish", () => resolve());
    pump();
  });
}

async function copyLines(stream: CopyStream, lines: Iterable<string>): Promise<number> {
  await pumpLines(stream, lines);
  return stream.rowCount ?? 0;
}

async function connectOrFail(client: PgClientLike, config: PgShpConfig): Promise<void> {
  try {
    await client.connect();
  } catch {
    throw new Error(connectErrorMessage(config));
  }
}

export async function openPgShpSession(
  config: PgShpConfig,
  deps: PgShpSessionDeps = {}
): Promise<ShpReplaceSession> {
  const client = (deps.createClient ?? defaultCreateClient)(config);
  client.on("error", ignoreIdleClientError);
  await connectOrFail(client, config);
  const createCopyStream =
    deps.createCopyStream ?? ((sql: string): CopyStream => client.query(copyStreams.from(sql)) as CopyStream);
  for (const statement of SESSION_SETUP_STATEMENTS) {
    await client.query(statement);
  }
  let closing: Promise<void> | undefined;

  return {
    async query(sql, values) {
      const result = (await client.query(sql, values ? [...values] : undefined)) as PgQueryResult;
      return toQueryResult(result);
    },
    copyIn(sql, lines) {
      return copyLines(createCopyStream(sql), lines);
    },
    close() {
      closing ??= client.end().catch(() => undefined);
      return closing;
    },
  };
}
