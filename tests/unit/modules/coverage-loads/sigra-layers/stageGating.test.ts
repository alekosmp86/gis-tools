import { describe, expect, it } from "vitest";
import { StageStatus, type StageOutcome } from "@/modules/coverage-loads/shared/domain/stageContract";
import { CoverageStageId } from "@/modules/coverage-loads/workflow/domain/coverageStageId";
import { LOAD_TYPE_STAGE_IDS, LoadType } from "@/modules/coverage-loads/workflow/domain/loadType";
import {
  MANDATORY_STAGE_IDS,
  STAGE_PREREQUISITES,
} from "@/modules/coverage-loads/workflow/domain/stagePrerequisites";
import {
  canSkipStage,
  createInitialWorkflow,
  isStageLocked,
  WorkflowActionType as Action,
  WorkflowPhase,
  workflowReducer,
  type WorkflowAction,
  type WorkflowState,
} from "@/modules/coverage-loads/workflow/domain/workflowState";

const SIGRA = "sigra-layers";
const AVANCE = "avance-ftth";
const CONNECTION = { host: "db.example", port: "5432", db_name: "carto", user: "operator", password: "secret" };
const OUTCOME: StageOutcome = { headline: "Capas SIGRA actualizadas", lines: ["x"] };
const ALL_STATUSES = Object.values(StageStatus);

function ftthState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    ...createInitialWorkflow(LOAD_TYPE_STAGE_IDS),
    phase: WorkflowPhase.STAGES,
    loadType: LoadType.FTTH,
    connection: CONNECTION,
    confirmedConnection: CONNECTION,
    activeStageId: SIGRA,
    ...overrides,
  };
}

function withStatus(state: WorkflowState, stageId: string, status: StageStatus): WorkflowState {
  return { ...state, stages: { ...state.stages, [stageId]: { status, outcome: null } } };
}

function reduce(start: WorkflowState, ...actions: WorkflowAction[]): WorkflowState {
  return actions.reduce(workflowReducer, start);
}

