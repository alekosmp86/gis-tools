import { describe, expect, it } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { SigraFlowActionType, type SigraFlowAction } from "@/modules/coverage-loads/sigra-layers/domain/sigraFlow";
import {
  loadLayersInOrder,
  type LayerLoadAnswer,
  type LoadLayersDependencies,
} from "@/modules/coverage-loads/sigra-layers/ui/loadLayersInOrder";
import { LayerLoadStatus, LayerLoadStep, type LayerLoadResult } from "@/modules/coverage-loads/sigra-layers/types";

const [FIRST, SECOND, THIRD] = [SigraLayerId.ZONAS_FTTH, SigraLayerId.LIMITE_CENTRAL_FTTH, SigraLayerId.POSTES];

function resultOf(layerId: SigraLayerId, overrides: Partial<LayerLoadResult> = {}): LayerLoadResult {
  return {
    layerId,
    status: LayerLoadStatus.LOADED,
    downloaded: 1,
    staged: 1,
    duplicatesIgnored: 0,
    previousCount: 1,
    finalCount: 1,
    elapsedMs: 1,
    step: null,
    message: "ok",
    auditWarning: null,
    ...overrides,
  };
}

const answerOf = (layerId: SigraLayerId, dryRun: boolean, overrides: Partial<LayerLoadResult> = {}): LayerLoadAnswer => ({
  results: [resultOf(layerId, overrides)],
  dryRun,
});

interface Rig {
  readonly dependencies: LoadLayersDependencies;
  readonly calls: Array<{ layerIds: ReadonlyArray<SigraLayerId>; dryRun: boolean }>;
  readonly dispatched: SigraFlowAction[];
  readonly maxInFlight: () => number;
}

interface RigOptions {
  /** Answer for the nth call (0-based); an Error rejects. Defaults to a loaded result of the requested layer. */
  readonly answers?: ReadonlyArray<LayerLoadAnswer | Error>;
  /** `isCurrent` result for the nth evaluation (0-based); true when not listed. */
  readonly current?: ReadonlyArray<boolean>;
}

function createRig(options: RigOptions = {}): Rig {
  const calls: Rig["calls"] = [];
  const dispatched: SigraFlowAction[] = [];
  let inFlight = 0;
  let peak = 0;
  let evaluations = 0;
  const dependencies: LoadLayersDependencies = {
    runLoad: async (layerIds, dryRun) => {
      const index = calls.length;
      calls.push({ layerIds, dryRun });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      const scripted = options.answers?.[index];
      if (scripted instanceof Error) throw scripted;
      return scripted ?? answerOf(layerIds[0], dryRun);
    },
    isCurrent: () => options.current?.[evaluations++] ?? true,
    dispatch: (action) => {
      dispatched.push(action);
    },
  };
  return { dependencies, calls, dispatched, maxInFlight: () => peak };
}

const layerDone = (result: LayerLoadResult, dryRun: boolean): SigraFlowAction => ({
  type: SigraFlowActionType.RUN_LAYER_DONE,
  result,
  dryRun,
});

