import type { UnidadJobStatusView, UnidadStartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";

export interface UnidadRunPlan {
  dryRun: boolean;
  target: string;
}

export type UnidadRunSnapshot = RunSnapshot<UnidadJobStatusView, UnidadRunPlan>;

export type UnidadRunStore = RunStore<UnidadStartRequest, UnidadJobStatusView, UnidadRunPlan>;

type UnidadRunStoreDeps = Omit<RunStoreDeps<UnidadStartRequest, UnidadJobStatusView, UnidadRunPlan>, "planOf" | "messages">;

const GLOBAL_KEY = "__gisToolsUnidadTerritorialRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la actualización de unidades territoriales.",
  jobFailed: "La actualización de unidades territoriales terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise la tabla de unidades territoriales antes de volver a cargar.`,
};

const planOf = (request: UnidadStartRequest): UnidadRunPlan => ({
  dryRun: request.dryRun,
  target: `${request.targetSchema}.${request.targetTable}`,
});

function createUnidadRunStore(deps: UnidadRunStoreDeps): UnidadRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getUnidadRunStore(): UnidadRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createUnidadRunStore({
      client: {
        start: (request) => client.startUnidad(request),
        readStatus: (jobId) => client.readUnidadStatus(jobId),
      },
    });
  });
}
