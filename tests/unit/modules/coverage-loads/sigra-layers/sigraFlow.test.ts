import { describe, expect, it } from "vitest";
import { REQUIRED_LAYER_IDS, SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { SIGRA_LAYERS, getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import {
  SigraFlowActionType as Action,
  SigraFlowPhase,
  canRunSelection,
  createInitialSigraFlow,
  requiredLayersLoaded,
  sigraFlowReducer,
  stageProgressOf,
  type SigraFlowState,
} from "@/modules/coverage-loads/sigra-layers/domain/sigraFlow";
import {
  LayerLoadStatus,
  LayerLoadStep,
  type LayerLoadResult,
  type PlanLayer,
  type SigraPlan,
} from "@/modules/coverage-loads/sigra-layers/types";
import { StageStatus } from "@/modules/coverage-loads/shared/domain/stageContract";

type FlowAction = Parameters<typeof sigraFlowReducer>[1];

const ALL_IDS = SIGRA_LAYERS.map((layer) => layer.id);
const [ZONAS, LIMITE] = REQUIRED_LAYER_IDS;
const OPTIONAL_A = SigraLayerId.AREA_CD_SR;
const OPTIONAL_B = SigraLayerId.CAMARAS;

function planLayer(layerId: SigraLayerId, overrides: Partial<PlanLayer> = {}): PlanLayer {
  const definition = getSigraLayer(layerId);
  return {
    layerId,
    label: definition.label,
    required: definition.required,
    tableExists: true,
    rowCount: 10,
    lastUpdated: "2026-10-01",
    missingPrivileges: [],
    wfsCount: 10,
    wfsError: null,
    blockers: [],
    canLoad: true,
    ...overrides,
  };
}

function planOf(overrides: Record<string, Partial<PlanLayer>> = {}): SigraPlan {
  return {
    layers: ALL_IDS.map((id) => planLayer(id, overrides[id])),
    blockers: [],
    warnings: [],
    canLoad: true,
  };
}

function resultOf(layerId: SigraLayerId, overrides: Partial<LayerLoadResult> = {}): LayerLoadResult {
  return {
    layerId,
    status: LayerLoadStatus.LOADED,
    downloaded: 10,
    staged: 10,
    duplicatesIgnored: 0,
    previousCount: 8,
    finalCount: 10,
    elapsedMs: 5,
    step: null,
    message: "ok",
    auditWarning: null,
    ...overrides,
  };
}

function reduce(start: SigraFlowState, ...actions: FlowAction[]): SigraFlowState {
  return actions.reduce(sigraFlowReducer, start);
}

function ready(plan: SigraPlan = planOf()): SigraFlowState {
  return reduce(createInitialSigraFlow(), { type: Action.PLAN_SUCCEEDED, plan });
}

function running(dryRun = false): SigraFlowState {
  return reduce(ready(), { type: Action.RUN_REQUESTED, dryRun });
}

function finishedRun(results: ReadonlyArray<LayerLoadResult>, dryRun: boolean): FlowAction[] {
  return [...results.map((result): FlowAction => ({ type: Action.RUN_LAYER_DONE, result, dryRun })), { type: Action.RUN_FINISHED }];
}

function registryOrder(ids: ReadonlyArray<SigraLayerId>): SigraLayerId[] {
  return ALL_IDS.filter((id) => ids.includes(id));
}

const loadedRequired = (): LayerLoadResult[] => [resultOf(ZONAS), resultOf(LIMITE)];

describe("sigraFlow", () => {
  describe("constants", () => {
    it("should name the phases with string values equal to their keys", () => {
      // Arrange & Act & Assert
      expect(SigraFlowPhase).toEqual({
        PLANNING: "PLANNING",
        READY: "READY",
        RUNNING: "RUNNING",
        PLAN_FAILED: "PLAN_FAILED",
      });
    });
  });

  describe("createInitialSigraFlow", () => {
    it("should start planning with only the required layers selected and nothing else", () => {
      // Arrange & Act
      const state = createInitialSigraFlow();

      // Assert
      expect(state).toEqual({
        phase: SigraFlowPhase.PLANNING,
        selection: [ZONAS, LIMITE],
        plan: null,
        results: [],
        lastRunDryRun: null,
        loaded: {},
        error: null,
      });
    });

    it("should return an independent state on every call", () => {
      // Arrange & Act
      const first = createInitialSigraFlow();
      const second = createInitialSigraFlow();

      // Assert
      expect(first).toEqual(second);
      expect(first.selection).not.toBe(second.selection);
    });
  });

  describe("TOGGLE_LAYER", () => {
    it("should add an optional layer", () => {
      // Arrange & Act
      const next = reduce(ready(), { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A });

      // Assert
      expect(next.selection).toEqual(registryOrder([ZONAS, LIMITE, OPTIONAL_A]));
    });

    it("should remove an optional layer that was selected", () => {
      // Arrange
      const start = reduce(ready(), { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A });

      // Act
      const next = reduce(start, { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A });

      // Assert
      expect(next.selection).toEqual([ZONAS, LIMITE]);
    });

    it("should keep the selection in registry order whatever the click order", () => {
      // Arrange & Act
      const next = reduce(
        ready(),
        { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_B },
        { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A }
      );

      // Assert
      expect(next.selection).toEqual(registryOrder([ZONAS, LIMITE, OPTIONAL_A, OPTIONAL_B]));
    });

    it.each(REQUIRED_LAYER_IDS)("should never remove the required layer %s", (layerId) => {
      // Arrange
      const start = ready();

      // Act
      const next = reduce(start, { type: Action.TOGGLE_LAYER, layerId });

      // Assert
      expect(next.selection).toEqual([ZONAS, LIMITE]);
    });

    it("should be ignored while RUNNING", () => {
      // Arrange
      const start = running();

      // Act
      const next = reduce(start, { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A });

      // Assert
      expect(next.selection).toEqual(start.selection);
      expect(next.phase).toBe(SigraFlowPhase.RUNNING);
    });
  });

  describe("SELECT_ALL and SELECT_REQUIRED_ONLY", () => {
    it("should select all 18 layers in registry order", () => {
      // Arrange & Act
      const next = reduce(ready(), { type: Action.SELECT_ALL });

      // Assert
      expect(next.selection).toHaveLength(18);
      expect(next.selection).toEqual(ALL_IDS);
    });

    it("should ignore SELECT_ALL while RUNNING", () => {
      // Arrange
      const start = running();

      // Act
      const next = reduce(start, { type: Action.SELECT_ALL });

      // Assert
      expect(next.selection).toEqual([ZONAS, LIMITE]);
    });

    it("should leave exactly the required layers on SELECT_REQUIRED_ONLY", () => {
      // Arrange
      const start = reduce(ready(), { type: Action.SELECT_ALL });

      // Act
      const next = reduce(start, { type: Action.SELECT_REQUIRED_ONLY });

      // Assert
      expect(next.selection).toEqual([ZONAS, LIMITE]);
    });
  });

  describe("plan actions", () => {
    it("should move to READY with the plan and no error on PLAN_SUCCEEDED", () => {
      // Arrange
      const plan = planOf();
      const failed = reduce(createInitialSigraFlow(), { type: Action.PLAN_FAILED, error: "boom" });

      // Act
      const next = reduce(failed, { type: Action.PLAN_SUCCEEDED, plan });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.READY);
      expect(next.plan).toBe(plan);
      expect(next.error).toBeNull();
    });

    it("should move to PLAN_FAILED with the error on PLAN_FAILED", () => {
      // Arrange & Act
      const next = reduce(createInitialSigraFlow(), { type: Action.PLAN_FAILED, error: "No se pudo conectar" });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.PLAN_FAILED);
      expect(next.error).toBe("No se pudo conectar");
    });

    it("should go back to PLANNING keeping selection, results and loaded and clearing the error", () => {
      // Arrange
      const withRun = reduce(
        running(),
        ...finishedRun(loadedRequired(), false),
        { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A },
        { type: Action.PLAN_FAILED, error: "boom" }
      );

      // Act
      const next = reduce(withRun, { type: Action.PLAN_REQUESTED });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.PLANNING);
      expect(next.error).toBeNull();
      expect(next.selection).toEqual(withRun.selection);
      expect(next.results).toEqual(withRun.results);
      expect(next.loaded).toEqual(withRun.loaded);
    });
  });

  describe("RUN_REQUESTED", () => {
    it.each([true, false])("should start RUNNING from READY storing dryRun=%s and clearing error and results", (dryRun) => {
      // Arrange
      const start = reduce(
        ready(),
        { type: Action.RUN_REQUESTED, dryRun: true },
        { type: Action.RUN_FAILED, error: "viejo" }
      );

      // Act
      const next = reduce(start, { type: Action.RUN_REQUESTED, dryRun });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.RUNNING);
      expect(next.lastRunDryRun).toBe(dryRun);
      expect(next.error).toBeNull();
      expect(next.results).toEqual([]);
    });

    it("should clear the results of the previous run", () => {
      // Arrange
      const start = reduce(running(), ...finishedRun(loadedRequired(), false));

      // Act
      const next = reduce(start, { type: Action.RUN_REQUESTED, dryRun: true });

      // Assert
      expect(next.results).toEqual([]);
      expect(next.loaded[ZONAS]).toEqual(resultOf(ZONAS));
    });

    it.each([SigraFlowPhase.PLANNING, SigraFlowPhase.PLAN_FAILED, SigraFlowPhase.RUNNING])(
      "should be ignored from %s",
      (phase) => {
        // Arrange
        const start: SigraFlowState = { ...ready(), phase };

        // Act & Assert
        expect(reduce(start, { type: Action.RUN_REQUESTED, dryRun: false })).toBe(start);
      }
    );

    it("should be ignored when the selection is empty", () => {
      // Arrange
      const start: SigraFlowState = { ...ready(), selection: [] };

      // Act & Assert
      expect(reduce(start, { type: Action.RUN_REQUESTED, dryRun: false })).toBe(start);
    });
  });

  describe("RUN_FAILED", () => {
    it("should return to READY with the error and no results", () => {
      // Arrange & Act
      const next = reduce(running(), { type: Action.RUN_FAILED, error: "Se perdió la conexión" });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.READY);
      expect(next.error).toBe("Se perdió la conexión");
      expect(next.results).toEqual([]);
    });

    it("should keep the current plan", () => {
      // Arrange
      const start = running();

      // Act
      const next = reduce(start, { type: Action.RUN_FAILED, error: "x" });

      // Assert
      expect(next.plan).toBe(start.plan);
    });
  });

  describe("per-layer runs (RUN_LAYER_DONE and RUN_FINISHED)", () => {
    const layerDone = (result: LayerLoadResult, dryRun: boolean): FlowAction => ({ type: Action.RUN_LAYER_DONE, result, dryRun });
    const failedResult = (layerId: SigraLayerId): LayerLoadResult =>
      resultOf(layerId, { status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS, finalCount: null, message: "caída" });

    it("should append each layer result, stay RUNNING and record loaded ones in loaded during a real run", () => {
      // Arrange
      const first = resultOf(ZONAS);

      // Act
      const next = reduce(running(), layerDone(first, false));

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.RUNNING);
      expect(next.results).toEqual([first]);
      expect(next.loaded[ZONAS]).toEqual(first);
      expect(next.lastRunDryRun).toBe(false);
    });

    it("should keep the order of arrival in results", () => {
      // Arrange
      const results = [resultOf(LIMITE), resultOf(ZONAS), resultOf(OPTIONAL_A)];

      // Act
      const next = reduce(running(), ...results.map((result) => layerDone(result, false)));

      // Assert
      expect(next.results).toEqual(results);
    });

    it("should replace an earlier loaded entry of the same layer", () => {
      // Arrange
      const newer = resultOf(ZONAS, { finalCount: 77 });
      const start = reduce(running(), layerDone(resultOf(ZONAS), false));

      // Act
      const next = reduce(start, layerDone(newer, false));

      // Assert
      expect(next.loaded[ZONAS]).toEqual(newer);
    });

    it("should never record a dry-run result in loaded, not even one whose status is loaded", () => {
      // Arrange
      const dry = resultOf(ZONAS, { status: LayerLoadStatus.DRY_RUN_OK });
      const odd = resultOf(LIMITE, { status: LayerLoadStatus.LOADED });

      // Act
      const next = reduce(running(true), layerDone(dry, true), layerDone(odd, true));

      // Assert
      expect(next.loaded).toEqual({});
      expect(next.results).toEqual([dry, odd]);
      expect(next.lastRunDryRun).toBe(true);
    });

    it.each([LayerLoadStatus.FAILED, LayerLoadStatus.REJECTED_VALIDATION])(
      "should never record a %s result in loaded nor remove an earlier loaded entry",
      (status) => {
        // Arrange
        const earlier = resultOf(ZONAS);
        const start = reduce(running(), layerDone(earlier, false));
        const bad = resultOf(ZONAS, { status, step: LayerLoadStep.VALIDATION, finalCount: null });

        // Act
        const next = reduce(start, layerDone(bad, false));

        // Assert
        expect(next.loaded[ZONAS]).toEqual(earlier);
        expect(next.results).toEqual([earlier, bad]);
      }
    );

    it("should record only the loaded layers of a mixed real run", () => {
      // Arrange
      const mixed = [resultOf(ZONAS), resultOf(LIMITE, { status: LayerLoadStatus.FAILED, step: LayerLoadStep.SWAP })];

      // Act
      const next = reduce(running(), ...finishedRun(mixed, false));

      // Assert
      expect(Object.keys(next.loaded)).toEqual([ZONAS]);
      expect(next.results).toEqual(mixed);
    });

    it("should leave loaded untouched after a dry run that follows a real one", () => {
      // Arrange
      const real = reduce(running(), ...finishedRun([resultOf(ZONAS)], false));
      const dry = [resultOf(ZONAS, { status: LayerLoadStatus.DRY_RUN_OK, finalCount: 500 })];

      // Act
      const next = reduce(real, { type: Action.RUN_REQUESTED, dryRun: true }, ...finishedRun(dry, true));

      // Assert
      expect(next.loaded).toEqual(real.loaded);
    });

    it("should return to READY with no error and keep results and loaded on RUN_FINISHED", () => {
      // Arrange
      const results = [resultOf(ZONAS), resultOf(LIMITE)];
      const start = reduce(running(), ...results.map((result) => layerDone(result, false)));

      // Act
      const next = reduce(start, { type: Action.RUN_FINISHED });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.READY);
      expect(next.error).toBeNull();
      expect(next.results).toEqual(results);
      expect(next.loaded).toEqual(start.loaded);
    });

    it("should keep the results gathered so far and the loaded layer when RUN_FAILED follows a first loaded layer", () => {
      // Arrange
      const first = resultOf(ZONAS);
      const start = reduce(running(), layerDone(first, false));

      // Act
      const next = reduce(start, { type: Action.RUN_FAILED, error: "Se perdió la conexión" });

      // Assert
      expect(next.phase).toBe(SigraFlowPhase.READY);
      expect(next.error).toBe("Se perdió la conexión");
      expect(next.results).toEqual([first]);
      expect(next.loaded[ZONAS]).toEqual(first);
    });

    describe("stageProgressOf along a per-layer run", () => {
      it("should be BUSY while the first required layer is the only one recorded", () => {
        // Arrange & Act
        const state = reduce(running(), layerDone(resultOf(ZONAS), false));

        // Assert
        expect(stageProgressOf(state).status).toBe(StageStatus.BUSY);
      });

      it("should stay BUSY with both required layers recorded while still RUNNING, and be DONE with the outcome lines after RUN_FINISHED", () => {
        // Arrange
        const recording = reduce(running(), layerDone(resultOf(ZONAS), false), layerDone(resultOf(LIMITE), false));

        // Act
        const whileRunning = stageProgressOf(recording);
        const finished = stageProgressOf(reduce(recording, { type: Action.RUN_FINISHED }));

        // Assert
        expect(recording.phase).toBe(SigraFlowPhase.RUNNING);
        expect(whileRunning.status).toBe(StageStatus.BUSY);
        expect(whileRunning.outcome).toBeUndefined();
        expect(finished.status).toBe(StageStatus.DONE);
        expect(finished.outcome).toEqual({
          headline: "Capas SIGRA actualizadas",
          lines: [`${getSigraLayer(ZONAS).label}: 10 registros (antes 8)`, `${getSigraLayer(LIMITE).label}: 10 registros (antes 8)`],
        });
      });

      it("should stay DONE after RUN_FINISHED and list the optional layers loaded in the same run", () => {
        // Arrange & Act
        const state = reduce(
          running(),
          layerDone(resultOf(ZONAS), false),
          layerDone(resultOf(LIMITE), false),
          layerDone(resultOf(OPTIONAL_A), false),
          { type: Action.RUN_FINISHED }
        );

        // Assert
        const progress = stageProgressOf(state);
        expect(progress.status).toBe(StageStatus.DONE);
        expect(progress.outcome?.lines).toEqual([
          `${getSigraLayer(ZONAS).label}: 10 registros (antes 8)`,
          `${getSigraLayer(LIMITE).label}: 10 registros (antes 8)`,
          `${getSigraLayer(OPTIONAL_A).label}: 10 registros (antes 8)`,
        ]);
      });

      it("should be FAILED after RUN_FINISHED when a required layer failed in a real run", () => {
        // Arrange & Act
        const state = reduce(running(), layerDone(failedResult(ZONAS), false), layerDone(resultOf(LIMITE), false), {
          type: Action.RUN_FINISHED,
        });

        // Assert
        const progress = stageProgressOf(state);
        expect(progress.status).toBe(StageStatus.FAILED);
        expect(progress.outcome).toEqual({
          headline: "Capas SIGRA con errores",
          lines: [`${getSigraLayer(ZONAS).label}: caída`],
        });
      });

      it("should be FAILED with the error text after RUN_FAILED when no required layer got loaded", () => {
        // Arrange & Act
        const state = reduce(running(), { type: Action.RUN_FAILED, error: "Se perdió la conexión" });

        // Assert
        expect(stageProgressOf(state)).toEqual({
          status: StageStatus.FAILED,
          outcome: { headline: "Capas SIGRA con errores", lines: ["Se perdió la conexión"] },
        });
      });

      it("should stay PENDING after a dry run made layer by layer", () => {
        // Arrange & Act
        const state = reduce(
          running(true),
          layerDone(resultOf(ZONAS, { status: LayerLoadStatus.DRY_RUN_OK }), true),
          layerDone(resultOf(LIMITE, { status: LayerLoadStatus.DRY_RUN_OK }), true),
          { type: Action.RUN_FINISHED }
        );

        // Assert
        expect(stageProgressOf(state)).toEqual({ status: StageStatus.PENDING });
      });
    });
  });

  describe("RESET", () => {
    it("should restore the initial state", () => {
      // Arrange
      const dirty = reduce(
        running(),
        ...finishedRun(loadedRequired(), false),
        { type: Action.SELECT_ALL }
      );

      // Act
      const next = reduce(dirty, { type: Action.RESET });

      // Assert
      expect(next).toEqual(createInitialSigraFlow());
    });
  });

  describe("requiredLayersLoaded", () => {
    it("should be false with nothing loaded", () => {
      // Arrange & Act & Assert
      expect(requiredLayersLoaded(createInitialSigraFlow())).toBe(false);
    });

    it.each(REQUIRED_LAYER_IDS)("should be false when only %s is loaded", (layerId) => {
      // Arrange
      const state = reduce(running(), ...finishedRun([resultOf(layerId)], false));

      // Act & Assert
      expect(requiredLayersLoaded(state)).toBe(false);
    });

    it("should be true when both required layers are loaded", () => {
      // Arrange
      const state = reduce(running(), ...finishedRun(loadedRequired(), false));

      // Act & Assert
      expect(requiredLayersLoaded(state)).toBe(true);
    });

    it("should stay false when only optional layers are loaded", () => {
      // Arrange
      const state = reduce(running(), ...finishedRun([resultOf(OPTIONAL_A), resultOf(OPTIONAL_B)], false));

      // Act & Assert
      expect(requiredLayersLoaded(state)).toBe(false);
    });
  });

  describe("canRunSelection", () => {
    it("should be true in READY with a loadable plan for every selected layer", () => {
      // Arrange & Act & Assert
      expect(canRunSelection(ready())).toBe(true);
    });

    it.each([SigraFlowPhase.PLANNING, SigraFlowPhase.RUNNING, SigraFlowPhase.PLAN_FAILED])("should be false in %s", (phase) => {
      // Arrange
      const state: SigraFlowState = { ...ready(), phase };

      // Act & Assert
      expect(canRunSelection(state)).toBe(false);
    });

    it("should be false with an empty selection", () => {
      // Arrange
      const state: SigraFlowState = { ...ready(), selection: [] };

      // Act & Assert
      expect(canRunSelection(state)).toBe(false);
    });

    it("should be false without a plan", () => {
      // Arrange
      const state: SigraFlowState = { ...ready(), plan: null };

      // Act & Assert
      expect(canRunSelection(state)).toBe(false);
    });

    it("should be false when a selected layer cannot be loaded", () => {
      // Arrange
      const state = ready(planOf({ [LIMITE]: { canLoad: false, blockers: ["x"] } }));

      // Act & Assert
      expect(canRunSelection(state)).toBe(false);
    });

    it("should be false when a selected layer is missing from the plan", () => {
      // Arrange
      const plan = planOf();
      const state = ready({ ...plan, layers: plan.layers.filter((layer) => layer.layerId !== ZONAS) });

      // Act & Assert
      expect(canRunSelection(state)).toBe(false);
    });

    it("should ignore layers that cannot be loaded when they are not selected", () => {
      // Arrange
      const state = ready(planOf({ [OPTIONAL_A]: { canLoad: false, blockers: ["x"] } }));

      // Act & Assert
      expect(canRunSelection(state)).toBe(true);
    });

    it("should be false once an unloadable optional layer is selected", () => {
      // Arrange
      const start = ready(planOf({ [OPTIONAL_A]: { canLoad: false, blockers: ["x"] } }));

      // Act
      const next = reduce(start, { type: Action.TOGGLE_LAYER, layerId: OPTIONAL_A });

      // Assert
      expect(canRunSelection(next)).toBe(false);
    });
  });

  describe("stageProgressOf", () => {
    it("should be PENDING without an outcome for the initial state", () => {
      // Arrange & Act
      const progress = stageProgressOf(createInitialSigraFlow());

      // Assert
      expect(progress.status).toBe(StageStatus.PENDING);
      expect(progress.outcome).toBeUndefined();
    });

    it("should be PENDING when planned but never run", () => {
      // Arrange & Act & Assert
      expect(stageProgressOf(ready()).status).toBe(StageStatus.PENDING);
    });

    it("should be BUSY without an outcome while RUNNING", () => {
      // Arrange & Act
      const progress = stageProgressOf(running());

      // Assert
      expect(progress.status).toBe(StageStatus.BUSY);
      expect(progress.outcome).toBeUndefined();
    });

    it("should be BUSY while RUNNING even when the required layers were loaded earlier", () => {
      // Arrange
      const loaded = reduce(running(), ...finishedRun(loadedRequired(), false));

      // Act
      const progress = stageProgressOf(reduce(loaded, { type: Action.RUN_REQUESTED, dryRun: true }));

      // Assert
      expect(progress.status).toBe(StageStatus.BUSY);
      expect(progress.outcome).toBeUndefined();
    });

    it("should be DONE with the headline and one line per loaded layer in registry order", () => {
      // Arrange
      const results = [
        resultOf(OPTIONAL_B, { previousCount: 3, finalCount: 7 }),
        resultOf(LIMITE, { previousCount: null, finalCount: 20 }),
        resultOf(ZONAS, { previousCount: 8, finalCount: 10 }),
      ];
      const state = reduce(running(), ...finishedRun(results, false));

      // Act
      const progress = stageProgressOf(state);

      // Assert
      expect(progress.status).toBe(StageStatus.DONE);
      expect(progress.outcome).toEqual({
        headline: "Capas SIGRA actualizadas",
        lines: [
          `${getSigraLayer(ZONAS).label}: 10 registros (antes 8)`,
          `${getSigraLayer(LIMITE).label}: 20 registros (antes sin dato)`,
          `${getSigraLayer(OPTIONAL_B).label}: 7 registros (antes 3)`,
        ],
      });
    });

    it("should stay DONE after a later failed real run of an optional layer", () => {
      // Arrange
      const done = reduce(running(), ...finishedRun(loadedRequired(), false));
      const failed = resultOf(OPTIONAL_A, { status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS, finalCount: null, message: "caída" });

      // Act
      const next = reduce(done, { type: Action.RUN_REQUESTED, dryRun: false }, ...finishedRun([failed], false));

      // Assert
      expect(stageProgressOf(next).status).toBe(StageStatus.DONE);
    });

    it("should be FAILED listing one line per failed or rejected result after a real run", () => {
      // Arrange
      const results = [
        resultOf(ZONAS, { status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS, finalCount: null, message: "Sin respuesta" }),
        resultOf(LIMITE, { status: LayerLoadStatus.REJECTED_VALIDATION, step: LayerLoadStep.VALIDATION, finalCount: null, message: "Menos del 97%" }),
        resultOf(OPTIONAL_A),
      ];
      const state = reduce(running(), ...finishedRun(results, false));

      // Act
      const progress = stageProgressOf(state);

      // Assert
      expect(progress.status).toBe(StageStatus.FAILED);
      expect(progress.outcome).toEqual({
        headline: "Capas SIGRA con errores",
        lines: [`${getSigraLayer(ZONAS).label}: Sin respuesta`, `${getSigraLayer(LIMITE).label}: Menos del 97%`],
      });
    });

    it("should be FAILED with the error text when a real run failed as a whole", () => {
      // Arrange
      const state = reduce(running(false), { type: Action.RUN_FAILED, error: "Se perdió la conexión" });

      // Act
      const progress = stageProgressOf(state);

      // Assert
      expect(progress.status).toBe(StageStatus.FAILED);
      expect(progress.outcome?.headline).toBe("Capas SIGRA con errores");
      expect(progress.outcome?.lines).toEqual(["Se perdió la conexión"]);
    });

    it("should never be FAILED or DONE because of a dry run", () => {
      // Arrange
      const dryFailed = [resultOf(ZONAS, { status: LayerLoadStatus.FAILED, step: LayerLoadStep.INSERT, finalCount: null })];
      const dryOk = loadedRequired().map((result) => ({ ...result, status: LayerLoadStatus.DRY_RUN_OK }));

      // Act
      const afterFailed = stageProgressOf(reduce(running(true), ...finishedRun(dryFailed, true)));
      const afterOk = stageProgressOf(reduce(running(true), ...finishedRun(dryOk, true)));
      const afterError = stageProgressOf(reduce(running(true), { type: Action.RUN_FAILED, error: "x" }));

      // Assert
      expect(afterFailed.status).toBe(StageStatus.PENDING);
      expect(afterOk.status).toBe(StageStatus.PENDING);
      expect(afterError.status).toBe(StageStatus.PENDING);
      expect(afterOk.outcome).toBeUndefined();
    });

    it("should be PENDING, not FAILED, when the plan itself failed", () => {
      // Arrange
      const state: SigraFlowState = { ...createInitialSigraFlow(), phase: SigraFlowPhase.PLAN_FAILED, error: "sin conexión", lastRunDryRun: false };

      // Act
      const progress = stageProgressOf(state);

      // Assert
      expect(progress.status).toBe(StageStatus.PENDING);
      expect(progress.outcome).toBeUndefined();
    });
  });
});
