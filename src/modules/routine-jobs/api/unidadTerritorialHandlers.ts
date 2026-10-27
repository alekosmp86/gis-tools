import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { getJobStore, type JobStore } from "../jobs/shared/jobStore";
import { openPgRunSession } from "../jobs/cargar-padrones/services/openPgSession";
import type { RunProgress } from "../jobs/cargar-padrones/types";
import { plannedUnitStepLabels } from "../jobs/unidad-territorial/domain/plannedSteps";
import { runUnidadTerritorial } from "../jobs/unidad-territorial/services/runUnidadTerritorial";
import type { UnitParams, UnitResult } from "../jobs/unidad-territorial/types";
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
import { parseUnidadTerritorialStartRequest } from "./unidadTerritorialRequestParsing";
import { readJsonRecord } from "./requestParsing";

const UNIDAD_TERRITORIAL_NAMESPACE = "unidad-territorial";
const CONFLICT_MESSAGE = "Ya hay una actualización de unidades territoriales en curso para esta tabla.";

export interface UnidadTerritorialHandlerDeps {
  store: JobStore<UnitResult>;
  run(params: UnitParams, onProgress: (progress: RunProgress) => void): Promise<UnitResult>;
  track(task: Promise<void>): void;
}

export interface UnidadTerritorialHandlers {
  readonly startUnidadTerritorial: ModuleEndpointHandler;
  readonly readUnidadTerritorialStatus: ModuleEndpointHandler;
}

const defaultDeps = (): UnidadTerritorialHandlerDeps => ({
  store: getJobStore<UnitResult>(UNIDAD_TERRITORIAL_NAMESPACE),
  run: (params, onProgress) => runUnidadTerritorial(params, { openSession: openPgRunSession, now: Date.now }, onProgress),
  track: (task) => void task,
});

export function createUnidadTerritorialHandlers(
  overrides: Partial<UnidadTerritorialHandlerDeps> = {}
): UnidadTerritorialHandlers {
  const deps: UnidadTerritorialHandlerDeps = { ...defaultDeps(), ...overrides };

  async function startHandler(request: Request): Promise<Response> {
    try {
      const params = parseUnidadTerritorialStartRequest(await readJsonRecord(request));
      deps.store.sweep(JOB_MAX_AGE_MS);
      const job = deps.store.tryStart(
        tableLockKey(params.config, params.targetSchema, params.targetTable),
        params.dryRun,
        plannedUnitStepLabels({ dryRun: params.dryRun })
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
    startUnidadTerritorial: startHandler,
    readUnidadTerritorialStatus: (request) => statusResponse(deps.store, request),
  };
}
