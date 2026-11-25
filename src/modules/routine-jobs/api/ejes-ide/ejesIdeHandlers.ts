import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { EJES_TABLE_ROLE } from "../../jobs/ejes-ide/constants";
import { plannedEjesStepLabels } from "../../jobs/ejes-ide/domain/plannedSteps";
import { runEjesIde } from "../../jobs/ejes-ide/services/runEjesIde";
import type { EjesParams, EjesResult } from "../../jobs/ejes-ide/types";
import { getJobStore } from "../../jobs/shared/jobStore";
import { tableLockKey } from "../jobHttp";
import { parseEjesIdeStartRequest } from "./ejesIdeRequestParsing";
import { EJES_IDE_JOB_NAMESPACE, getEjesReviewStore, withReviewRetention } from "./ejesReviewStore";
import { createStageJobHandlers, type StageJobDeps } from "../stageJobHandlers";

export type EjesIdeHandlerDeps = StageJobDeps<EjesParams, EjesResult>;

export interface EjesIdeHandlers {
  readonly startEjesIde: ModuleEndpointHandler;
  readonly readEjesIdeStatus: ModuleEndpointHandler;
}

const lockKeysOfEjes = (params: EjesParams): string[] => {
  const target = params.tables[EJES_TABLE_ROLE.ROAD_SECTION];
  return [tableLockKey(params.config, target.schema, target.table)];
};

export function createEjesIdeHandlers(overrides: Partial<EjesIdeHandlerDeps> = {}): EjesIdeHandlers {
  const store = withReviewRetention(getJobStore<EjesResult>(EJES_IDE_JOB_NAMESPACE), getEjesReviewStore());
  const { start, status } = createStageJobHandlers<EjesParams, EjesResult>(
    {
      namespace: EJES_IDE_JOB_NAMESPACE,
      conflictMessage: "Ya hay un trabajo de ejes de calles en curso para esta tabla.",
      parse: parseEjesIdeStartRequest,
      lockKeysOf: lockKeysOfEjes,
      plannedSteps: (params) => plannedEjesStepLabels(params.dryRun),
      run: runEjesIde,
    },
    { store, ...overrides }
  );
  return { startEjesIde: start, readEjesIdeStatus: status };
}
