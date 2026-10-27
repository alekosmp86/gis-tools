import type { LocalidadesJobStatusView, LocalidadesStartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";

export interface CargarLocalidadesRunPlan {
  dryRun: boolean;
  tables: string[];
}

export type CargarLocalidadesRunSnapshot = RunSnapshot<LocalidadesJobStatusView, CargarLocalidadesRunPlan>;

export type CargarLocalidadesRunStore = RunStore<LocalidadesStartRequest, LocalidadesJobStatusView, CargarLocalidadesRunPlan>;

type CargarLocalidadesRunStoreDeps = Omit<
  RunStoreDeps<LocalidadesStartRequest, LocalidadesJobStatusView, CargarLocalidadesRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsCargarLocalidadesRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la carga de localidades.",
  jobFailed: "La carga de localidades terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise las tablas de localidades antes de volver a cargar.`,
};

const planOf = (request: LocalidadesStartRequest): CargarLocalidadesRunPlan => ({
  dryRun: request.dryRun,
  tables: request.targets.map((target) => `${target.schema}.${target.table}`),
});

function createCargarLocalidadesRunStore(deps: CargarLocalidadesRunStoreDeps): CargarLocalidadesRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getCargarLocalidadesRunStore(): CargarLocalidadesRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createCargarLocalidadesRunStore({
      client: {
        start: (request) => client.startLocalidades(request),
        readStatus: (jobId) => client.readLocalidadesStatus(jobId),
      },
    });
  });
}
