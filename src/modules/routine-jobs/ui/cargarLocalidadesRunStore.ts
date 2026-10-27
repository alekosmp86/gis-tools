import type { LocalidadesJobStatusView, LocalidadesStartRequest } from "./clientTypes";
import type { LocalityTableRef } from "../jobs/cargar-localidades/types";
import type { LocalidadesDestination } from "./localidadesDestination";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";

export interface LocalidadesRunTarget extends LocalityTableRef {
  destination: LocalidadesDestination;
}

export interface LocalidadesRunRequest {
  request: LocalidadesStartRequest;
  targets: LocalidadesRunTarget[];
}

export interface CargarLocalidadesRunPlan {
  dryRun: boolean;
  tables: string[];
  targets: LocalidadesRunTarget[];
}

export type CargarLocalidadesRunSnapshot = RunSnapshot<LocalidadesJobStatusView, CargarLocalidadesRunPlan>;

export type CargarLocalidadesRunStore = RunStore<LocalidadesRunRequest, LocalidadesJobStatusView, CargarLocalidadesRunPlan>;

type CargarLocalidadesRunStoreDeps = Omit<
  RunStoreDeps<LocalidadesRunRequest, LocalidadesJobStatusView, CargarLocalidadesRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsCargarLocalidadesRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la carga de localidades.",
  jobFailed: "La carga de localidades terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise las tablas de localidades antes de volver a cargar.`,
};

const planOf = (run: LocalidadesRunRequest): CargarLocalidadesRunPlan => ({
  dryRun: run.request.dryRun,
  tables: run.targets.map((target) => `${target.schema}.${target.table}`),
  targets: run.targets,
});

function createCargarLocalidadesRunStore(deps: CargarLocalidadesRunStoreDeps): CargarLocalidadesRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getCargarLocalidadesRunStore(): CargarLocalidadesRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createCargarLocalidadesRunStore({
      client: {
        start: (run) => client.startLocalidades(run.request),
        readStatus: (jobId) => client.readLocalidadesStatus(jobId),
      },
    });
  });
}
