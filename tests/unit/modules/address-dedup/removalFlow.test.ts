import { describe, expect, it } from "vitest";
import {
  canExecute,
  canSimulate,
  INITIAL_REMOVAL_FLOW,
  RemovalFlowActionType,
  removalFlowReducer,
  type RemovalFlowAction,
  type RemovalFlowState,
} from "@/modules/address-dedup/domain/removalFlow";
import { RemovalBlockReason, RemovalPhase } from "@/modules/address-dedup/removalConstants";
import type { RemovalSimulationPayload } from "@/modules/address-dedup/removalTypes";
import { COUNTS, FINGERPRINT, OPERATION_ID, PLAN, RESULT } from "./fakeRemovalRepository";

const SIMULATION: RemovalSimulationPayload = {
  fingerprint: PLAN.fingerprint,
  counts: PLAN.counts,
  blockers: [],
  targets: PLAN.targets,
};

function run(actions: ReadonlyArray<RemovalFlowAction>, from: RemovalFlowState = INITIAL_REMOVAL_FLOW): RemovalFlowState {
  return actions.reduce(removalFlowReducer, from);
}

const OPEN: RemovalFlowAction = { type: RemovalFlowActionType.OPEN, operationId: OPERATION_ID };
const FILL: ReadonlyArray<RemovalFlowAction> = [
  { type: RemovalFlowActionType.SET_RESPONSABLE, value: "operador" },
  { type: RemovalFlowActionType.SET_MOTIVO, value: "baja" },
];
const SIMULATE_START: RemovalFlowAction = { type: RemovalFlowActionType.SIMULATE_START };
const EXECUTE_START: RemovalFlowAction = { type: RemovalFlowActionType.EXECUTE_START };

function reviewed(plan: RemovalSimulationPayload = SIMULATION): RemovalFlowState {
  return run([OPEN, ...FILL, SIMULATE_START, { type: RemovalFlowActionType.SIMULATE_SUCCESS, plan }]);
}

