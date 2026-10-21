import { unmetPrerequisites, type WorkflowState } from "../domain/workflowState";
import type { CoverageStage } from "./coverageStages";

type LabelledStage = Pick<CoverageStage, "id" | "label">;

/** Why a stage is locked, naming the stages to complete first; `null` when it is not locked. */
export function describeStageLock(
  state: WorkflowState,
  stageId: string,
  stages: ReadonlyArray<LabelledStage>
): string | null {
  const unmet = unmetPrerequisites(state, stageId);
  if (unmet.length === 0) return null;
  const labels = unmet.map((prerequisiteId) => stages.find((stage) => stage.id === prerequisiteId)?.label ?? prerequisiteId);
  return `Complete primero ${labels.join(", ")} para habilitar este paso.`;
}