describe("stage prerequisites (AC-10, AC-11, AC-12)", () => {
  describe("constants", () => {
    it("should make avance-ftth depend on sigra-layers only", () => {
      // Arrange & Act & Assert
      expect(STAGE_PREREQUISITES).toEqual({ [AVANCE]: [SIGRA] });
    });

    it("should mark sigra-layers as the only mandatory stage", () => {
      // Arrange & Act & Assert
      expect(MANDATORY_STAGE_IDS).toEqual([SIGRA]);
    });

    it("should expose the SIGRA stage id and place it before Avance in the FTTH type only", () => {
      // Arrange & Act & Assert
      expect(CoverageStageId.SIGRA_LAYERS).toBe(SIGRA);
      expect(LOAD_TYPE_STAGE_IDS[LoadType.FTTH]).toEqual([SIGRA, AVANCE]);
      expect(LOAD_TYPE_STAGE_IDS[LoadType.COVERAGE]).not.toContain(SIGRA);
    });
  });

  describe("isStageLocked", () => {
    it.each(ALL_STATUSES.filter((status) => status !== StageStatus.DONE))(
      "should lock avance-ftth while sigra-layers is %s",
      (status) => {
        // Arrange
        const state = withStatus(ftthState(), SIGRA, status);

        // Act & Assert
        expect(isStageLocked(state, AVANCE)).toBe(true);
      }
    );

    it("should unlock avance-ftth once sigra-layers is DONE", () => {
      // Arrange
      const state = withStatus(ftthState(), SIGRA, StageStatus.DONE);

      // Act & Assert
      expect(isStageLocked(state, AVANCE)).toBe(false);
    });

    it("should lock avance-ftth again when sigra-layers goes from DONE back to PENDING", () => {
      // Arrange
      const done = withStatus(ftthState(), SIGRA, StageStatus.DONE);

      // Act
      const next = reduce(done, { type: Action.STAGE_STATUS, stageId: SIGRA, status: StageStatus.PENDING });

      // Assert
      expect(isStageLocked(next, AVANCE)).toBe(true);
    });

    it.each(ALL_STATUSES)("should never lock sigra-layers itself (avance-ftth %s)", (status) => {
      // Arrange
      const state = withStatus(ftthState(), AVANCE, status);

      // Act & Assert
      expect(isStageLocked(state, SIGRA)).toBe(false);
    });

    it("should not lock anything while no load type is chosen", () => {
      // Arrange
      const state = createInitialWorkflow(LOAD_TYPE_STAGE_IDS);

      // Act & Assert
      expect(state.loadType).toBeNull();
      expect(isStageLocked(state, AVANCE)).toBe(false);
      expect(isStageLocked(state, SIGRA)).toBe(false);
    });

    it.each(["indicators", "shp"])("should never lock the coverage stage %s", (stageId) => {
      // Arrange
      const state = ftthState({ loadType: LoadType.COVERAGE, activeStageId: stageId });

      // Act & Assert
      expect(isStageLocked(state, stageId)).toBe(false);
    });

    it("should ignore a prerequisite that does not belong to the chosen load type", () => {
      // Arrange
      const state = ftthState({ loadType: LoadType.COVERAGE });

      // Act & Assert
      expect(isStageLocked(state, AVANCE)).toBe(false);
    });

    it("should not lock an unknown stage", () => {
      // Arrange & Act & Assert
      expect(isStageLocked(ftthState(), "ghost")).toBe(false);
    });
  });

  describe("canSkipStage and SKIP_STAGE", () => {
    it.each(ALL_STATUSES)("should refuse to skip sigra-layers whatever its status (%s)", (status) => {
      // Arrange
      const state = withStatus(ftthState(), SIGRA, status);

      // Act & Assert
      expect(canSkipStage(state, SIGRA)).toBe(false);
    });

    it("should leave the state untouched when SKIP_STAGE targets sigra-layers", () => {
      // Arrange
      const start = ftthState();

      // Act
      const next = reduce(start, { type: Action.SKIP_STAGE, stageId: SIGRA });

      // Assert
      expect(next).toBe(start);
      expect(next.stages[SIGRA].status).toBe(StageStatus.PENDING);
    });

    it("should still allow skipping avance-ftth while it is PENDING", () => {
      // Arrange
      const start = ftthState({ activeStageId: AVANCE });

      // Act
      const next = reduce(start, { type: Action.SKIP_STAGE, stageId: AVANCE });

      // Assert
      expect(canSkipStage(start, AVANCE)).toBe(true);
      expect(next.stages[AVANCE].status).toBe(StageStatus.SKIPPED);
    });

    it("should still allow skipping a locked avance-ftth", () => {
      // Arrange
      const start = ftthState({ activeStageId: AVANCE });

      // Act & Assert
      expect(isStageLocked(start, AVANCE)).toBe(true);
      expect(canSkipStage(start, AVANCE)).toBe(true);
    });

    it.each([StageStatus.BUSY, StageStatus.DONE, StageStatus.SKIPPED])(
      "should keep refusing to skip avance-ftth when it is %s",
      (status) => {
        // Arrange
        const state = withStatus(ftthState(), AVANCE, status);

        // Act & Assert
        expect(canSkipStage(state, AVANCE)).toBe(false);
      }
    );
  });

  describe("SELECT_STAGE", () => {
    it("should still open a locked stage so the user can see why it is locked", () => {
      // Arrange
      const start = ftthState();

      // Act
      const next = reduce(start, { type: Action.SELECT_STAGE, stageId: AVANCE });

      // Assert
      expect(isStageLocked(start, AVANCE)).toBe(true);
      expect(next).toMatchObject({ phase: WorkflowPhase.STAGES, activeStageId: AVANCE });
    });

    it("should not change any stage status when selecting a locked stage", () => {
      // Arrange
      const start = ftthState();

      // Act
      const next = reduce(start, { type: Action.SELECT_STAGE, stageId: AVANCE });

      // Assert
      expect(next.stages).toEqual(start.stages);
    });
  });

  describe("connection revision", () => {
    const CHANGE_DATABASE: WorkflowAction[] = [
      { type: Action.EDIT_CONNECTION },
      { type: Action.SET_CONNECTION_FIELD, field: "db_name", value: "other" },
      { type: Action.CONTINUE },
    ];

    function withOutcome(state: WorkflowState, stageId: string, status: StageStatus): WorkflowState {
      return { ...state, stages: { ...state.stages, [stageId]: { status, outcome: OUTCOME } } };
    }

    it("should send a DONE sigra-layers back to PENDING without outcome and lock Avance again when a different connection is confirmed", () => {
      // Arrange
      const start = withOutcome(ftthState(), SIGRA, StageStatus.DONE);
      expect(isStageLocked(start, AVANCE)).toBe(false);

      // Act
      const next = reduce(start, ...CHANGE_DATABASE);

      // Assert
      expect(next.connectionRevision).toBe(1);
      expect(next.stages[SIGRA]).toEqual({ status: StageStatus.PENDING, outcome: null });
      expect(isStageLocked(next, AVANCE)).toBe(true);
    });

    it.each([StageStatus.FAILED, StageStatus.SKIPPED, StageStatus.PENDING])(
      "should put a %s prerequisite stage at PENDING without outcome when a different connection is confirmed",
      (status) => {
        // Arrange
        const start = withOutcome(ftthState(), SIGRA, status);

        // Act
        const next = reduce(start, ...CHANGE_DATABASE);

        // Assert
        expect(next.stages[SIGRA]).toEqual({ status: StageStatus.PENDING, outcome: null });
      }
    );

    it("should leave a BUSY prerequisite stage alone when a different connection is confirmed", () => {
      // Arrange
      const editing = {
        ...withOutcome(ftthState({ phase: WorkflowPhase.CONNECTION }), SIGRA, StageStatus.BUSY),
        connection: { ...CONNECTION, db_name: "other" },
      };

      // Act
      const next = reduce(editing, { type: Action.CONTINUE });

      // Assert
      expect(next.connectionRevision).toBe(1);
      expect(next.stages[SIGRA].status).toBe(StageStatus.BUSY);
    });

    it("should keep the progress of stages that are not prerequisites when a different connection is confirmed", () => {
      // Arrange
      const start = withOutcome(withOutcome(ftthState(), SIGRA, StageStatus.DONE), AVANCE, StageStatus.DONE);

      // Act
      const next = reduce(start, ...CHANGE_DATABASE);

      // Assert
      expect(next.stages[AVANCE]).toEqual({ status: StageStatus.DONE, outcome: OUTCOME });
    });

    it("should leave the Cobertura stages untouched when a different connection is confirmed", () => {
      // Arrange
      const start = withOutcome(
        withOutcome(ftthState({ loadType: LoadType.COVERAGE, activeStageId: "indicators" }), "indicators", StageStatus.DONE),
        "shp",
        StageStatus.SKIPPED
      );

      // Act
      const next = reduce(start, ...CHANGE_DATABASE);

      // Assert
      expect(next.connectionRevision).toBe(1);
      expect(next.stages["indicators"]).toEqual({ status: StageStatus.DONE, outcome: OUTCOME });
      expect(next.stages["shp"]).toEqual({ status: StageStatus.SKIPPED, outcome: OUTCOME });
    });

    it("should change nothing about the stages when the same connection is confirmed again", () => {
      // Arrange
      const start = withOutcome(ftthState(), SIGRA, StageStatus.DONE);

      // Act
      const next = reduce(start, { type: Action.EDIT_CONNECTION }, { type: Action.CONTINUE });

      // Assert
      expect(next.connectionRevision).toBe(0);
      expect(next.stages).toEqual(start.stages);
      expect(isStageLocked(next, AVANCE)).toBe(false);
    });

    it("should change nothing about the stages when a field is edited and put back before confirming", () => {
      // Arrange
      const start = withOutcome(ftthState(), SIGRA, StageStatus.DONE);

      // Act
      const next = reduce(
        start,
        { type: Action.EDIT_CONNECTION },
        { type: Action.SET_CONNECTION_FIELD, field: "db_name", value: "other" },
        { type: Action.SET_CONNECTION_FIELD, field: "db_name", value: CONNECTION.db_name },
        { type: Action.CONTINUE }
      );

      // Assert
      expect(next.connectionRevision).toBe(0);
      expect(next.stages[SIGRA].status).toBe(StageStatus.DONE);
    });

    it("should relock again after a changed password too", () => {
      // Arrange
      const start = withOutcome(ftthState(), SIGRA, StageStatus.DONE);

      // Act
      const next = reduce(
        start,
        { type: Action.EDIT_CONNECTION },
        { type: Action.SET_CONNECTION_FIELD, field: "password", value: "another" },
        { type: Action.CONTINUE }
      );

      // Assert
      expect(isStageLocked(next, AVANCE)).toBe(true);
    });

    it("should not bump the revision when the same connection is confirmed again", () => {
      // Arrange
      const start = ftthState();

      // Act
      const next = reduce(start, { type: Action.EDIT_CONNECTION }, { type: Action.CONTINUE });

      // Assert
      expect(next.connectionRevision).toBe(0);
    });
  });
});