describe("loadLayersInOrder", () => {
  describe("the normal run", () => {
    it("should make one runLoad call per id, in the given order, each with a single id", async () => {
      // Arrange
      const rig = createRig();

      // Act
      await loadLayersInOrder([THIRD, FIRST, SECOND], false, rig.dependencies);

      // Assert
      expect(rig.calls).toEqual([
        { layerIds: [THIRD], dryRun: false },
        { layerIds: [FIRST], dryRun: false },
        { layerIds: [SECOND], dryRun: false },
      ]);
    });

    it("should never have two requests in flight", async () => {
      // Arrange
      const rig = createRig();

      // Act
      await loadLayersInOrder([FIRST, SECOND, THIRD], true, rig.dependencies);

      // Assert
      expect(rig.maxInFlight()).toBe(1);
    });

    it("should dispatch RUN_LAYER_DONE per result, in order, carrying the dryRun of the answer", async () => {
      // Arrange
      const rig = createRig({ answers: [answerOf(FIRST, false), answerOf(SECOND, false)] });

      // Act
      await loadLayersInOrder([FIRST, SECOND], false, rig.dependencies);

      // Assert
      expect(rig.dispatched).toEqual([layerDone(resultOf(FIRST), false), layerDone(resultOf(SECOND), false)]);
    });

    it("should use the dryRun flag of the answer, not the requested one", async () => {
      // Arrange
      const rig = createRig({ answers: [answerOf(FIRST, true)] });

      // Act
      await loadLayersInOrder([FIRST], false, rig.dependencies);

      // Assert
      expect(rig.dispatched).toEqual([layerDone(resultOf(FIRST), true)]);
    });

    it("should dispatch every result of an answer that carries several, in order", async () => {
      // Arrange
      const answer: LayerLoadAnswer = { results: [resultOf(FIRST), resultOf(SECOND)], dryRun: false };
      const rig = createRig({ answers: [answer] });

      // Act
      await loadLayersInOrder([FIRST], false, rig.dependencies);

      // Assert
      expect(rig.dispatched).toEqual([layerDone(resultOf(FIRST), false), layerDone(resultOf(SECOND), false)]);
    });

    it("should return true after the last layer", async () => {
      // Arrange
      const rig = createRig();

      // Act
      const completed = await loadLayersInOrder([FIRST, SECOND], false, rig.dependencies);

      // Assert
      expect(completed).toBe(true);
    });

    it("should pass dryRun=true to every call of a dry run", async () => {
      // Arrange
      const rig = createRig();

      // Act
      await loadLayersInOrder([FIRST, SECOND], true, rig.dependencies);

      // Assert
      expect(rig.calls.every((call) => call.dryRun)).toBe(true);
    });
  });

  describe("an empty list", () => {
    it("should return true with no call and no dispatch", async () => {
      // Arrange
      const rig = createRig();

      // Act
      const completed = await loadLayersInOrder([], false, rig.dependencies);

      // Assert
      expect(completed).toBe(true);
      expect(rig.calls).toEqual([]);
      expect(rig.dispatched).toEqual([]);
    });
  });

  describe("a layer that failed or was rejected", () => {
    it.each([LayerLoadStatus.FAILED, LayerLoadStatus.REJECTED_VALIDATION])(
      "should dispatch the %s answer as a normal one and carry on with the next layer",
      async (status) => {
        // Arrange
        const bad = answerOf(FIRST, false, { status, step: LayerLoadStep.WFS, finalCount: null, message: "caída" });
        const rig = createRig({ answers: [bad, answerOf(SECOND, false)] });

        // Act
        const completed = await loadLayersInOrder([FIRST, SECOND], false, rig.dependencies);

        // Assert
        expect(completed).toBe(true);
        expect(rig.calls).toHaveLength(2);
        expect(rig.dispatched).toEqual([layerDone(bad.results[0], false), layerDone(resultOf(SECOND), false)]);
      }
    );
  });

  describe("a stale run (isCurrent turns false)", () => {
    it("should stop after the first answer without dispatching it nor requesting the next layer", async () => {
      // Arrange
      const rig = createRig({ current: [false] });

      // Act
      const completed = await loadLayersInOrder([FIRST, SECOND, THIRD], false, rig.dependencies);

      // Assert
      expect(completed).toBe(false);
      expect(rig.calls).toHaveLength(1);
      expect(rig.dispatched).toEqual([]);
    });

    it("should dispatch the first answer, then stop after the second without dispatching it", async () => {
      // Arrange
      const rig = createRig({ current: [true, false] });

      // Act
      const completed = await loadLayersInOrder([FIRST, SECOND, THIRD], false, rig.dependencies);

      // Assert
      expect(completed).toBe(false);
      expect(rig.calls).toHaveLength(2);
      expect(rig.dispatched).toEqual([layerDone(resultOf(FIRST), false)]);
    });

    it("should evaluate isCurrent after each await, once per answer", async () => {
      // Arrange
      let evaluations = 0;
      const rig = createRig();
      const dependencies: LoadLayersDependencies = {
        ...rig.dependencies,
        isCurrent: () => {
          evaluations += 1;
          return rig.calls.length === evaluations;
        },
      };

      // Act
      const completed = await loadLayersInOrder([FIRST, SECOND, THIRD], false, dependencies);

      // Assert
      expect(completed).toBe(true);
      expect(evaluations).toBe(3);
    });
  });

  describe("a request that throws", () => {
    it("should reject with the same error after the earlier layers were already dispatched", async () => {
      // Arrange
      const failure = new Error("sin conexión");
      const rig = createRig({ answers: [answerOf(FIRST, false), failure] });

      // Act
      const attempt = loadLayersInOrder([FIRST, SECOND, THIRD], false, rig.dependencies);

      // Assert
      await expect(attempt).rejects.toBe(failure);
      expect(rig.dispatched).toEqual([layerDone(resultOf(FIRST), false)]);
      expect(rig.calls).toHaveLength(2);
    });

    it("should reject on the very first layer without dispatching anything", async () => {
      // Arrange
      const rig = createRig({ answers: [new Error("boom")] });

      // Act
      const attempt = loadLayersInOrder([FIRST, SECOND], false, rig.dependencies);

      // Assert
      await expect(attempt).rejects.toThrow("boom");
      expect(rig.dispatched).toEqual([]);
      expect(rig.calls).toHaveLength(1);
    });
  });
});