describe("removal flow", () => {
  describe("the two explicit steps", () => {
    it("should start closed and open on the form with the operation id", () => {
      // Arrange & Act
      const state = run([OPEN]);

      // Assert
      expect(INITIAL_REMOVAL_FLOW.phase).toBe(RemovalPhase.CLOSED);
      expect(state.phase).toBe(RemovalPhase.FORM);
      expect(state.operationId).toBe(OPERATION_ID);
    });

    it("should not allow executing straight from the form, with or without a filled form", () => {
      // Arrange
      const filled = run([OPEN, ...FILL]);

      // Act
      const afterAttempt = removalFlowReducer(filled, EXECUTE_START);

      // Assert
      expect(canExecute(filled)).toBe(false);
      expect(afterAttempt).toBe(filled);
      expect(afterAttempt.phase).toBe(RemovalPhase.FORM);
    });

    it("should only reach the review step through a simulation", () => {
      // Arrange & Act
      const state = reviewed();

      // Assert
      expect(state.phase).toBe(RemovalPhase.REVIEW);
      expect(state.plan).toEqual(SIMULATION);
      expect(canExecute(state)).toBe(true);
    });

    it("should execute only from the review step and finish with the result", () => {
      // Arrange
      const executing = removalFlowReducer(reviewed(), EXECUTE_START);

      // Act
      const done = removalFlowReducer(executing, { type: RemovalFlowActionType.EXECUTE_SUCCESS, result: RESULT });

      // Assert
      expect(executing.phase).toBe(RemovalPhase.EXECUTING);
      expect(done.phase).toBe(RemovalPhase.DONE);
      expect(done.result).toBe(RESULT);
    });

    it("should ignore a second execute while one is running", () => {
      // Arrange
      const executing = removalFlowReducer(reviewed(), EXECUTE_START);

      // Act
      const again = removalFlowReducer(executing, EXECUTE_START);

      // Assert
      expect(again).toBe(executing);
    });

    it("should ignore a success that arrives in the wrong phase", () => {
      // Arrange
      const formState = run([OPEN]);

      // Act
      const after = removalFlowReducer(formState, { type: RemovalFlowActionType.EXECUTE_SUCCESS, result: RESULT });

      // Assert
      expect(after).toBe(formState);
    });
  });

  describe("simulating", () => {
    it.each([
      ["responsable", [{ type: RemovalFlowActionType.SET_MOTIVO, value: "baja" }] as const],
      ["motivo", [{ type: RemovalFlowActionType.SET_RESPONSABLE, value: "operador" }] as const],
      ["both", [] as const],
    ])("should not simulate while %s is missing", (_missing, partial) => {
      // Arrange
      const state = run([OPEN, ...partial]);

      // Act
      const after = removalFlowReducer(state, SIMULATE_START);

      // Assert
      expect(canSimulate(state)).toBe(false);
      expect(after).toBe(state);
    });

    it("should treat whitespace-only inputs as missing", () => {
      // Arrange
      const state = run([
        OPEN,
        { type: RemovalFlowActionType.SET_RESPONSABLE, value: "   " },
        { type: RemovalFlowActionType.SET_MOTIVO, value: "\t" },
      ]);

      // Act & Assert
      expect(canSimulate(state)).toBe(false);
    });

    it("should return to the form with the message when the simulation fails", () => {
      // Arrange
      const simulating = run([OPEN, ...FILL, SIMULATE_START]);

      // Act
      const failed = removalFlowReducer(simulating, { type: RemovalFlowActionType.SIMULATE_FAILURE, message: "sin conexión" });

      // Assert
      expect(simulating.phase).toBe(RemovalPhase.SIMULATING);
      expect(failed.phase).toBe(RemovalPhase.FORM);
      expect(failed.error).toBe("sin conexión");
      expect(failed.responsable).toBe("operador");
    });

    it("should freeze the form inputs once the simulation started", () => {
      // Arrange
      const simulating = run([OPEN, ...FILL, SIMULATE_START]);

      // Act
      const after = removalFlowReducer(simulating, { type: RemovalFlowActionType.SET_MOTIVO, value: "otro" });

      // Assert
      expect(after).toBe(simulating);
    });
  });

  describe("blocked and empty plans", () => {
    it("should never allow executing a plan that has blockers", () => {
      // Arrange
      const blocked = reviewed({
        ...SIMULATION,
        blockers: [{ urn: "u", reasons: [{ code: RemovalBlockReason.MASTER_SHARED, detail: null }] }],
      });

      // Act
      const after = removalFlowReducer(blocked, EXECUTE_START);

      // Assert
      expect(canExecute(blocked)).toBe(false);
      expect(after).toBe(blocked);
    });

    it("should never allow executing a plan with no targets", () => {
      // Arrange
      const empty = reviewed({ ...SIMULATION, counts: { ...COUNTS, total: 0 } });

      // Act & Assert
      expect(canExecute(empty)).toBe(false);
    });
  });

  describe("failures and restarts", () => {
    it("should return to review with the message, and keep the plan and operation id, when execution fails", () => {
      // Arrange
      const executing = removalFlowReducer(reviewed(), EXECUTE_START);

      // Act
      const failed = removalFlowReducer(executing, { type: RemovalFlowActionType.EXECUTE_FAILURE, message: "Cambió el alcance" });

      // Assert
      expect(failed.phase).toBe(RemovalPhase.REVIEW);
      expect(failed.error).toBe("Cambió el alcance");
      expect(failed.plan).toEqual(SIMULATION);
      expect(failed.operationId).toBe(OPERATION_ID);
      expect(canExecute(failed)).toBe(true);
    });

    it("should drop the reviewed plan and take a new operation id on restart", () => {
      // Arrange
      const review = reviewed();

      // Act
      const restarted = removalFlowReducer(review, { type: RemovalFlowActionType.RESTART, operationId: "another-id" });

      // Assert
      expect(restarted.phase).toBe(RemovalPhase.FORM);
      expect(restarted.plan).toBeNull();
      expect(restarted.operationId).toBe("another-id");
      expect(restarted.responsable).toBe("operador");
      expect(canExecute(restarted)).toBe(false);
    });

    it("should not close while a request is in flight, and reset fully when closed otherwise", () => {
      // Arrange
      const executing = removalFlowReducer(reviewed(), EXECUTE_START);

      // Act
      const stillExecuting = removalFlowReducer(executing, { type: RemovalFlowActionType.CLOSE });
      const closed = removalFlowReducer(reviewed(), { type: RemovalFlowActionType.CLOSE });

      // Assert
      expect(stillExecuting).toBe(executing);
      expect(closed).toEqual(INITIAL_REMOVAL_FLOW);
    });

    it("should start a reopened dialog clean, with a fresh operation id and no old plan or result", () => {
      // Arrange
      const done = removalFlowReducer(removalFlowReducer(reviewed(), EXECUTE_START), {
        type: RemovalFlowActionType.EXECUTE_SUCCESS,
        result: RESULT,
      });

      // Act
      const reopened = removalFlowReducer(done, { type: RemovalFlowActionType.OPEN, operationId: FINGERPRINT });

      // Assert
      expect(reopened.plan).toBeNull();
      expect(reopened.result).toBeNull();
      expect(reopened.responsable).toBe("");
      expect(reopened.operationId).toBe(FINGERPRINT);
    });
  });
});
