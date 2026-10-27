import type { ClearMode } from "../jobs/cargar-padrones/constants";
import type { ActualizarJobStatusView, ActualizarStartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";

export interface ActualizarPadronRunPlan {
  dryRun: boolean;
  clearMode: ClearMode;
}

export type ActualizarPadronRunSnapshot = RunSnapshot<ActualizarJobStatusView, ActualizarPadronRunPlan>;

export type ActualizarPadronRunStore = RunStore<ActualizarStartRequest, ActualizarJobStatusView, ActualizarPadronRunPlan>;

export type ActualizarPadronRunStoreDeps = Omit<
  RunStoreDeps<ActualizarStartRequest, ActualizarJobStatusView, ActualizarPadronRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsActualizarPadronRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la actualización.",
  jobFailed: "La actualización terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise la tabla de trabajo antes de volver a actualizar.`,
};

const planOf = (request: ActualizarStartRequest): ActualizarPadronRunPlan => ({
  dryRun: request.dryRun,
  clearMode: request.options.clearMode,
});

export function createActualizarPadronRunStore(deps: ActualizarPadronRunStoreDeps): ActualizarPadronRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getActualizarPadronRunStore(): ActualizarPadronRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createActualizarPadronRunStore({
      client: {
        start: (request) => client.startActualizar(request),
        readStatus: (jobId) => client.readActualizarStatus(jobId),
      },
    });
  });
}
