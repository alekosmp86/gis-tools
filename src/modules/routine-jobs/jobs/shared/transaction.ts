import { buildQualifiedTableLabel, buildRepairSequenceStatement } from "@/core/services/sqlStatements";
import type { DbConfig } from "@/core/types/db";
import { parseSequenceName } from "../actualizar-padron/domain/sequenceReference";
import { sentence } from "../cargar-padrones/domain/warnings";
import type { StepTimer } from "../cargar-padrones/services/runSteps";
import type { RunDeps, RunSession } from "../cargar-padrones/types";

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const REDACTED = "***";

export interface TransactionMessages {
  jobLabel: string;
  untouched: string;
  unverified: string;
}

export interface TransactionOptions {
  dryRun: boolean;
  secret: string | undefined;
  timer: StepTimer;
  steps: { commit: string; rollback: string };
  messages: TransactionMessages;
}

export interface TransactionOutcome<Body> {
  body: Body;
  targetsModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

export interface SequenceRepairTarget {
  schema: string;
  table: string;
  idColumn: string;
  idSequence: string | null;
}

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const scrubSecret = (message: string, secret: string | undefined): string =>
  secret ? message.split(secret).join(REDACTED) : message;

async function rollbackQuietly(session: RunSession): Promise<boolean> {
  try {
    await session.query(ROLLBACK_SQL);
    return true;
  } catch {
    return false;
  }
}

function rollbackFailure(error: unknown, rolledBack: boolean, options: TransactionOptions): Error {
  const reason = sentence(scrubSecret(errorMessageOf(error), options.secret));
  const outcome = rolledBack ? options.messages.untouched : options.messages.unverified;
  return new Error(`No se pudo completar la ${options.messages.jobLabel}: ${reason} ${outcome}`);
}

async function commitTransaction(session: RunSession, secret: string | undefined): Promise<string | undefined> {
  try {
    await session.query(COMMIT_SQL);
    return undefined;
  } catch (error: unknown) {
    return scrubSecret(errorMessageOf(error), secret);
  }
}

export async function runTransaction<Body>(
  session: RunSession,
  options: TransactionOptions,
  work: () => Promise<Body>
): Promise<TransactionOutcome<Body>> {
  await session.query(BEGIN_SQL);
  let body: Body;
  try {
    body = await work();
  } catch (error: unknown) {
    const rolledBack = await rollbackQuietly(session);
    throw rollbackFailure(error, rolledBack, options);
  }
  if (options.dryRun) {
    await options.timer.run(options.steps.rollback, () => session.query(ROLLBACK_SQL));
    return { body, targetsModified: false, outcomeUnknown: false };
  }
  const commitError = await options.timer.run(options.steps.commit, () => commitTransaction(session, options.secret));
  return {
    body,
    targetsModified: commitError === undefined,
    outcomeUnknown: commitError !== undefined,
    commitError,
  };
}

async function openRunSession(config: DbConfig, deps: RunDeps): Promise<RunSession> {
  try {
    return await deps.openSession(config);
  } catch (error: unknown) {
    throw new Error(scrubSecret(`No se pudo abrir la conexión: ${errorMessageOf(error)}`, config.password));
  }
}

function scrubbedFailure(error: unknown, secret: string | undefined): unknown {
  if (!(error instanceof Error) || !secret || !error.message.includes(secret)) return error;
  return new Error(scrubSecret(error.message, secret));
}

export function buildSequenceRepairSql(target: SequenceRepairTarget): string {
  const sequence = parseSequenceName(target.idSequence);
  if (sequence === undefined) {
    const label = buildQualifiedTableLabel(target.schema, target.table);
    throw new Error(`La columna id de ${label} no tiene secuencia: no se pueden asignar ids.`);
  }
  return buildRepairSequenceStatement(
    sequence.schema ?? target.schema,
    sequence.name,
    target.schema,
    target.table,
    [target.idColumn]
  );
}

export async function withRunSession<T>(
  config: DbConfig,
  deps: RunDeps,
  work: (session: RunSession) => Promise<T>
): Promise<T> {
  const session = await openRunSession(config, deps);
  try {
    return await work(session);
  } catch (error: unknown) {
    throw scrubbedFailure(error, config.password);
  } finally {
    await session.close().catch(() => undefined);
  }
}
