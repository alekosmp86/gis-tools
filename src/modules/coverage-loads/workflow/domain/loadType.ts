/**
 * The first choice of the workflow: which kind of load is being done. Each type owns its stages;
 * the stage list itself stays flat and the map below says which stage belongs to which type.
 */

import { CoverageStageId } from "./coverageStageId";

export const LoadType = {
  COVERAGE: "COVERAGE",
  FTTH: "FTTH",
} as const;

export type LoadType = (typeof LoadType)[keyof typeof LoadType];

export type StageIdsByLoadType = Readonly<Record<LoadType, ReadonlyArray<string>>>;

export const LOAD_TYPE_LABELS: Readonly<Record<LoadType, string>> = {
  [LoadType.COVERAGE]: "Cobertura (3G, LTE, 5G, NBIOT)",
  [LoadType.FTTH]: "FTTH",
};

/** Stage ids as declared in `coverageStages.ts`; each stage belongs to exactly one type. */
export const LOAD_TYPE_STAGE_IDS: StageIdsByLoadType = {
  [LoadType.COVERAGE]: [CoverageStageId.INDICATORS, CoverageStageId.SHP],
  [LoadType.FTTH]: [CoverageStageId.AVANCE_FTTH],
};

/** The stages of the chosen type, in the order of the map; none while no type is chosen. */
export function stagesForLoadType<Stage extends { readonly id: string }>(
  stages: ReadonlyArray<Stage>,
  stageIdsByLoadType: StageIdsByLoadType,
  loadType: LoadType | null
): Stage[] {
  if (loadType === null) return [];
  return stageIdsByLoadType[loadType].flatMap((stageId) => stages.filter((stage) => stage.id === stageId));
}
