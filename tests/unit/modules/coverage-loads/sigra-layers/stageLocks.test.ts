import { Cable, Layers } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StageStatus } from "@/modules/coverage-loads/shared/domain/stageContract";
import { LOAD_TYPE_STAGE_IDS, LoadType } from "@/modules/coverage-loads/workflow/domain/loadType";
import {
  createInitialWorkflow,
  WorkflowPhase,
  type WorkflowState,
} from "@/modules/coverage-loads/workflow/domain/workflowState";
import { describeStageLock } from "@/modules/coverage-loads/workflow/ui/stageLocks";

const STAGES = [
  { id: "sigra-layers", label: "Capas SIGRA", Icon: Layers },
  { id: "avance-ftth", label: "Avance FTTH", Icon: Cable },
];

function ftthState(sigra: StageStatus): WorkflowState {
  const base = createInitialWorkflow(LOAD_TYPE_STAGE_IDS);
  return {
    ...base,
    phase: WorkflowPhase.STAGES,
    loadType: LoadType.FTTH,
    stages: { ...base.stages, "sigra-layers": { status: sigra, outcome: null } },
  };
}

describe("describeStageLock", () => {
  it.each([StageStatus.PENDING, StageStatus.BUSY, StageStatus.FAILED, StageStatus.SKIPPED])(
    "should name the unmet prerequisite stage and ask to complete it first while it is %s",
    (status) => {
      // Arrange
      const state = ftthState(status);

      // Act
      const notice = describeStageLock(state, "avance-ftth", STAGES);

      // Assert
      expect(notice).not.toBeNull();
      expect(notice).toContain("Capas SIGRA");
      expect(notice).toMatch(/complet/i);
    }
  );

  it("should return null once the prerequisite is DONE", () => {
    // Arrange
    const state = ftthState(StageStatus.DONE);

    // Act & Assert
    expect(describeStageLock(state, "avance-ftth", STAGES)).toBeNull();
  });

  it("should return null for a stage without prerequisites", () => {
    // Arrange
    const state = ftthState(StageStatus.PENDING);

    // Act & Assert
    expect(describeStageLock(state, "sigra-layers", STAGES)).toBeNull();
  });

  it("should return null while no load type is chosen", () => {
    // Arrange
    const state = createInitialWorkflow(LOAD_TYPE_STAGE_IDS);

    // Act & Assert
    expect(describeStageLock(state, "avance-ftth", STAGES)).toBeNull();
  });

  it("should use the label it is given for the prerequisite", () => {
    // Arrange
    const relabelled = [{ id: "sigra-layers", label: "Etiqueta de prueba", Icon: Layers }, STAGES[1]];

    // Act
    const notice = describeStageLock(ftthState(StageStatus.PENDING), "avance-ftth", relabelled);

    // Assert
    expect(notice).toContain("Etiqueta de prueba");
  });
});
