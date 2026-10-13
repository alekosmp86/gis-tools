import { describe, expect, it } from "vitest";
import {
  canLoad,
  canReview,
  FlowPhase,
  INITIAL_LOAD_FLOW,
  isBusy,
  LoadFlowActionType as Action,
  loadFlowReducer,
  type LoadFlowAction,
  type LoadFlowState,
} from "@/modules/coverage-loads/indicators/domain/loadFlow";
import type { IndicatorsPlan, LoadResult } from "@/modules/coverage-loads/indicators/client";

function plan(overrides: Partial<IndicatorsPlan> = {}): IndicatorsPlan {
  return {
    cuts: [],
    fileErrors: [],
    privilegeShortfalls: [],
    canLoad: true,
    requiresAcceptShrink: false,
    hasIncompleteCut: false,
    blockers: [],
    ...overrides,
  };
}

const RESULT: LoadResult = { cuts: [], totalInserted: 5, totalReplaced: 0, hasIncompleteCut: false, rejectedRows: [] };

function csv(name: string, size = 10, lastModified = 1): File {
  return new File(["x".repeat(size)], name, { lastModified });
}

function state(overrides: Partial<LoadFlowState> = {}): LoadFlowState {
  return { ...INITIAL_LOAD_FLOW, ...overrides };
}

function reduce(start: LoadFlowState, ...actions: LoadFlowAction[]): LoadFlowState {
  return actions.reduce(loadFlowReducer, start);
}

const FILE = csv("IndicadoresLTE_20260901.csv");
const inReview = (overrides: Partial<LoadFlowState> = {}) =>
  state({ phase: FlowPhase.REVIEW, files: [FILE], plan: plan(), ...overrides });

