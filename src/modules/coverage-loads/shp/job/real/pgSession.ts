import type { Writable } from "node:stream";
import * as copyStreams from "pg-copy-streams";
import { cancelBackend } from "../pg/cancelStatement.ts";
import { createJobClient, defaultClientFactory } from "../pg/createClient.ts";
import type { JobPgClient, JobPgClientFactory } from "../pg/createClient.ts";
import type { JobDbConnection, LogLevel } from "../types.ts";
import {
  BACKEND_PID_STATEMENT,
  BEGIN_STATEMENT,
  COMMIT_STATEMENT,
  ROLLBACK_STATEMENT,
  setConfigStatement,
} from "./realQueries.ts";
import type { Statement } from "./realQueries.ts";

export type Row = Record<string, unknown>;
export type CopyInFactory = (client: JobPgClient, sql: string) => Writable;

interface SubmittableClient {
  query(submittable: unknown): Writable;
}

/** `pg` accepts a `pg-copy-streams` object as a query and hands the same object back. */
export function startCopyIn(client: JobPgClient, sql: string): Writable {
  return (client as unknown as SubmittableClient).query(copyStreams.from(sql));
}

export interface PgSessionDeps {
  clientFactory?: JobPgClientFactory;
  copyIn?: CopyInFactory;
}

export interface PgSession {
  readonly backendPid: number;
  rows(statement: Statement): Promise<Row[]>;
  first(statement: Statement): Promise<Row>;
  copyIn(sql: string): Writable;
  setStatementTimeout(ms: number): Promise<void>;
  /** Runs `work` between BEGIN and COMMIT; any throw rolls back (a failed rollback never masks the cause). */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /** Cancels the statement the work connection is running, from a short second connection. */
  cancelRunning(connection: JobDbConnection): Promise<boolean>;
  close(): Promise<void>;
}

export async function openPgSession(
  connection: JobDbConnection,
  log: (level: LogLevel, message: string) => void,
  deps: PgSessionDeps = {}
): Promise<PgSession> {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;
  const copyIn = deps.copyIn ?? startCopyIn;
  const client = await createJobClient(connection, log, clientFactory);

  const rows = async (statement: Statement): Promise<Row[]> => {
    const result = await client.query(statement.text, [...statement.values]);
    return result.rows as Row[];
  };
  const first = async (statement: Statement): Promise<Row> => (await rows(statement))[0] ?? {};
  const pidRow = await first(BACKEND_PID_STATEMENT);
  const backendPid = Number(pidRow.pid);

  return {
    backendPid,
    rows,
    first,
    copyIn: (sql) => copyIn(client, sql),
    async setStatementTimeout(ms) {
      await rows(setConfigStatement("statement_timeout", String(ms), false));
    },
    async transaction(work) {
      await rows(BEGIN_STATEMENT);
      try {
        const result = await work();
        await rows(COMMIT_STATEMENT);
        return result;
      } catch (error) {
        await rows(ROLLBACK_STATEMENT).catch(() => undefined);
        throw error;
      }
    },
    cancelRunning: (target) => cancelBackend(target, backendPid, clientFactory),
    close: () => client.end().catch(() => undefined),
  };
}

export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
