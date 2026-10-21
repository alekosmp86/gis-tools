import { CoverageStageId } from "./coverageStageId";

/** Stages that stay locked until every listed stage is DONE. */
export const STAGE_PREREQUISITES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [CoverageStageId.AVANCE_FTTH]: [CoverageStageId.SIGRA_LAYERS],
};

/** Stages that cannot be skipped: other stages depend on them. */
export const MANDATORY_STAGE_IDS: ReadonlyArray<string> = [CoverageStageId.SIGRA_LAYERS];