describe("loadFlowReducer (AC-28)", () => {
  describe("initial state", () => {
    it("should start on the files step with no files, plan or result", () => {
      // Arrange & Act & Assert
      expect(INITIAL_LOAD_FLOW).toMatchObject({
        phase: FlowPhase.FILES,
        files: [],
        plan: null,
        acceptShrink: false,
        result: null,
        error: null,
      });
    });
  });

  describe("CONNECTION_CHANGED", () => {
    it.each([FlowPhase.FILES, FlowPhase.REVIEW])(
      "should drop the plan, reset acceptShrink and error and land on FILES when the connection changes in %s",
      (phase) => {
        // Arrange
        const start = state({ phase, files: [FILE], plan: plan({ requiresAcceptShrink: true }), acceptShrink: true, error: "x" });

        // Act
        const next = reduce(start, { type: Action.CONNECTION_CHANGED });

        // Assert
        expect(next).toMatchObject({ phase: FlowPhase.FILES, plan: null, acceptShrink: false, error: null });
        expect(next.files).toEqual([FILE]);
      }
    );

    it("should stay on FILES, keeping the files, when already there", () => {
      // Arrange
      const start = state({ phase: FlowPhase.FILES, files: [FILE] });

      // Act
      const next = reduce(start, { type: Action.CONNECTION_CHANGED });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, files: [FILE], plan: null });
    });

    it.each([FlowPhase.PLANNING, FlowPhase.LOADING, FlowPhase.DONE])("should be ignored while %s", (phase) => {
      // Arrange
      const start = state({ phase, files: [FILE], plan: plan(), result: RESULT, acceptShrink: true });

      // Act
      const next = reduce(start, { type: Action.CONNECTION_CHANGED });

      // Assert
      expect(next).toBe(start);
    });

    it("should be idempotent", () => {
      // Arrange
      const start = inReview({ acceptShrink: true, error: "x" });

      // Act
      const once = reduce(start, { type: Action.CONNECTION_CHANGED });
      const twice = reduce(once, { type: Action.CONNECTION_CHANGED });

      // Assert
      expect(twice).toEqual(once);
    });
  });

  describe("BACK", () => {
    it("should go back from REVIEW to FILES and throw the plan away", () => {
      // Arrange & Act
      const next = reduce(inReview({ acceptShrink: true }), { type: Action.BACK });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, plan: null, acceptShrink: false });
    });

    it.each([FlowPhase.FILES, FlowPhase.PLANNING, FlowPhase.LOADING, FlowPhase.DONE])("should ignore BACK in %s", (phase) => {
      // Arrange
      const start = state({ phase });

      // Act & Assert
      expect(reduce(start, { type: Action.BACK })).toBe(start);
    });
  });

  describe("file editing", () => {
    it("should add CSV files in the files step", () => {
      // Arrange & Act
      const next = reduce(state({ phase: FlowPhase.FILES }), { type: Action.ADD_FILES, files: [csv("a.csv"), csv("b.CSV")] });

      // Assert
      expect(next.files.map((file) => file.name)).toEqual(["a.csv", "b.CSV"]);
    });

    it("should ignore files that are not .csv", () => {
      // Arrange & Act
      const next = reduce(state({ phase: FlowPhase.FILES }), {
        type: Action.ADD_FILES,
        files: [csv("notas.txt"), csv("datos.csv.bak"), csv("dump.xlsx"), csv("ok.csv")],
      });

      // Assert
      expect(next.files.map((file) => file.name)).toEqual(["ok.csv"]);
    });

    it("should ignore an exact duplicate (same name, size and date) but keep a changed file of the same name", () => {
      // Arrange
      const start = state({ phase: FlowPhase.FILES, files: [csv("a.csv", 10, 1)] });

      // Act
      const next = reduce(
        start,
        { type: Action.ADD_FILES, files: [csv("a.csv", 10, 1)] },
        { type: Action.ADD_FILES, files: [csv("a.csv", 11, 1), csv("a.csv", 10, 2)] }
      );

      // Assert
      expect(next.files.map((file) => [file.name, file.size, file.lastModified])).toEqual([
        ["a.csv", 10, 1],
        ["a.csv", 11, 1],
        ["a.csv", 10, 2],
      ]);
    });

    it("should drop duplicates inside one batch", () => {
      // Arrange & Act
      const next = reduce(state({ phase: FlowPhase.FILES }), { type: Action.ADD_FILES, files: [csv("a.csv"), csv("a.csv")] });

      // Assert
      expect(next.files).toHaveLength(1);
    });

    it("should remove a file by index and ignore an index out of range", () => {
      // Arrange
      const start = state({ phase: FlowPhase.FILES, files: [csv("a.csv"), csv("b.csv")] });

      // Act
      const removed = reduce(start, { type: Action.REMOVE_FILE, index: 0 });
      const untouched = reduce(start, { type: Action.REMOVE_FILE, index: 9 });

      // Assert
      expect(removed.files.map((file) => file.name)).toEqual(["b.csv"]);
      expect(untouched.files).toHaveLength(2);
    });

    it("should drop the plan, reset acceptShrink and return to FILES when files change in REVIEW", () => {
      // Arrange
      const start = inReview({ acceptShrink: true, plan: plan({ requiresAcceptShrink: true }) });

      // Act
      const added = reduce(start, { type: Action.ADD_FILES, files: [csv("nuevo.csv")] });
      const removed = reduce(start, { type: Action.REMOVE_FILE, index: 0 });

      // Assert
      for (const next of [added, removed]) {
        expect(next).toMatchObject({ phase: FlowPhase.FILES, plan: null, acceptShrink: false, error: null });
      }
      expect(added.files.map((file) => file.name)).toEqual([FILE.name, "nuevo.csv"]);
      expect(removed.files).toEqual([]);
    });

    it.each([FlowPhase.PLANNING, FlowPhase.LOADING, FlowPhase.DONE])(
      "should ignore file edits while %s",
      (phase) => {
        // Arrange
        const start = state({ phase, files: [FILE] });

        // Act
        const next = reduce(start, { type: Action.ADD_FILES, files: [csv("x.csv")] }, { type: Action.REMOVE_FILE, index: 0 });

        // Assert
        expect(next).toBe(start);
      }
    );
  });

  describe("planning", () => {
    it("should start planning when at least one file is chosen", () => {
      // Arrange & Act
      const next = reduce(state({ phase: FlowPhase.FILES, files: [FILE], error: "x" }), { type: Action.PLAN_START });

      // Assert
      expect(next.phase).toBe(FlowPhase.PLANNING);
      expect(next.error).toBeNull();
    });

    it("should not start planning without files", () => {
      // Arrange
      const start = state({ phase: FlowPhase.FILES });

      // Act & Assert
      expect(reduce(start, { type: Action.PLAN_START })).toBe(start);
    });

    it.each([FlowPhase.REVIEW, FlowPhase.PLANNING, FlowPhase.LOADING, FlowPhase.DONE])(
      "should not start planning from %s",
      (phase) => {
        // Arrange
        const start = state({ phase, files: [FILE] });

        // Act & Assert
        expect(reduce(start, { type: Action.PLAN_START })).toBe(start);
      }
    );

    it("should show the plan in REVIEW and clear acceptShrink on PLAN_SUCCESS", () => {
      // Arrange
      const reviewed = plan({ requiresAcceptShrink: true });

      // Act
      const next = reduce(state({ phase: FlowPhase.PLANNING, files: [FILE], acceptShrink: true }), {
        type: Action.PLAN_SUCCESS,
        plan: reviewed,
      });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.REVIEW, plan: reviewed, acceptShrink: false });
    });

    it("should return to FILES with the message on PLAN_FAILURE", () => {
      // Arrange & Act
      const next = reduce(state({ phase: FlowPhase.PLANNING, files: [FILE] }), { type: Action.PLAN_FAILURE, message: "sin red" });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, error: "sin red" });
    });

    it.each([FlowPhase.FILES, FlowPhase.REVIEW, FlowPhase.LOADING, FlowPhase.DONE])(
      "should ignore PLAN_SUCCESS and PLAN_FAILURE outside PLANNING (%s)",
      (phase) => {
        // Arrange
        const start = state({ phase });

        // Act
        const next = reduce(start, { type: Action.PLAN_SUCCESS, plan: plan() }, { type: Action.PLAN_FAILURE, message: "x" });

        // Assert
        expect(next).toBe(start);
      }
    );
  });

  describe("accept shrink", () => {
    it("should record the checkbox in REVIEW", () => {
      // Arrange & Act
      const ticked = reduce(inReview(), { type: Action.SET_ACCEPT_SHRINK, value: true });
      const unticked = reduce(ticked, { type: Action.SET_ACCEPT_SHRINK, value: false });

      // Assert
      expect(ticked.acceptShrink).toBe(true);
      expect(unticked.acceptShrink).toBe(false);
    });

    it.each([FlowPhase.FILES, FlowPhase.PLANNING, FlowPhase.LOADING, FlowPhase.DONE])(
      "should ignore the checkbox outside REVIEW (%s)",
      (phase) => {
        // Arrange
        const start = state({ phase });

        // Act & Assert
        expect(reduce(start, { type: Action.SET_ACCEPT_SHRINK, value: true })).toBe(start);
      }
    );
  });

  describe("LOAD_START: the two-step rule", () => {
    it("should start loading from a loadable reviewed plan", () => {
      // Arrange & Act
      const next = reduce(inReview({ error: "x" }), { type: Action.LOAD_START });

      // Assert
      expect(next.phase).toBe(FlowPhase.LOADING);
      expect(next.error).toBeNull();
    });

    it.each([FlowPhase.FILES, FlowPhase.PLANNING, FlowPhase.LOADING, FlowPhase.DONE])(
      "should be a no-op outside REVIEW (%s), even with a loadable plan in the state",
      (phase) => {
        // Arrange
        const start = state({ phase, files: [FILE], plan: plan() });

        // Act & Assert
        expect(reduce(start, { type: Action.LOAD_START })).toBe(start);
      }
    );

    it("should be a no-op in REVIEW without a plan", () => {
      // Arrange
      const start = inReview({ plan: null });

      // Act & Assert
      expect(reduce(start, { type: Action.LOAD_START })).toBe(start);
    });

    it("should be a no-op when the plan says canLoad is false", () => {
      // Arrange
      const start = inReview({ plan: plan({ canLoad: false, blockers: ["mal"] }) });

      // Act & Assert
      expect(reduce(start, { type: Action.LOAD_START })).toBe(start);
    });

    it("should be a no-op when the plan requires accepting a shrink and the box is unticked", () => {
      // Arrange
      const start = inReview({ plan: plan({ requiresAcceptShrink: true }), acceptShrink: false });

      // Act & Assert
      expect(reduce(start, { type: Action.LOAD_START })).toBe(start);
    });

    it("should start loading when the plan requires accepting a shrink and the box is ticked", () => {
      // Arrange
      const start = inReview({ plan: plan({ requiresAcceptShrink: true }) });

      // Act
      const next = reduce(start, { type: Action.SET_ACCEPT_SHRINK, value: true }, { type: Action.LOAD_START });

      // Assert
      expect(next.phase).toBe(FlowPhase.LOADING);
    });

    it("should ignore a ticked box when the plan does not need it", () => {
      // Arrange
      const start = inReview({ acceptShrink: true });

      // Act & Assert
      expect(canLoad(start)).toBe(true);
    });
  });

  describe("LOAD_SUCCESS / LOAD_FAILURE", () => {
    it("should finish with the result on LOAD_SUCCESS", () => {
      // Arrange & Act
      const next = reduce(state({ phase: FlowPhase.LOADING, plan: plan() }), { type: Action.LOAD_SUCCESS, result: RESULT });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.DONE, result: RESULT });
    });

    it("should return to REVIEW with the message on LOAD_FAILURE, keeping the plan and the box", () => {
      // Arrange
      const reviewed = plan({ requiresAcceptShrink: true });
      const start = state({ phase: FlowPhase.LOADING, plan: reviewed, acceptShrink: true });

      // Act
      const next = reduce(start, { type: Action.LOAD_FAILURE, message: "falló" });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.REVIEW, error: "falló", plan: reviewed, acceptShrink: true });
    });

    it("should swap in the 409 plan on LOAD_FAILURE and untick the box", () => {
      // Arrange
      const stale = plan({ requiresAcceptShrink: false });
      const fresh = plan({ requiresAcceptShrink: true, canLoad: true });
      const start = state({ phase: FlowPhase.LOADING, plan: stale, acceptShrink: true });

      // Act
      const next = reduce(start, { type: Action.LOAD_FAILURE, message: "409", plan: fresh });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.REVIEW, plan: fresh, acceptShrink: false, error: "409" });
      expect(canLoad(next)).toBe(false);
    });

    it.each([FlowPhase.FILES, FlowPhase.PLANNING, FlowPhase.REVIEW, FlowPhase.DONE])(
      "should ignore LOAD_SUCCESS and LOAD_FAILURE outside LOADING (%s)",
      (phase) => {
        // Arrange
        const start = state({ phase });

        // Act
        const next = reduce(start, { type: Action.LOAD_SUCCESS, result: RESULT }, { type: Action.LOAD_FAILURE, message: "x", plan: plan() });

        // Assert
        expect(next).toBe(start);
      }
    );
  });

  describe("RESTART", () => {
    it("should clear files, plan and result and go back to FILES, only from DONE", () => {
      // Arrange
      const start = state({ phase: FlowPhase.DONE, files: [FILE], plan: plan(), result: RESULT, acceptShrink: true });

      // Act
      const next = reduce(start, { type: Action.RESTART });

      // Assert
      expect(next).toMatchObject({ phase: FlowPhase.FILES, files: [], plan: null, result: null, acceptShrink: false });
    });

    it.each([FlowPhase.FILES, FlowPhase.PLANNING, FlowPhase.REVIEW, FlowPhase.LOADING])(
      "should be ignored outside DONE (%s)",
      (phase) => {
        // Arrange
        const start = state({ phase });

        // Act & Assert
        expect(reduce(start, { type: Action.RESTART })).toBe(start);
      }
    );
  });

  describe("selectors", () => {
    it("should be busy only while planning or loading", () => {
      // Arrange, Act & Assert
      expect(Object.values(FlowPhase).filter((phase) => isBusy(state({ phase })))).toEqual([FlowPhase.PLANNING, FlowPhase.LOADING]);
    });

    it("should allow reviewing only from FILES with at least one file", () => {
      // Arrange, Act & Assert
      expect(canReview(state({ phase: FlowPhase.FILES, files: [FILE] }))).toBe(true);
      expect(canReview(state({ phase: FlowPhase.FILES }))).toBe(false);
      expect(canReview(state({ phase: FlowPhase.REVIEW, files: [FILE] }))).toBe(false);
    });

    it("should allow loading only from a loadable plan in REVIEW", () => {
      // Arrange, Act & Assert
      expect(canLoad(inReview())).toBe(true);
      expect(canLoad(inReview({ plan: null }))).toBe(false);
      expect(canLoad(inReview({ plan: plan({ canLoad: false }) }))).toBe(false);
      expect(canLoad(inReview({ plan: plan({ requiresAcceptShrink: true }) }))).toBe(false);
      expect(canLoad(inReview({ plan: plan({ requiresAcceptShrink: true }), acceptShrink: true }))).toBe(true);
      expect(canLoad(state({ phase: FlowPhase.LOADING, plan: plan() }))).toBe(false);
    });
  });
});
