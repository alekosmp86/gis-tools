import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { getJobStore, type JobStore } from "../jobs/shared/jobStore";
import { openPgRunSession } from "../jobs/cargar-padrones/services/openPgSession";
import { plannedLocalityStepLabels } from "../jobs/cargar-localidades/domain/plannedSteps";
import { targetLabelsOf } from "../jobs/cargar-localidades/domain/tableRoles";
import { runCargarLocalidades } from "../jobs/cargar-localidades/services/runCargarLocalidades";
import type { CargarLocalidadesParams, CargarLocalidadesResult } from "../jobs/cargar-localidades/types";
import type { RunProgress } from "../jobs/cargar-padrones/types";
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
import { parseCargarLocalidadesStartRequest } from "./cargarLocalidadesRequestParsing";
import { readJsonRecord } from "./requestParsing";

const CARGAR_LOCALIDADES_NAMESPACE = "cargar-localidades";
const CONFLICT_MESSAGE = "Ya hay una carga de localidades en curso para esta tabla.";

export interface CargarLocalidadesHandlerDeps {
  store: JobStore<CargarLocalidadesResult>;
  run(params: CargarLocalidadesParams, onProgress: (progress: RunProgress) => void): Promise<CargarLocalidadesResult>;
  track(task: Promise<void>): void;
}

export interface CargarLocalidadesHandlers {
  readonly startCargarLocalidades: ModuleEndpointHandler;
  readonly readCargarLocalidadesStatus: ModuleEndpointHandler;
}

const defaultDeps = (): CargarLocalidadesHandlerDeps => ({
  store: getJobStore<CargarLocalidadesResult>(CARGAR_LOCALIDADES_NAMESPACE),
  run: (params, onProgress) =>
    runCargarLocalidades(params, { openSession: openPgRunSession, now: Date.now }, onProgress),
  track: (task) => void task,
});

export function createCargarLocalidadesHandlers(
  overrides: Partial<CargarLocalidadesHandlerDeps> = {}
): CargarLocalidadesHandlers {
  const deps: CargarLocalidadesHandlerDeps = { ...defaultDeps(), ...overrides };

  async function startHandler(request: Request): Promise<Response> {
    try {
      const params = parseCargarLocalidadesStartRequest(await readJsonRecord(request));
      deps.store.sweep(JOB_MAX_AGE_MS);
      const job = deps.store.tryStart(
        params.targets.map((target) => tableLockKey(params.config, target.schema, target.table)),
        params.dryRun,
        plannedLocalityStepLabels({ dryRun: params.dryRun, tables: targetLabelsOf(params) })
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
    startCargarLocalidades: startHandler,
    readCargarLocalidadesStatus: (request) => statusResponse(deps.store, request),
  };
}
