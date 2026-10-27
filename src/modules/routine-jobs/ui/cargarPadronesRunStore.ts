import type { JobStatusView, StartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  RunPhase,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";

export const CargarPadronesRunPhase = RunPhase;

export type CargarPadronesRunPlan = Pick<StartRequest, "dryRun" | "options">;

export type CargarPadronesRunSnapshot = RunSnapshot<JobStatusView, CargarPadronesRunPlan>;

export type CargarPadronesRunStore = RunStore<StartRequest, JobStatusView, CargarPadronesRunPlan>;

export type CargarPadronesRunStoreDeps = Omit<
  RunStoreDeps<StartRequest, JobStatusView, CargarPadronesRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsCargarPadronesRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la carga.",
  jobFailed: "La carga terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise la tabla destino antes de volver a cargar.`,
};

const planOf = (request: StartRequest): CargarPadronesRunPlan => ({ dryRun: request.dryRun, options: request.options });

export function createCargarPadronesRunStore(deps: CargarPadronesRunStoreDeps): CargarPadronesRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getCargarPadronesRunStore(): CargarPadronesRunStore {
  return sharedRunStore(GLOBAL_KEY, () => createCargarPadronesRunStore({ client: createRoutineJobsClient() }));
}
