import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import type { DbConfig } from "@/core/types/db";
import { getJobStore, type JobResult, type JobStore } from "../jobs/shared/jobStore";
import { openPgRunSession } from "../jobs/cargar-padrones/services/openPgSession";
import type { RunDeps, RunProgress } from "../jobs/cargar-padrones/types";
import {
  executeJob,
  failure,
  failureResponse,
  HTTP_STATUS,
  jsonResponse,
  JOB_MAX_AGE_MS,
  statusResponse,
} from "./jobHttp";
import { readJsonRecord, type JsonRecord } from "./requestParsing";

export interface StageJobParams {
  config: DbConfig;
  dryRun: boolean;
}

export interface StageJobDeps<Params extends StageJobParams, Result extends JobResult> {
  store: JobStore<Result>;
  run(params: Params, onProgress: (progress: RunProgress) => void): Promise<Result>;
  track(task: Promise<void>): void;
}

export interface StageJobDefinition<Params extends StageJobParams, Result extends JobResult> {
  namespace: string;
  conflictMessage: string;
  parse(body: JsonRecord): Params;
  lockKeysOf(params: Params): string[];
  plannedSteps(params: Params): string[];
  run(params: Params, deps: RunDeps, onProgress: (progress: RunProgress) => void): Promise<Result>;
}

export interface StageJobHandlers {
  readonly start: ModuleEndpointHandler;
  readonly status: ModuleEndpointHandler;
}

export function createStageJobHandlers<Params extends StageJobParams, Result extends JobResult>(
  definition: StageJobDefinition<Params, Result>,
  overrides: Partial<StageJobDeps<Params, Result>> = {}
): StageJobHandlers {
  const deps: StageJobDeps<Params, Result> = {
    store: getJobStore<Result>(definition.namespace),
    run: (params, onProgress) => definition.run(params, { openSession: openPgRunSession, now: Date.now }, onProgress),
    track: (task) => void task,
    ...overrides,
  };

  async function start(request: Request): Promise<Response> {
    try {
      const params = definition.parse(await readJsonRecord(request));
      deps.store.sweep(JOB_MAX_AGE_MS);
      const job = deps.store.tryStart(definition.lockKeysOf(params), params.dryRun, definition.plannedSteps(params));
      if (!job) return failure(HTTP_STATUS.CONFLICT, definition.conflictMessage);
      deps.track(
        executeJob(deps.store, job.jobId, params.config.password ?? "", (onProgress) => deps.run(params, onProgress))
      );
      return jsonResponse({ success: true, jobId: job.jobId });
    } catch (error: unknown) {
      return failureResponse(error);
    }
  }

  return { start, status: (request) => statusResponse(deps.store, request) };
}
