import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { listTables, resolveColumns } from "@/core/services/server/tableCatalog/tableCatalog";
import { getCargarPadronesJobStore, type CargarPadronesJobStore } from "../jobs/cargar-padrones/services/jobStore";
import { plannedStepLabels } from "../jobs/cargar-padrones/domain/plannedSteps";
import { openPgRunSession, type PgRunConnection } from "../jobs/cargar-padrones/services/openPgSession";
import { runCargarPadrones } from "../jobs/cargar-padrones/services/runCargarPadrones";
import type {
  CargarPadronesParams,
  CargarPadronesResult,
  RunProgress,
  RunSession,
} from "../jobs/cargar-padrones/types";
import {
  executeJob,
  failure,
  failureResponse,
  HTTP_STATUS,
  jsonResponse,
  JOB_MAX_AGE_MS,
  statusResponse,
  tableLockKey,
} from "./jobHttp";
import {
  parseCatalogRequest,
  parseColumnsRequest,
  parseStartRequest,
  readJsonRecord,
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

const CONFLICT_MESSAGE = "Ya hay una carga en curso para esta tabla.";

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
      const job = deps.store.tryStart(
        tableLockKey(params.config, params.schema, params.targetTable),
        params.dryRun,
        plannedStepLabels(params)
      );
      if (!job) return failure(HTTP_STATUS.CONFLICT, CONFLICT_MESSAGE);
      deps.track(
        executeJob(deps.store, job.jobId, params.config.password ?? "", (onProgress) => deps.run(params, onProgress))
      );
      return jsonResponse({ success: true, jobId: job.jobId });
    } catch (error: unknown) {
      return failureResponse(error);
    }
  }

  return {
    listTables: listTablesHandler,
    listColumns: listColumnsHandler,
    startCargarPadrones: startHandler,
    readCargarPadronesStatus: (request) => statusResponse(deps.store, request),
  };
}
