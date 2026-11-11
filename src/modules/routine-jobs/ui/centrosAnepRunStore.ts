import { CENTROS_TABLE_ROLE } from "../jobs/centros-anep/constants";
import { centrosAnepAnalysisKeyOf } from "./centrosAnepAnalysisKey";
import type { CentrosAnepJobStatusView, CentrosAnepStartRequest } from "./clientTypes";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";
import { createRoutineJobsClient } from "./routineJobsClient";

export interface CentrosAnepRunPlan {
  dryRun: boolean;
  centrosStaging: string;
  analysisKey: string;
}

export type CentrosAnepRunSnapshot = RunSnapshot<CentrosAnepJobStatusView, CentrosAnepRunPlan>;

export type CentrosAnepRunStore = RunStore<CentrosAnepStartRequest, CentrosAnepJobStatusView, CentrosAnepRunPlan>;

type CentrosAnepRunStoreDeps = Omit<
  RunStoreDeps<CentrosAnepStartRequest, CentrosAnepJobStatusView, CentrosAnepRunPlan>,
  "planOf" | "messages"
>;

const GLOBAL_KEY = "__gisToolsCentrosAnepRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar la carga de centros ANEP.",
  jobFailed: "La carga de centros ANEP terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise la tabla final de centros ANEP antes de volver a cargar.`,
};

const planOf = (request: CentrosAnepStartRequest): CentrosAnepRunPlan => ({
  dryRun: request.dryRun,
  centrosStaging: `${request.tables[CENTROS_TABLE_ROLE.STAGING].schema}.${request.tables[CENTROS_TABLE_ROLE.STAGING].table}`,
  analysisKey: centrosAnepAnalysisKeyOf(request),
});

export function createCentrosAnepRunStore(deps: CentrosAnepRunStoreDeps): CentrosAnepRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getCentrosAnepRunStore(): CentrosAnepRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createCentrosAnepRunStore({
      client: {
        start: (request) => client.startCentrosAnep(request),
        readStatus: (jobId) => client.readCentrosAnepStatus(jobId),
      },
    });
  });
}
