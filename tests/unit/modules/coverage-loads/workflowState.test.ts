import { describe, expect, it } from "vitest";
import { StageStatus, type StageOutcome } from "@/modules/coverage-loads/shared/domain/stageContract";
import { INITIAL_CONNECTION } from "@/modules/coverage-loads/shared/domain/connectionState";
import { LoadType, type StageIdsByLoadType } from "@/modules/coverage-loads/workflow/domain/loadType";
import {
  canContinue,
  canSkipStage,
  canUnskipStage,
  createInitialWorkflow,
  isAnyStageBusy,
  WorkflowActionType as Action,
  WorkflowPhase,
  workflowReducer,
  type WorkflowAction,
  type WorkflowState,
} from "@/modules/coverage-loads/workflow/domain/workflowState";

const STAGE_A = "stage-a";
const STAGE_B = "stage-b";
const STAGE_C = "stage-c";
const CONNECTION = { host: "db.example", port: "5432", db_name: "carto", user: "operator", password: "secret" };
const OUTCOME: StageOutcome = { headline: "Carga completada", lines: ["2 cortes cargados"] };
const STAGE_IDS: StageIdsByLoadType = { [LoadType.COVERAGE]: [STAGE_A, STAGE_B], [LoadType.FTTH]: [STAGE_C] };

/** The state before anything is chosen: phase LOAD_TYPE, no type. */
function initial(): WorkflowState {
  return createInitialWorkflow(STAGE_IDS);
}

/** A coverage workflow in the CONNECTION phase (the type step is behind it). */
function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...initial(), phase: WorkflowPhase.CONNECTION, loadType: LoadType.COVERAGE, ...overrides };
}

function inStages(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return workflow({ phase: WorkflowPhase.STAGES, connection: CONNECTION, confirmedConnection: CONNECTION, ...overrides });
}

function withStatus(state: WorkflowState, stageId: string, status: StageStatus, outcome: StageOutcome | null = null): WorkflowState {
  return { ...state, stages: { ...state.stages, [stageId]: { status, outcome } } };
}

function reduce(start: WorkflowState, ...actions: WorkflowAction[]): WorkflowState {
  return actions.reduce(workflowReducer, start);
}

