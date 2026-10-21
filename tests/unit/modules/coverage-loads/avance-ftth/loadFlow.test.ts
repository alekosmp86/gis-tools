import { describe, expect, it } from "vitest";
import { AvanceFileKind } from "@/modules/coverage-loads/avance-ftth/constants";
import {
  canReview,
  canRun,
  FlowPhase,
  INITIAL_LOAD_FLOW,
  isBusy,
  LoadFlowActionType,
  loadFlowReducer,
  RunMode,
  type LoadFlowAction,
  type LoadFlowState,
} from "@/modules/coverage-loads/avance-ftth/domain/loadFlow";
import { buildPlan } from "@/modules/coverage-loads/avance-ftth/domain/plan";
import type { AvanceDbState, AvanceLoadResult } from "@/modules/coverage-loads/avance-ftth/types";
import { makeParsedFile, makeRow } from "./avanceHarness";

const interiorFile = () => new File(["x"], "SituacionFTTH_INT_21092026.csv", { lastModified: 1 });
const montevideoFile = () => new File(["x"], "SituacionFTTH_UDPEM_21092026.csv", { lastModified: 1 });

const DB_STATE: AvanceDbState = {
  staging: {
    [AvanceFileKind.INT]: { rows: 0, fechaact: null },
    [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
  },
  avance: { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false },
  historyRows: 0,
  zoneRows: 10,
  zoneStatuses: [],
  avanceByStatus: [],
  shortfalls: [],
};

const parsed = (rowCount: number) => [
  makeParsedFile(AvanceFileKind.INT, Array.from({ length: rowCount }, () => makeRow())),
  makeParsedFile(AvanceFileKind.UDPEM, Array.from({ length: rowCount }, () => makeRow())),
];

const okPlan = () => buildPlan(parsed(2), [], DB_STATE);
const blockedPlan = () => buildPlan(parsed(0), [], DB_STATE);

function result(dryRun: boolean): AvanceLoadResult {
  return {
    dryRun,
    files: [],
    history: { copied: 0, skipped: false, reason: null },
    avanceInserted: 0,
    byStatus: [],
    reports: [],
    elapsedMs: 5,
    warnings: [],
    rejectedRows: [],
    rejectedTotal: 0,
  };
}

function stateIn(phase: LoadFlowState["phase"], overrides: Partial<LoadFlowState> = {}): LoadFlowState {
  return { ...INITIAL_LOAD_FLOW, phase, files: [interiorFile(), montevideoFile()], ...overrides };
}

const step = (state: LoadFlowState, action: LoadFlowAction) => loadFlowReducer(state, action);

describe("avance-ftth load flow reducer (AC-29)", () => {
  describe("files", () => {
    it("should start empty in the files phase", () => {
      // Arrange & Act & Assert
      expect(INITIAL_LOAD_FLOW).toMatchObject({ phase: FlowPhase.FILES, files: [], plan: null, result: null, error: null });
    });

    it("should add only CSV files and ignore other files", () => {
      // Arrange
      const files = [interiorFile(), new File(["x"], "notas.txt"), new File(["x"], "UPPER.CSV")];

      // Act
      const next = step(INITIAL_LOAD_FLOW, { type: LoadFlowActionType.ADD_FILES, files });

      // Assert
      expect(next.files.map((file) => file.name)).toEqual(["SituacionFTTH_INT_21092026.csv", "UPPER.CSV"]);
    });

    it("should not add the same file twice", () => {
      // Arrange
      const once = step(INITIAL_LOAD_FLOW, { type: LoadFlowActionType.ADD_FILES, files: [interiorFile()] });

      // Act
      const twice = step(once, { type: LoadFlowActionType.ADD_FILES, files: [interiorFile()] });

      // Assert
      expect(twice.files).toHaveLength(1);
    });

    it("should remove a file by position", () => {
      // Arrange
      const state = stateIn(FlowPhase.FILES);

      // Act
      const next = step(state, { type: LoadFlowActionType.REMOVE_FILE, index: 0 });

      // Assert
      expect(next.files.map((file) => file.name)).toEqual(["SituacionFTTH_UDPEM_21092026.csv"]);
    });

    it("should discard a reviewed plan and go back to the files when the files change", () => {
      // Arrange
      const reviewing = stateIn(FlowPhase.REVIEW, { plan: okPlan() });

      // Act
      const added = step(reviewing, { type: LoadFlowActionType.ADD_FILES, files: [new File(["y"], "otro.csv")] });
      const removed = step(reviewing, { type: LoadFlowActionType.REMOVE_FILE, index: 0 });

      // Assert
      for (const next of [added, removed]) {
        expect(next.phase).toBe(FlowPhase.FILES);
        expect(next.plan).toBeNull();
      }
    });

    it("should ignore file edits while planning, running or done", () => {
      // Arrange
      const action = { type: LoadFlowActionType.ADD_FILES, files: [new File(["y"], "otro.csv")] } as const;

      // Act & Assert
      for (const phase of [FlowPhase.PLANNING, FlowPhase.RUNNING, FlowPhase.DONE]) {
        const state = stateIn(phase, { plan: okPlan() });
        expect(step(state, action)).toBe(state);
      }
    });
  });

  describe("planning", () => {
    it("should start planning only with exactly one file of each kind", () => {
      // Arrange
      const complete = stateIn(FlowPhase.FILES);
      const incomplete = stateIn(FlowPhase.FILES, { files: [interiorFile()] });
      const empty = stateIn(FlowPhase.FILES, { files: [] });

      // Act & Assert
      expect(canReview(complete)).toBe(true);
      expect(step(complete, { type: LoadFlowActionType.PLAN_START }).phase).toBe(FlowPhase.PLANNING);
      expect(step(incomplete, { type: LoadFlowActionType.PLAN_START })).toBe(incomplete);
      expect(step(empty, { type: LoadFlowActionType.PLAN_START })).toBe(empty);
    });

    it("should enter the review with the plan on success, and only from planning", () => {
      // Arrange
      const planning = stateIn(FlowPhase.PLANNING);
      const files = stateIn(FlowPhase.FILES);
      const plan = okPlan();

      // Act
      const reviewed = step(planning, { type: LoadFlowActionType.PLAN_SUCCESS, plan });
      const stray = step(files, { type: LoadFlowActionType.PLAN_SUCCESS, plan });

      // Assert
      expect(reviewed).toMatchObject({ phase: FlowPhase.REVIEW, plan });
      expect(stray).toBe(files);
    });

    it("should return to the files with the message when planning fails", () => {
      // Arrange
      const planning = stateIn(FlowPhase.PLANNING);

      // Act
      const next = step(planning, { type: LoadFlowActionType.PLAN_FAILURE, message: "sin conexión" });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, error: "sin conexión" });
    });
  });

  describe("the run gate (a run is only reachable from a reviewed plan without blockers)", () => {
    it.each([
      ["files phase", stateIn(FlowPhase.FILES)],
      ["files phase holding a plan", stateIn(FlowPhase.FILES, { plan: okPlan() })],
      ["review without a plan", stateIn(FlowPhase.REVIEW, { plan: null })],
      ["review with blockers", stateIn(FlowPhase.REVIEW, { plan: blockedPlan() })],
      ["planning", stateIn(FlowPhase.PLANNING, { plan: okPlan() })],
      ["done", stateIn(FlowPhase.DONE, { plan: okPlan(), result: result(false) })],
    ])("should refuse to run from %s", (_label, state) => {
      // Arrange & Act
      const next = step(state, { type: LoadFlowActionType.RUN_START, mode: RunMode.LOAD });

      // Assert
      expect(canRun(state)).toBe(false);
      expect(next).toBe(state);
    });

    it.each([RunMode.LOAD, RunMode.DRY_RUN])("should run in %s mode from a reviewed plan without blockers", (mode) => {
      // Arrange
      const state = stateIn(FlowPhase.REVIEW, { plan: okPlan() });

      // Act
      const next = step(state, { type: LoadFlowActionType.RUN_START, mode });

      // Assert
      expect(canRun(state)).toBe(true);
      expect(next).toMatchObject({ phase: FlowPhase.RUNNING, mode, error: null });
    });

    it("should report busy only while planning or running", () => {
      // Arrange & Act & Assert
      expect(isBusy({ phase: FlowPhase.PLANNING })).toBe(true);
      expect(isBusy({ phase: FlowPhase.RUNNING })).toBe(true);
      expect(isBusy({ phase: FlowPhase.FILES })).toBe(false);
      expect(isBusy({ phase: FlowPhase.REVIEW })).toBe(false);
      expect(isBusy({ phase: FlowPhase.DONE })).toBe(false);
    });
  });

  describe("connection revision", () => {
    it.each([
      ["files", stateIn(FlowPhase.FILES, { plan: okPlan() })],
      ["review", stateIn(FlowPhase.REVIEW, { plan: okPlan() })],
      ["a dry-run result", stateIn(FlowPhase.DONE, { plan: okPlan(), result: result(true), mode: RunMode.DRY_RUN })],
    ])("should discard the reviewed plan and the result and return to the files from %s", (_label, state) => {
      // Arrange & Act
      const next = step(state, { type: LoadFlowActionType.CONNECTION_CHANGED });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, plan: null, result: null, mode: null, error: null });
      expect(next.files).toHaveLength(2);
    });

    it.each([
      ["planning", stateIn(FlowPhase.PLANNING)],
      ["running", stateIn(FlowPhase.RUNNING, { plan: okPlan(), mode: RunMode.LOAD })],
      ["a real load result", stateIn(FlowPhase.DONE, { plan: okPlan(), result: result(false) })],
    ])("should leave %s untouched", (_label, state) => {
      // Arrange & Act & Assert
      expect(step(state, { type: LoadFlowActionType.CONNECTION_CHANGED })).toBe(state);
    });

    it("should refuse to run after the connection changed until a new plan is reviewed", () => {
      // Arrange
      const reviewing = stateIn(FlowPhase.REVIEW, { plan: okPlan() });

      // Act
      const changed = step(reviewing, { type: LoadFlowActionType.CONNECTION_CHANGED });
      const attempted = step(changed, { type: LoadFlowActionType.RUN_START, mode: RunMode.LOAD });

      // Assert
      expect(attempted.phase).toBe(FlowPhase.FILES);
    });
  });

  describe("run outcomes", () => {
    it("should reach done with the result on success, only from running", () => {
      // Arrange
      const running = stateIn(FlowPhase.RUNNING, { plan: okPlan(), mode: RunMode.LOAD });
      const review = stateIn(FlowPhase.REVIEW, { plan: okPlan() });

      // Act
      const done = step(running, { type: LoadFlowActionType.RUN_SUCCESS, result: result(false) });
      const stray = step(review, { type: LoadFlowActionType.RUN_SUCCESS, result: result(false) });

      // Assert
      expect(done).toMatchObject({ phase: FlowPhase.DONE, result: { dryRun: false } });
      expect(stray).toBe(review);
    });

    it("should return to the review with the error and keep the plan when a run fails", () => {
      // Arrange
      const plan = okPlan();
      const running = stateIn(FlowPhase.RUNNING, { plan, mode: RunMode.LOAD });

      // Act
      const next = step(running, { type: LoadFlowActionType.RUN_FAILURE, message: "falló" });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.REVIEW, error: "falló", mode: null });
      expect(next.plan).toBe(plan);
    });

    it("should replace the plan with the one a refusal (409) carried", () => {
      // Arrange
      const refusal = blockedPlan();
      const running = stateIn(FlowPhase.RUNNING, { plan: okPlan(), mode: RunMode.LOAD });

      // Act
      const next = step(running, { type: LoadFlowActionType.RUN_FAILURE, message: "bloqueado", plan: refusal });

      // Assert
      expect(next.plan).toBe(refusal);
      expect(canRun(next)).toBe(false);
    });

    it("should ignore a failure that arrives when nothing is running", () => {
      // Arrange
      const files = stateIn(FlowPhase.FILES);

      // Act & Assert
      expect(step(files, { type: LoadFlowActionType.RUN_FAILURE, message: "x" })).toBe(files);
    });
  });

  describe("dry run keeps the plan reviewable", () => {
    it("should keep the plan in the done state of a dry run and return to the same review", () => {
      // Arrange
      const plan = okPlan();
      const running = stateIn(FlowPhase.RUNNING, { plan, mode: RunMode.DRY_RUN });
      const done = step(running, { type: LoadFlowActionType.RUN_SUCCESS, result: result(true) });

      // Act
      const back = step(done, { type: LoadFlowActionType.BACK_TO_REVIEW });

      // Assert
      expect(done.plan).toBe(plan);
      expect(back).toMatchObject({ phase: FlowPhase.REVIEW, result: null, mode: null, error: null });
      expect(back.plan).toBe(plan);
      expect(canRun(back)).toBe(true);
    });

    it("should not go back to the review from a real load result", () => {
      // Arrange
      const done = stateIn(FlowPhase.DONE, { plan: okPlan(), result: result(false) });

      // Act & Assert
      expect(step(done, { type: LoadFlowActionType.BACK_TO_REVIEW })).toBe(done);
    });
  });

  describe("navigation", () => {
    it("should discard the plan when going back from the review", () => {
      // Arrange
      const reviewing = stateIn(FlowPhase.REVIEW, { plan: okPlan() });

      // Act
      const next = step(reviewing, { type: LoadFlowActionType.BACK });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, plan: null });
    });

    it("should ignore BACK outside the review", () => {
      // Arrange
      const files = stateIn(FlowPhase.FILES);

      // Act & Assert
      expect(step(files, { type: LoadFlowActionType.BACK })).toBe(files);
    });

    it("should restart from done with no files and no plan, and ignore RESTART elsewhere", () => {
      // Arrange
      const done = stateIn(FlowPhase.DONE, { plan: okPlan(), result: result(false) });
      const review = stateIn(FlowPhase.REVIEW, { plan: okPlan() });

      // Act
      const restarted = step(done, { type: LoadFlowActionType.RESTART });

      // Assert
      expect(restarted).toMatchObject({ phase: FlowPhase.FILES, files: [], plan: null, result: null });
      expect(step(review, { type: LoadFlowActionType.RESTART })).toBe(review);
    });
  });
});
