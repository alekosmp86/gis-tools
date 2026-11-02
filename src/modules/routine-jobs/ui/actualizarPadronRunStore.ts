import type { AcceptedGeometry, PairChoice } from "../jobs/actualizar-padron/types";
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
  destinationTable: string;
  linkAddressMaster: boolean;
  pairChoices: readonly PairChoice[];
  /** Absent in plans built before the geometry acceptances existed: read as none. */
  acceptedGeometries?: readonly AcceptedGeometry[];
}

export type ActualizarPadronRunSnapshot = RunSnapshot<ActualizarJobStatusView, ActualizarPadronRunPlan>;

export type ActualizarPadronRunStore = RunStore<ActualizarStartRequest, ActualizarJobStatusView, ActualizarPadronRunPlan>;

type ActualizarPadronRunStoreDeps = Omit<
  RunStoreDeps<ActualizarStartRequest, ActualizarJobStatusView, ActualizarPadronRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsActualizarPadronRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la actualización.",
  jobFailed: "La actualización terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise la tabla de destino antes de volver a actualizar.`,
};

const planOf = (request: ActualizarStartRequest): ActualizarPadronRunPlan => ({
  dryRun: request.dryRun,
  destinationTable: request.targetTable,
  linkAddressMaster: request.options.linkAddressMaster,
  pairChoices: request.options.pairChoices ?? [],
  acceptedGeometries: request.options.acceptedGeometries ?? [],
});

function createActualizarPadronRunStore(deps: ActualizarPadronRunStoreDeps): ActualizarPadronRunStore {
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