describe("workflowReducer", () => {
  describe("createInitialWorkflow", () => {
    it("should start in LOAD_TYPE with no load type, the default draft, nothing confirmed and revision 0", () => {
      // Arrange & Act
      const state = initial();

      // Assert
      expect(state).toMatchObject({
        phase: WorkflowPhase.LOAD_TYPE,
        loadType: null,
        connection: INITIAL_CONNECTION,
        confirmedConnection: null,
        connectionRevision: 0,
      });
    });

    it("should create a PENDING stage without outcome for every id of every load type and activate the first coverage stage", () => {
      // Arrange & Act
      const state = initial();

      // Assert
      expect(state.activeStageId).toBe(STAGE_A);
      expect(state.stages).toEqual({
        [STAGE_A]: { status: StageStatus.PENDING, outcome: null },
        [STAGE_B]: { status: StageStatus.PENDING, outcome: null },
        [STAGE_C]: { status: StageStatus.PENDING, outcome: null },
      });
    });

    it("should keep the stage ids by load type and not be tied to any particular id", () => {
      // Arrange & Act
      const state = createInitialWorkflow({ [LoadType.COVERAGE]: ["only"], [LoadType.FTTH]: ["other"] });

      // Assert
      expect(Object.keys(state.stages)).toEqual(["only", "other"]);
      expect(state.activeStageId).toBe("only");
      expect(state.stageIdsByLoadType).toEqual({ [LoadType.COVERAGE]: ["only"], [LoadType.FTTH]: ["other"] });
    });
  });

  describe("SELECT_LOAD_TYPE", () => {
    it.each([LoadType.COVERAGE, LoadType.FTTH])("should record %s and move to CONNECTION when no connection is confirmed yet", (loadType) => {
      // Arrange
      const start = initial();

      // Act
      const next = reduce(start, { type: Action.SELECT_LOAD_TYPE, loadType });

      // Assert
      expect(next.loadType).toBe(loadType);
      expect(next.phase).toBe(WorkflowPhase.CONNECTION);
      expect(next.confirmedConnection).toBeNull();
    });

    it("should activate the first stage of the chosen type", () => {
      // Arrange & Act
      const coverage = reduce(initial(), { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.COVERAGE });
      const ftth = reduce(initial(), { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.FTTH });

      // Assert
      expect(coverage.activeStageId).toBe(STAGE_A);
      expect(ftth.activeStageId).toBe(STAGE_C);
    });

    it("should keep the connection draft the user already typed", () => {
      // Arrange
      const start = { ...initial(), connection: CONNECTION };

      // Act
      const next = reduce(start, { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.FTTH });

      // Assert
      expect(next.connection).toEqual(CONNECTION);
    });

    it.each([WorkflowPhase.CONNECTION, WorkflowPhase.STAGES, WorkflowPhase.RESULT])(
      "should be ignored outside the LOAD_TYPE phase (%s)",
      (phase) => {
        // Arrange
        const start = inStages({ phase });

        // Act & Assert
        expect(reduce(start, { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.FTTH })).toBe(start);
      }
    );
  });

  describe("EDIT_LOAD_TYPE and switching the type", () => {
    function switchTo(start: WorkflowState, loadType: LoadType): WorkflowState {
      return reduce(start, { type: Action.EDIT_LOAD_TYPE }, { type: Action.SELECT_LOAD_TYPE, loadType });
    }

    it.each([WorkflowPhase.CONNECTION, WorkflowPhase.STAGES, WorkflowPhase.RESULT])(
      "should reopen the type choice from %s when no stage is busy, keeping the chosen type until another is picked",
      (phase) => {
        // Arrange
        const start = inStages({ phase });

        // Act
        const next = reduce(start, { type: Action.EDIT_LOAD_TYPE });

        // Assert
        expect(next.phase).toBe(WorkflowPhase.LOAD_TYPE);
        expect(next.loadType).toBe(LoadType.COVERAGE);
        expect(next.confirmedConnection).toEqual(CONNECTION);
      }
    );

    it("should be refused while any stage is BUSY", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_B, StageStatus.BUSY);

      // Act & Assert
      expect(reduce(start, { type: Action.EDIT_LOAD_TYPE })).toBe(start);
    });

    it("should be a no-op when already in the LOAD_TYPE phase", () => {
      // Arrange
      const start = initial();

      // Act & Assert
      expect(reduce(start, { type: Action.EDIT_LOAD_TYPE })).toBe(start);
    });

    it("should switch to the other type keeping the connection, its revision and the draft, and land in STAGES", () => {
      // Arrange
      const start = inStages({ connectionRevision: 3 });

      // Act
      const next = switchTo(start, LoadType.FTTH);

      // Assert
      expect(next).toMatchObject({
        phase: WorkflowPhase.STAGES,
        loadType: LoadType.FTTH,
        connection: CONNECTION,
        confirmedConnection: CONNECTION,
        connectionRevision: 3,
      });
    });

    it("should reset every stage to PENDING without outcome and activate the first stage of the new type", () => {
      // Arrange
      let start = withStatus(inStages(), STAGE_A, StageStatus.DONE, OUTCOME);
      start = withStatus(start, STAGE_B, StageStatus.SKIPPED);
      start = withStatus(start, STAGE_C, StageStatus.FAILED);

      // Act
      const next = switchTo(start, LoadType.FTTH);

      // Assert
      expect(next.activeStageId).toBe(STAGE_C);
      expect(next.stages).toEqual({
        [STAGE_A]: { status: StageStatus.PENDING, outcome: null },
        [STAGE_B]: { status: StageStatus.PENDING, outcome: null },
        [STAGE_C]: { status: StageStatus.PENDING, outcome: null },
      });
    });

    it("should switch back from FTTH to coverage the same way", () => {
      // Arrange
      const ftthDone = withStatus(inStages({ loadType: LoadType.FTTH, activeStageId: STAGE_C }), STAGE_C, StageStatus.DONE, OUTCOME);

      // Act
      const next = switchTo(ftthDone, LoadType.COVERAGE);

      // Assert
      expect(next.activeStageId).toBe(STAGE_A);
      expect(next.stages[STAGE_C]).toEqual({ status: StageStatus.PENDING, outcome: null });
    });

    it("should leave the progress alone when the same type is chosen again, and still leave the LOAD_TYPE phase", () => {
      // Arrange
      const done = withStatus(inStages({ activeStageId: STAGE_B }), STAGE_A, StageStatus.DONE, OUTCOME);

      // Act
      const next = switchTo(done, LoadType.COVERAGE);

      // Assert
      expect(next.phase).toBe(WorkflowPhase.STAGES);
      expect(next.stages).toEqual(done.stages);
      expect(next.activeStageId).toBe(STAGE_B);
      expect(next.loadType).toBe(LoadType.COVERAGE);
    });

    it("should go back to CONNECTION, not STAGES, when the type is changed before any connection was confirmed", () => {
      // Arrange
      const start = workflow({ phase: WorkflowPhase.CONNECTION });

      // Act
      const next = switchTo(start, LoadType.FTTH);

      // Assert
      expect(next).toMatchObject({ phase: WorkflowPhase.CONNECTION, loadType: LoadType.FTTH, confirmedConnection: null });
      expect(next.activeStageId).toBe(STAGE_C);
    });

    it.each([LoadType.COVERAGE, LoadType.FTTH])(
      "should reset an unconfirmed connection edit to the confirmed connection when %s is picked",
      (loadType) => {
        // Arrange
        const edited = inStages({ connection: { ...CONNECTION, db_name: "typed-not-confirmed" }, connectionRevision: 2 });

        // Act
        const next = switchTo(edited, loadType);

        // Assert
        expect(next.connection).toEqual(CONNECTION);
        expect(next.phase).toBe(WorkflowPhase.STAGES);
        expect(next.confirmedConnection).toEqual(CONNECTION);
        expect(next.connectionRevision).toBe(2);
      }
    );

    it("should not bump the revision when the connection is confirmed again after a type switch with the same draft", () => {
      // Arrange
      const confirmed = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Act
      const next = reduce(
        confirmed,
        { type: Action.EDIT_LOAD_TYPE },
        { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.FTTH },
        { type: Action.EDIT_CONNECTION },
        { type: Action.CONTINUE }
      );

      // Assert
      expect(next.connectionRevision).toBe(0);
      expect(next.loadType).toBe(LoadType.FTTH);
    });
  });

  describe("SET_CONNECTION_FIELD and APPLY_PROFILE", () => {
    it("should set a field of the draft in the CONNECTION phase", () => {
      // Arrange & Act
      const next = reduce(workflow(), { type: Action.SET_CONNECTION_FIELD, field: "db_name", value: "carto" });

      // Assert
      expect(next.connection.db_name).toBe("carto");
      expect(next.phase).toBe(WorkflowPhase.CONNECTION);
    });

    it("should apply a profile and clear the password, keeping unrelated fields", () => {
      // Arrange
      const start = workflow({ connection: { ...CONNECTION, password: "typed" } });

      // Act
      const next = reduce(start, { type: Action.APPLY_PROFILE, values: { host: "other", db_name: "dev" } });

      // Assert
      expect(next.connection).toEqual({ host: "other", port: "5432", db_name: "dev", user: "operator", password: "" });
    });

    it.each([WorkflowPhase.LOAD_TYPE, WorkflowPhase.STAGES, WorkflowPhase.RESULT])(
      "should ignore both edits outside the CONNECTION phase (%s)",
      (phase) => {
        // Arrange
        const start = inStages({ phase });

        // Act
        const next = reduce(
          start,
          { type: Action.SET_CONNECTION_FIELD, field: "host", value: "elsewhere" },
          { type: Action.APPLY_PROFILE, values: { host: "elsewhere" } }
        );

        // Assert
        expect(next).toBe(start);
      }
    );
  });

  describe("CONTINUE", () => {
    it("should confirm a complete connection and move to STAGES", () => {
      // Arrange
      const start = workflow({ connection: CONNECTION });

      // Act
      const next = reduce(start, { type: Action.CONTINUE });

      // Assert
      expect(next.phase).toBe(WorkflowPhase.STAGES);
      expect(next.confirmedConnection).toEqual(CONNECTION);
    });

    it.each(["host", "port", "db_name", "user"] as const)("should stay put when %s is blank", (field) => {
      // Arrange
      const start = workflow({ connection: { ...CONNECTION, [field]: "   " } });

      // Act & Assert
      expect(reduce(start, { type: Action.CONTINUE })).toBe(start);
    });

    it("should refuse the untouched initial connection", () => {
      // Arrange
      const start = workflow();

      // Act & Assert
      expect(reduce(start, { type: Action.CONTINUE })).toBe(start);
    });

    it("should not require the password", () => {
      // Arrange
      const start = workflow({ connection: { ...CONNECTION, password: "" } });

      // Act & Assert
      expect(reduce(start, { type: Action.CONTINUE }).phase).toBe(WorkflowPhase.STAGES);
    });

    it("should be a no-op without a load type, even in the CONNECTION phase with a complete draft", () => {
      // Arrange
      const start = workflow({ connection: CONNECTION, loadType: null });

      // Act & Assert
      expect(reduce(start, { type: Action.CONTINUE })).toBe(start);
    });

    it.each([WorkflowPhase.LOAD_TYPE, WorkflowPhase.STAGES, WorkflowPhase.RESULT])(
      "should be ignored outside the CONNECTION phase (%s)",
      (phase) => {
        // Arrange
        const start = inStages({ phase });

        // Act & Assert
        expect(reduce(start, { type: Action.CONTINUE })).toBe(start);
      }
    );

    it("should keep the stage progress untouched", () => {
      // Arrange
      const start = withStatus(workflow({ connection: CONNECTION }), STAGE_B, StageStatus.SKIPPED);

      // Act
      const next = reduce(start, { type: Action.CONTINUE });

      // Assert
      expect(next.stages).toEqual(start.stages);
    });
  });

  describe("connectionRevision", () => {
    it("should not bump on the first confirmation", () => {
      // Arrange & Act
      const next = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Assert
      expect(next.connectionRevision).toBe(0);
    });

    it("should not bump when the same connection is confirmed again", () => {
      // Arrange
      const confirmed = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Act
      const next = reduce(confirmed, { type: Action.EDIT_CONNECTION }, { type: Action.CONTINUE });

      // Assert
      expect(next.connectionRevision).toBe(0);
    });

    it("should bump when an edited connection is confirmed", () => {
      // Arrange
      const confirmed = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Act
      const next = reduce(
        confirmed,
        { type: Action.EDIT_CONNECTION },
        { type: Action.SET_CONNECTION_FIELD, field: "db_name", value: "other" },
        { type: Action.CONTINUE }
      );

      // Assert
      expect(next.connectionRevision).toBe(1);
      expect(next.confirmedConnection?.db_name).toBe("other");
    });

    it("should bump when only the password changed", () => {
      // Arrange
      const confirmed = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Act
      const next = reduce(
        confirmed,
        { type: Action.EDIT_CONNECTION },
        { type: Action.SET_CONNECTION_FIELD, field: "password", value: "another" },
        { type: Action.CONTINUE }
      );

      // Assert
      expect(next.connectionRevision).toBe(1);
    });

    it("should not bump when a field is edited and put back before confirming", () => {
      // Arrange
      const confirmed = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Act
      const next = reduce(
        confirmed,
        { type: Action.EDIT_CONNECTION },
        { type: Action.SET_CONNECTION_FIELD, field: "host", value: "elsewhere" },
        { type: Action.SET_CONNECTION_FIELD, field: "host", value: CONNECTION.host },
        { type: Action.CONTINUE }
      );

      // Assert
      expect(next.connectionRevision).toBe(0);
    });

    it("should keep counting on each further changed confirmation", () => {
      // Arrange
      let state = reduce(workflow({ connection: CONNECTION }), { type: Action.CONTINUE });

      // Act
      for (const dbName of ["one", "two"]) {
        state = reduce(
          state,
          { type: Action.EDIT_CONNECTION },
          { type: Action.SET_CONNECTION_FIELD, field: "db_name", value: dbName },
          { type: Action.CONTINUE }
        );
      }

      // Assert
      expect(state.connectionRevision).toBe(2);
    });
  });

  describe("EDIT_CONNECTION", () => {
    it.each([WorkflowPhase.STAGES, WorkflowPhase.RESULT])("should reopen the connection from %s when no stage is busy", (phase) => {
      // Arrange
      const start = inStages({ phase });

      // Act
      const next = reduce(start, { type: Action.EDIT_CONNECTION });

      // Assert
      expect(next.phase).toBe(WorkflowPhase.CONNECTION);
      expect(next.confirmedConnection).toEqual(CONNECTION);
    });

    it("should be refused while any stage is BUSY", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_C, StageStatus.BUSY);

      // Act & Assert
      expect(reduce(start, { type: Action.EDIT_CONNECTION })).toBe(start);
    });

    it.each([StageStatus.PENDING, StageStatus.SKIPPED, StageStatus.DONE, StageStatus.FAILED])(
      "should be allowed when the only non-idle stage is %s",
      (status) => {
        // Arrange
        const start = withStatus(inStages(), STAGE_B, status);

        // Act & Assert
        expect(reduce(start, { type: Action.EDIT_CONNECTION }).phase).toBe(WorkflowPhase.CONNECTION);
      }
    );

    it("should be a no-op when already in the CONNECTION phase", () => {
      // Arrange
      const start = workflow();

      // Act & Assert
      expect(reduce(start, { type: Action.EDIT_CONNECTION })).toBe(start);
    });

    it("should be a no-op in the LOAD_TYPE phase: the type comes before the connection", () => {
      // Arrange
      const fresh = initial();
      const reopenedType = inStages({ phase: WorkflowPhase.LOAD_TYPE });

      // Act & Assert
      expect(reduce(fresh, { type: Action.EDIT_CONNECTION })).toBe(fresh);
      expect(reduce(reopenedType, { type: Action.EDIT_CONNECTION })).toBe(reopenedType);
    });
  });

  describe("SELECT_STAGE", () => {
    it.each([WorkflowPhase.STAGES, WorkflowPhase.RESULT])("should activate the stage and show STAGES from %s", (phase) => {
      // Arrange
      const start = inStages({ phase });

      // Act
      const next = reduce(start, { type: Action.SELECT_STAGE, stageId: STAGE_B });

      // Assert
      expect(next).toMatchObject({ phase: WorkflowPhase.STAGES, activeStageId: STAGE_B });
    });

    it.each([WorkflowPhase.LOAD_TYPE, WorkflowPhase.CONNECTION])("should be refused in the %s phase", (phase) => {
      // Arrange
      const start = workflow({ phase });

      // Act & Assert
      expect(reduce(start, { type: Action.SELECT_STAGE, stageId: STAGE_B })).toBe(start);
    });

    it("should ignore an unknown stage id", () => {
      // Arrange
      const start = inStages();

      // Act & Assert
      expect(reduce(start, { type: Action.SELECT_STAGE, stageId: "ghost" })).toBe(start);
    });

    it("should ignore a stage that belongs to the other load type", () => {
      // Arrange
      const coverage = inStages({ loadType: LoadType.COVERAGE });
      const ftth = inStages({ loadType: LoadType.FTTH, activeStageId: STAGE_C });

      // Act & Assert
      expect(reduce(coverage, { type: Action.SELECT_STAGE, stageId: STAGE_C })).toBe(coverage);
      expect(reduce(ftth, { type: Action.SELECT_STAGE, stageId: STAGE_A })).toBe(ftth);
    });

    it("should leave the stages untouched", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_A, StageStatus.DONE, OUTCOME);

      // Act
      const next = reduce(start, { type: Action.SELECT_STAGE, stageId: STAGE_B });

      // Assert
      expect(next.stages).toEqual(start.stages);
    });
  });

  describe("SKIP_STAGE and UNSKIP_STAGE", () => {
    it("should skip a PENDING stage and drop its outcome", () => {
      // Arrange
      const start = inStages();

      // Act
      const next = reduce(start, { type: Action.SKIP_STAGE, stageId: STAGE_B });

      // Assert
      expect(next.stages[STAGE_B]).toEqual({ status: StageStatus.SKIPPED, outcome: null });
      expect(next.stages[STAGE_A].status).toBe(StageStatus.PENDING);
    });

    it("should skip a FAILED stage", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_A, StageStatus.FAILED);

      // Act
      const next = reduce(start, { type: Action.SKIP_STAGE, stageId: STAGE_A });

      // Assert
      expect(next.stages[STAGE_A].status).toBe(StageStatus.SKIPPED);
    });

    it.each([StageStatus.BUSY, StageStatus.DONE, StageStatus.SKIPPED])("should refuse to skip a %s stage", (status) => {
      // Arrange
      const start = withStatus(inStages(), STAGE_A, status);

      // Act & Assert
      expect(reduce(start, { type: Action.SKIP_STAGE, stageId: STAGE_A })).toBe(start);
      expect(canSkipStage(start, STAGE_A)).toBe(false);
    });

    it("should move on to the next open stage of the chosen type only, wrapping inside it", () => {
      // Arrange
      const lastOfCoverage = inStages({ loadType: LoadType.COVERAGE, activeStageId: STAGE_B });

      // Act
      const next = reduce(lastOfCoverage, { type: Action.SKIP_STAGE, stageId: STAGE_B });

      // Assert
      expect(next.activeStageId).toBe(STAGE_A);
      expect(next.stages[STAGE_C].status).toBe(StageStatus.PENDING);
    });

    it("should stay on the only stage of FTTH after skipping it", () => {
      // Arrange
      const ftth = inStages({ loadType: LoadType.FTTH, activeStageId: STAGE_C });

      // Act
      const next = reduce(ftth, { type: Action.SKIP_STAGE, stageId: STAGE_C });

      // Assert
      expect(next.activeStageId).toBe(STAGE_C);
      expect(next.stages[STAGE_C].status).toBe(StageStatus.SKIPPED);
    });

    it("should ignore skipping an unknown stage", () => {
      // Arrange
      const start = inStages();

      // Act & Assert
      expect(reduce(start, { type: Action.SKIP_STAGE, stageId: "ghost" })).toBe(start);
      expect(canSkipStage(start, "ghost")).toBe(false);
    });

    it("should unskip a SKIPPED stage back to PENDING", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_B, StageStatus.SKIPPED);

      // Act
      const next = reduce(start, { type: Action.UNSKIP_STAGE, stageId: STAGE_B });

      // Assert
      expect(next.stages[STAGE_B]).toEqual({ status: StageStatus.PENDING, outcome: null });
      expect(canUnskipStage(start, STAGE_B)).toBe(true);
    });

    it.each([StageStatus.PENDING, StageStatus.BUSY, StageStatus.DONE, StageStatus.FAILED])(
      "should refuse to unskip a %s stage",
      (status) => {
        // Arrange
        const start = withStatus(inStages(), STAGE_A, status, OUTCOME);

        // Act & Assert
        expect(reduce(start, { type: Action.UNSKIP_STAGE, stageId: STAGE_A })).toBe(start);
        expect(canUnskipStage(start, STAGE_A)).toBe(false);
      }
    );

    it("should ignore unskipping an unknown stage", () => {
      // Arrange
      const start = inStages();

      // Act & Assert
      expect(reduce(start, { type: Action.UNSKIP_STAGE, stageId: "ghost" })).toBe(start);
    });
  });

  describe("STAGE_STATUS", () => {
    it("should store the status and the outcome as plain data", () => {
      // Arrange
      const start = inStages();

      // Act
      const next = reduce(start, { type: Action.STAGE_STATUS, stageId: STAGE_A, status: StageStatus.DONE, outcome: OUTCOME });

      // Assert
      expect(next.stages[STAGE_A]).toEqual({ status: StageStatus.DONE, outcome: OUTCOME });
      expect(next.stages[STAGE_B].status).toBe(StageStatus.PENDING);
    });

    it("should store a null outcome when none is published, replacing the previous one", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_A, StageStatus.DONE, OUTCOME);

      // Act
      const next = reduce(start, { type: Action.STAGE_STATUS, stageId: STAGE_A, status: StageStatus.BUSY });

      // Assert
      expect(next.stages[STAGE_A]).toEqual({ status: StageStatus.BUSY, outcome: null });
    });

    it("should be ignored for a SKIPPED stage", () => {
      // Arrange
      const start = withStatus(inStages(), STAGE_A, StageStatus.SKIPPED);

      // Act
      const next = reduce(start, { type: Action.STAGE_STATUS, stageId: STAGE_A, status: StageStatus.DONE, outcome: OUTCOME });

      // Assert
      expect(next).toBe(start);
    });

    it("should be ignored for an unknown stage", () => {
      // Arrange
      const start = inStages();

      // Act & Assert
      expect(reduce(start, { type: Action.STAGE_STATUS, stageId: "ghost", status: StageStatus.DONE })).toBe(start);
    });

    it("should make isAnyStageBusy follow the published statuses", () => {
      // Arrange
      const start = inStages();

      // Act
      const busy = reduce(start, { type: Action.STAGE_STATUS, stageId: STAGE_B, status: StageStatus.BUSY });
      const idle = reduce(busy, { type: Action.STAGE_STATUS, stageId: STAGE_B, status: StageStatus.PENDING });

      // Assert
      expect(isAnyStageBusy(start)).toBe(false);
      expect(isAnyStageBusy(busy)).toBe(true);
      expect(isAnyStageBusy(idle)).toBe(false);
    });
  });

  describe("GO_TO_RESULT and BACK_TO_STAGES", () => {
    it("should go to RESULT only from STAGES", () => {
      // Arrange
      const start = inStages();

      // Act
      const next = reduce(start, { type: Action.GO_TO_RESULT });

      // Assert
      expect(next.phase).toBe(WorkflowPhase.RESULT);
    });

    it.each([WorkflowPhase.LOAD_TYPE, WorkflowPhase.CONNECTION, WorkflowPhase.RESULT])("should refuse GO_TO_RESULT from %s", (phase) => {
      // Arrange
      const start = inStages({ phase });

      // Act & Assert
      expect(reduce(start, { type: Action.GO_TO_RESULT })).toBe(start);
    });

    it("should go back to STAGES only from RESULT", () => {
      // Arrange
      const start = inStages({ phase: WorkflowPhase.RESULT });

      // Act
      const next = reduce(start, { type: Action.BACK_TO_STAGES });

      // Assert
      expect(next.phase).toBe(WorkflowPhase.STAGES);
    });

    it.each([WorkflowPhase.LOAD_TYPE, WorkflowPhase.CONNECTION, WorkflowPhase.STAGES])("should refuse BACK_TO_STAGES from %s", (phase) => {
      // Arrange
      const start = inStages({ phase });

      // Act & Assert
      expect(reduce(start, { type: Action.BACK_TO_STAGES })).toBe(start);
    });
  });

  describe("canContinue", () => {
    it("should be true only in the CONNECTION phase with a complete draft and a chosen load type", () => {
      // Arrange, Act & Assert
      expect(canContinue(workflow({ connection: CONNECTION }))).toBe(true);
      expect(canContinue(initial())).toBe(false);
      expect(canContinue(inStages())).toBe(false);
    });

    it("should be false without a load type even when the draft is complete and the phase is CONNECTION", () => {
      // Arrange
      const state = workflow({ connection: CONNECTION, loadType: null });

      // Act & Assert
      expect(canContinue(state)).toBe(false);
    });
  });

  describe("full journey", () => {
    it("should run type, connection, two stages (one skipped), result and back without losing outcomes", () => {
      // Arrange & Act
      const next = reduce(
        { ...initial(), connection: CONNECTION },
        { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.COVERAGE },
        { type: Action.CONTINUE },
        { type: Action.SKIP_STAGE, stageId: STAGE_B },
        { type: Action.STAGE_STATUS, stageId: STAGE_A, status: StageStatus.BUSY },
        { type: Action.STAGE_STATUS, stageId: STAGE_A, status: StageStatus.DONE, outcome: OUTCOME },
        { type: Action.GO_TO_RESULT },
        { type: Action.BACK_TO_STAGES }
      );

      // Assert
      expect(next.phase).toBe(WorkflowPhase.STAGES);
      expect(next.stages[STAGE_A]).toEqual({ status: StageStatus.DONE, outcome: OUTCOME });
      expect(next.stages[STAGE_B].status).toBe(StageStatus.SKIPPED);
    });

    it("should run type, connection, the single FTTH stage and result", () => {
      // Arrange & Act
      const next = reduce(
        { ...initial(), connection: CONNECTION },
        { type: Action.SELECT_LOAD_TYPE, loadType: LoadType.FTTH },
        { type: Action.CONTINUE },
        { type: Action.STAGE_STATUS, stageId: STAGE_C, status: StageStatus.DONE, outcome: OUTCOME },
        { type: Action.GO_TO_RESULT }
      );

      // Assert
      expect(next).toMatchObject({ phase: WorkflowPhase.RESULT, loadType: LoadType.FTTH, activeStageId: STAGE_C });
      expect(next.stages[STAGE_C]).toEqual({ status: StageStatus.DONE, outcome: OUTCOME });
    });
  });
});
