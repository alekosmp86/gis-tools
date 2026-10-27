import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { plannedStepLabels } from "../jobs/actualizar-padron/domain/plannedSteps";
import { runActualizarPadron } from "../jobs/actualizar-padron/services/runActualizarPadron";
import type { ActualizarPadronParams, ActualizarPadronResult, RunProgress } from "../jobs/actualizar-padron/types";
import { getJobStore, type JobStore } from "../jobs/shared/jobStore";
import { openPgRunSession } from "../jobs/cargar-padrones/services/openPgSession";
import { parseActualizarStartRequest } from "./actualizarRequestParsing";
import { executeJob, failure, failureResponse, HTTP_STATUS, jsonResponse, JOB_MAX_AGE_MS, statusResponse, tableLockKey } from "./jobHttp";
import { readJsonRecord } from "./requestParsing";

const ACTUALIZAR_NAMESPACE = "actualizar-padron";
const CONFLICT_MESSAGE = "Ya hay una actualización en curso para esta tabla.";

export interface ActualizarPadronHandlerDeps {
  store: JobStore<ActualizarPadronResult>;
  run(params: ActualizarPadronParams, onProgress: (progress: RunProgress) => void): Promise<ActualizarPadronResult>;
  track(task: Promise<void>): void;
}

export interface ActualizarPadronHandlers {
  readonly startActualizarPadron: ModuleEndpointHandler;
  readonly readActualizarPadronStatus: ModuleEndpointHandler;
}

const defaultDeps = (): ActualizarPadronHandlerDeps => ({
  store: getJobStore<ActualizarPadronResult>(ACTUALIZAR_NAMESPACE),
  run: (params, onProgress) =>
    runActualizarPadron(params, { openSession: openPgRunSession, now: Date.now }, onProgress),
  track: (task) => void task,
});

export function createActualizarPadronHandlers(
  overrides: Partial<ActualizarPadronHandlerDeps> = {}
): ActualizarPadronHandlers {
  const deps: ActualizarPadronHandlerDeps = { ...defaultDeps(), ...overrides };

  async function startHandler(request: Request): Promise<Response> {
    try {
      const params = parseActualizarStartRequest(await readJsonRecord(request));
      deps.store.sweep(JOB_MAX_AGE_MS);
      const job = deps.store.tryStart(
        tableLockKey(params.config, params.workSchema, params.workTable),
        params.dryRun,
        plannedStepLabels({ dryRun: params.dryRun, clearMode: params.options.clearMode })
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
    startActualizarPadron: startHandler,
    readActualizarPadronStatus: (request) => statusResponse(deps.store, request),
  };
}
