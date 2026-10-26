import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { listTables, resolveColumns } from "@/core/services/server/tableCatalog/tableCatalog";
import {
  getCargarPadronesJobStore,
  type CargarPadronesJobStore,
  type JobSnapshot,
} from "../jobs/cargar-padrones/services/jobStore";
import { openPgRunSession, type PgRunConnection } from "../jobs/cargar-padrones/services/openPgSession";
import { runCargarPadrones } from "../jobs/cargar-padrones/services/runCargarPadrones";
import type {
  CargarPadronesParams,
  CargarPadronesResult,
  RunProgress,
  RunSession,
} from "../jobs/cargar-padrones/types";
import {
  parseCatalogRequest,
  parseColumnsRequest,
  parseStartRequest,
  parseStatusJobId,
  readJsonRecord,
  RequestInvalidError,
} from "./requestParsing";

export interface RoutineJobsHandlerDeps {
  store: CargarPadronesJobStore;
  run(params: CargarPadronesParams, onProgress: (progress: RunProgress) => void): Promise<CargarPadronesResult>;
  track(task: Promise<void>): void;
  openCatalogSession(connection: PgRunConnection): Promise<RunSession>;
}

export interface RoutineJobsHandlers {
  readonly listTables: ModuleEndpointHandler;
  readonly listColumns: ModuleEndpointHandler;
  readonly startCargarPadrones: ModuleEndpointHandler;
  readonly readCargarPadronesStatus: ModuleEndpointHandler;
}

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const JOB_MAX_AGE_MS = HOUR_MS;
const REDACTION = "***";
const INTERNAL_ERROR_MESSAGE = "Error interno al procesar la solicitud.";
const CONFLICT_MESSAGE = "Ya hay una carga en curso para esta tabla.";
const JOB_NOT_FOUND_MESSAGE = "No existe un trabajo con ese identificador.";

const jsonResponse = (body: object, status: number = HTTP_STATUS.OK): Response => Response.json(body, { status });

const failure = (status: number, message: string): Response => jsonResponse({ success: false, error: message }, status);

function failureResponse(error: unknown): Response {
  if (error instanceof RequestInvalidError) return failure(HTTP_STATUS.BAD_REQUEST, error.message);
  return failure(HTTP_STATUS.SERVER_ERROR, INTERNAL_ERROR_MESSAGE);
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const scrubText = (text: string, secret: string): string => (secret ? text.split(secret).join(REDACTION) : text);

function scrubDeep<T>(value: T, secret: string): T {
  if (!secret) return value;
  if (typeof value === "string") return scrubText(value, secret) as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => scrubDeep(entry, secret)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]: [string, unknown]) => [key, scrubDeep(entry, secret)])
    ) as T;
  }
  return value;
}

const tableKeyOf = (params: CargarPadronesParams): string =>
  `${params.config.host.trim().toLowerCase()}:${params.config.port}|${params.config.db_name}|${params.schema}|${params.targetTable}`;

function toStatusView(job: JobSnapshot) {
  return {
    jobId: job.jobId,
    state: job.state,
    step: job.step,
    current: job.current,
    total: job.total,
    dryRun: job.dryRun,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
    outcomeUnknown: job.outcomeUnknown,
  };
}

async function closeQuietly(session: RunSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // The session closes without throwing; a failing close must not mask the answer.
  }
}

async function withCatalogSession<T>(
  deps: RoutineJobsHandlerDeps,
  connection: PgRunConnection,
  work: (session: RunSession) => Promise<T>
): Promise<T> {
  const session = await deps.openCatalogSession(connection);
  try {
    return await work(session);
  } finally {
    await closeQuietly(session);
  }
}

async function executeJob(deps: RoutineJobsHandlerDeps, params: CargarPadronesParams, jobId: string): Promise<void> {
  const secret = params.config.password ?? "";
  const onProgress = (progress: RunProgress): void => {
    try {
      deps.store.progress(jobId, { ...progress, label: scrubText(progress.label, secret) });
    } catch {
      // A progress write never fails the run.
    }
  };
  try {
    const result = await deps.run(params, onProgress);
    deps.store.finish(jobId, scrubDeep(result, secret));
  } catch (error: unknown) {
    deps.store.fail(jobId, scrubText(messageOf(error), secret));
  }
}

const defaultDeps = (): RoutineJobsHandlerDeps => ({
  store: getCargarPadronesJobStore(),
  run: (params, onProgress) =>
    runCargarPadrones(params, { openSession: openPgRunSession, now: Date.now }, onProgress),
  track: (task) => void task,
  openCatalogSession: (connection) => openPgRunSession(connection),
});

export function createRoutineJobsHandlers(overrides: Partial<RoutineJobsHandlerDeps> = {}): RoutineJobsHandlers {
  const deps: RoutineJobsHandlerDeps = { ...defaultDeps(), ...overrides };

  async function listTablesHandler(request: Request): Promise<Response> {
    try {
      const { connection, schema } = parseCatalogRequest(await readJsonRecord(request));
      const listing = await withCatalogSession(deps, connection, (session) => listTables(session, schema));
      return jsonResponse({ success: true, ...listing });
    } catch (error: unknown) {
      return failureResponse(error);
    }
  }

  async function listColumnsHandler(request: Request): Promise<Response> {
    try {
      const { connection, schema, table, required } = parseColumnsRequest(await readJsonRecord(request));
      const columns = await withCatalogSession(deps, connection, (session) =>
        resolveColumns(session, schema, table, required)
      );
      return jsonResponse({ success: true, columns });
    } catch (error: unknown) {
      return failureResponse(error);
    }
  }

  async function startHandler(request: Request): Promise<Response> {
    try {
      const params = parseStartRequest(await readJsonRecord(request));
      deps.store.sweep(JOB_MAX_AGE_MS);
      const job = deps.store.tryStart(tableKeyOf(params), params.dryRun);
      if (!job) return failure(HTTP_STATUS.CONFLICT, CONFLICT_MESSAGE);
      deps.track(executeJob(deps, params, job.jobId));
      return jsonResponse({ success: true, jobId: job.jobId });
    } catch (error: unknown) {
      return failureResponse(error);
    }
  }

  function statusHandler(request: Request): Response {
    try {
      const jobId = parseStatusJobId(new URL(request.url).searchParams);
      deps.store.sweep(JOB_MAX_AGE_MS);
      const job = deps.store.get(jobId);
      if (!job) return failure(HTTP_STATUS.NOT_FOUND, JOB_NOT_FOUND_MESSAGE);
      return jsonResponse({ success: true, job: toStatusView(job) });
    } catch (error: unknown) {
      return failureResponse(error);
    }
  }

  return {
    listTables: listTablesHandler,
    listColumns: listColumnsHandler,
    startCargarPadrones: startHandler,
    readCargarPadronesStatus: statusHandler,
  };
}
