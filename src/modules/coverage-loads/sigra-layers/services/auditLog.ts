import { AuditState } from "../constants";
import type { PgClientFactory, PgClientLike } from "../../shared/pgClient";
import type { DbConnection } from "../../types";
import { LayerLoadStatus, type AuditHandle, type LoadOutcome, type LoadProgress } from "../types";
import { AUDIT_FINISH_SQL, AUDIT_START_SQL } from "./queries/auditQueries";
import { firstRow } from "./queries/queryRows";

export interface AuditClosing {
  readonly outcome: LoadOutcome;
  readonly progress: LoadProgress;
}

const NO_AUDIT: AuditHandle = { id: null, warning: null };

/** Each audit statement runs on its own connection in autocommit, so it never joins the load transaction. */
async function onOwnConnection<TResult>(
  createClient: PgClientFactory,
  connection: DbConnection,
  work: (client: PgClientLike) => Promise<TResult>,
): Promise<TResult> {
  const client = createClient(connection);
  client.on("error", () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const skippedAudit = (): AuditHandle => NO_AUDIT;

export async function startAudit(
  createClient: PgClientFactory,
  connection: DbConnection,
  etlName: string,
  describeFailure: (error: unknown) => string,
): Promise<AuditHandle> {
  try {
    const id = await onOwnConnection(createClient, connection, async (client) =>
      Number((await firstRow(client, AUDIT_START_SQL, [etlName, AuditState.STARTED])).id_auditoria),
    );
    return { id, warning: null };
  } catch (error) {
    const warning = `No se pudo registrar el inicio en la auditoría; la carga continúa sin auditoría: ${describeFailure(error)}`;
    return { id: null, warning };
  }
}

function closingValues(closing: AuditClosing, auditId: number): unknown[] {
  const { outcome, progress } = closing;
  if (outcome.status === LayerLoadStatus.LOADED) {
    return [AuditState.SUCCESS, progress.staged, progress.staged, null, null, null, auditId];
  }
  return [AuditState.ERROR, null, null, outcome.step, outcome.message, outcome.step, auditId];
}

/** Returns the warning to show, or null when the audit row was closed (or no audit applies). */
export async function finishAudit(
  createClient: PgClientFactory,
  connection: DbConnection,
  audit: AuditHandle,
  closing: AuditClosing,
  describeFailure: (error: unknown) => string,
): Promise<string | null> {
  if (audit.id === null) return audit.warning;
  const auditId = audit.id;
  try {
    await onOwnConnection(createClient, connection, (client) =>
      client.query(AUDIT_FINISH_SQL, closingValues(closing, auditId)),
    );
    return null;
  } catch (error) {
    return `No se pudo actualizar el registro de auditoría: ${describeFailure(error)}`;
  }
}
