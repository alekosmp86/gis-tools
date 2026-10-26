import {
  connectErrorMessage,
  defaultCreateClient,
  ignoreIdleClientError,
  SESSION_SETUP_STATEMENTS,
  type PgClientLike,
  type PgShpConfig,
} from "@/core/services/server/shpReplace/pgShpSession";
import type { RunSession } from "../types";

export interface PgRunConnection {
  host: string;
  port: string | number;
  db_name: string;
  user: string;
  password?: string;
}

export interface OpenPgRunSessionDeps {
  createClient?: (config: PgShpConfig) => PgClientLike;
}

interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

const REDACTION = "***";

const scrubSecret = (text: string, secret: string): string => (secret ? text.split(secret).join(REDACTION) : text);

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const toPgConfig = (connection: PgRunConnection): PgShpConfig => ({
  host: connection.host,
  port: Number(connection.port),
  db_name: connection.db_name,
  user: connection.user,
  password: connection.password ?? "",
});

async function endQuietly(client: PgClientLike): Promise<void> {
  try {
    await client.end();
  } catch {
    // A client that fails to end has nothing left to release; closing never throws.
  }
}

async function connectOrFail(client: PgClientLike, config: PgShpConfig): Promise<void> {
  try {
    await client.connect();
  } catch {
    await endQuietly(client);
    throw new Error(connectErrorMessage(config));
  }
}

async function applySetupOrFail(client: PgClientLike, secret: string): Promise<void> {
  try {
    for (const statement of SESSION_SETUP_STATEMENTS) {
      await client.query(statement);
    }
  } catch (error: unknown) {
    await endQuietly(client);
    throw new Error(`No se pudo preparar la sesión de PostgreSQL: ${scrubSecret(errorMessageOf(error), secret)}`);
  }
}

export async function openPgRunSession(
  connection: PgRunConnection,
  deps: OpenPgRunSessionDeps = {}
): Promise<RunSession> {
  const config = toPgConfig(connection);
  const secret = config.password;
  const client = (deps.createClient ?? defaultCreateClient)(config);
  client.on("error", ignoreIdleClientError);
  await connectOrFail(client, config);
  await applySetupOrFail(client, secret);
  let closing: Promise<void> | undefined;

  return {
    async query(sql, values) {
      const result = (await client.query(sql, values ? [...values] : undefined)) as PgQueryResult;
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
    close() {
      closing ??= endQuietly(client);
      return closing;
    },
  };
}
