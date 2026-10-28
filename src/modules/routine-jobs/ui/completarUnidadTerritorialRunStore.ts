import type { CompletarJobStatusView, CompletarStartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";

export interface CompletarRunPlan {
  dryRun: boolean;
  unitTable: string;
  addressMasterTable: string;
}

export type CompletarRunSnapshot = RunSnapshot<CompletarJobStatusView, CompletarRunPlan>;

export type CompletarRunStore = RunStore<CompletarStartRequest, CompletarJobStatusView, CompletarRunPlan>;

type CompletarRunStoreDeps = Omit<
  RunStoreDeps<CompletarStartRequest, CompletarJobStatusView, CompletarRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsCompletarUnidadTerritorialRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la creación de direcciones maestras de unidades territoriales.",
  jobFailed: "La creación de direcciones maestras de unidades territoriales terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise las tablas de unidades territoriales y de direcciones maestras antes de volver a cargar.`,
};

const planOf = (request: CompletarStartRequest): CompletarRunPlan => ({
  dryRun: request.dryRun,
  unitTable: `${request.unitSchema}.${request.unitTable}`,
  addressMasterTable: `${request.addressMasterSchema}.${request.addressMasterTable}`,
});

function createCompletarRunStore(deps: CompletarRunStoreDeps): CompletarRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getCompletarRunStore(): CompletarRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createCompletarRunStore({
      client: {
        start: (request) => client.startCompletar(request),
        readStatus: (jobId) => client.readCompletarStatus(jobId),
      },
    });
  });
}
