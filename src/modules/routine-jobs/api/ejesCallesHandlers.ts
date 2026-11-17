import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { EJES_TABLE_ROLE } from "../jobs/ejes-calles/constants";
import { plannedEjesStepLabels } from "../jobs/ejes-calles/domain/plannedSteps";
import { runEjesCalles } from "../jobs/ejes-calles/services/runEjesCalles";
import type { EjesParams, EjesResult } from "../jobs/ejes-calles/types";
import { getJobStore } from "../jobs/shared/jobStore";
import { tableLockKey } from "./jobHttp";
import { parseEjesCallesStartRequest } from "./ejesCallesRequestParsing";
import { EJES_CALLES_JOB_NAMESPACE, getEjesReviewStore, withReviewRetention } from "./ejesReviewStore";
import { createStageJobHandlers, type StageJobDeps } from "./stageJobHandlers";

export type EjesCallesHandlerDeps = StageJobDeps<EjesParams, EjesResult>;

export interface EjesCallesHandlers {
  readonly startEjesCalles: ModuleEndpointHandler;
  readonly readEjesCallesStatus: ModuleEndpointHandler;
}

const lockKeysOfEjes = (params: EjesParams): string[] => {
  const target = params.tables[EJES_TABLE_ROLE.ROAD_SECTION];
  return [tableLockKey(params.config, target.schema, target.table)];
};

export function createEjesCallesHandlers(overrides: Partial<EjesCallesHandlerDeps> = {}): EjesCallesHandlers {
  const store = withReviewRetention(getJobStore<EjesResult>(EJES_CALLES_JOB_NAMESPACE), getEjesReviewStore());
  const { start, status } = createStageJobHandlers<EjesParams, EjesResult>(
    {
      namespace: EJES_CALLES_JOB_NAMESPACE,
      conflictMessage: "Ya hay un trabajo de ejes de calles en curso para esta tabla.",
      parse: parseEjesCallesStartRequest,
      lockKeysOf: lockKeysOfEjes,
      plannedSteps: (params) => plannedEjesStepLabels(params.dryRun),
      run: runEjesCalles,
    },
    { store, ...overrides }
  );
  return { startEjesCalles: start, readEjesCallesStatus: status };
}
