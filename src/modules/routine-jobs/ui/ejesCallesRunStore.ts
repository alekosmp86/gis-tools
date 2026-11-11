import type { EjesJobStatusView, EjesStartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import {
  createJobRunStore,
  sharedRunStore,
  type RunMessages,
  type RunSnapshot,
  type RunStore,
  type RunStoreDeps,
} from "./jobRunStore";
import { EJES_TABLE_ROLE } from "../jobs/ejes-calles/constants";
import { ejesAnalysisKeyOf } from "./ejesCallesAnalysisKey";

export interface EjesRunPlan {
  dryRun: boolean;
  ejesStaging: string;
  analysisKey: string;
}

export type EjesRunSnapshot = RunSnapshot<EjesJobStatusView, EjesRunPlan>;

export type EjesRunStore = RunStore<EjesStartRequest, EjesJobStatusView, EjesRunPlan>;

type EjesRunStoreDeps = Omit<RunStoreDeps<EjesStartRequest, EjesJobStatusView, EjesRunPlan>, "planOf" | "messages">;

const GLOBAL_KEY = "__gisToolsEjesCallesRunStore";

const MESSAGES: RunMessages = {
  startFallback: "No se pudo iniciar el trabajo de ejes de calles.",
  jobFailed: "El trabajo de ejes de calles terminó con error en el servidor.",
  unknownOutcome: (jobId) =>
    `No se pudo confirmar el resultado del trabajo ${jobId}. Revise las tablas de ejes de calles antes de volver a cargar.`,
};

const planOf = (request: EjesStartRequest): EjesRunPlan => ({
  dryRun: request.dryRun,
  ejesStaging: `${request.tables[EJES_TABLE_ROLE.STAGING].schema}.${request.tables[EJES_TABLE_ROLE.STAGING].table}`,
  analysisKey: ejesAnalysisKeyOf(request),
});

function createEjesRunStore(deps: EjesRunStoreDeps): EjesRunStore {
  return createJobRunStore({ ...deps, planOf, messages: MESSAGES });
}

export function getEjesRunStore(): EjesRunStore {
  return sharedRunStore(GLOBAL_KEY, () => {
    const client = createRoutineJobsClient();
    return createEjesRunStore({
      client: {
        start: (request) => client.startEjes(request),
        readStatus: (jobId) => client.readEjesStatus(jobId),
      },
    });
  });
}
