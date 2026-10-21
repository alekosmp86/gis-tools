import { describe, expect, it, vi } from "vitest";
import { Signal } from "lucide-react";
import { StageStatus } from "@/modules/coverage-loads/shared/domain/stageContract";
import { LOAD_TYPE_LABELS, LoadType } from "@/modules/coverage-loads/workflow/domain/loadType";
import { createInitialWorkflow, WorkflowPhase, type WorkflowState } from "@/modules/coverage-loads/workflow/domain/workflowState";
import { STAGE_STATUS_LABELS } from "@/modules/coverage-loads/workflow/ui/stageStatusLabels";
import { buildStepperEntries, StepperTone, type StepperActions } from "@/modules/coverage-loads/workflow/ui/stepperEntries";
import type { CoverageStage } from "@/modules/coverage-loads/workflow/ui/coverageStages";

const CONNECTION = { host: "h", port: "5432", db_name: "d", user: "u", password: "" };
const STAGE_IDS = { [LoadType.COVERAGE]: ["alpha", "beta"], [LoadType.FTTH]: ["gamma"] };

const STAGES: ReadonlyArray<CoverageStage> = [
  { id: "alpha", label: "Alfa", Icon: Signal, Panel: () => null },
  { id: "beta", label: "Beta", Icon: Signal, Panel: () => null },
  { id: "gamma", label: "Gamma", Icon: Signal, Panel: () => null },
];

function actions() {
  return { editLoadType: vi.fn(), editConnection: vi.fn(), selectStage: vi.fn(), goToResult: vi.fn() } satisfies StepperActions;
}

/** A coverage workflow with the connection confirmed unless the phase is LOAD_TYPE or CONNECTION. */
function stateIn(phase: WorkflowState["phase"], overrides: Partial<WorkflowState> = {}): WorkflowState {
  const isBeforeConfirmation = phase === WorkflowPhase.LOAD_TYPE || phase === WorkflowPhase.CONNECTION;
  const loadType = phase === WorkflowPhase.LOAD_TYPE ? null : LoadType.COVERAGE;
  return {
    ...createInitialWorkflow(STAGE_IDS),
    phase,
    loadType,
    confirmedConnection: isBeforeConfirmation ? null : CONNECTION,
    ...overrides,
  };
}

function withStatus(state: WorkflowState, stageId: string, status: StageStatus): WorkflowState {
  return { ...state, stages: { ...state.stages, [stageId]: { status, outcome: null } } };
}

const keysOf = (entries: ReturnType<typeof buildStepperEntries>) => entries.map((entry) => entry.key);

describe("buildStepperEntries", () => {
  describe("shape", () => {
    it("should list Tipo de carga, Conexión, only the chosen coverage stages in order, then Resultado", () => {
      // Arrange & Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.STAGES), STAGES, actions());

      // Assert
      expect(keysOf(entries)).toEqual(["load-type", "connection", "alpha", "beta", "result"]);
      expect(entries.map((entry) => entry.title)).toEqual(["Tipo de carga", "Conexión", "Alfa", "Beta", "Resultado"]);
      expect(entries.every((entry) => entry.Icon !== undefined)).toBe(true);
    });

    it("should list only the FTTH stage when FTTH is chosen", () => {
      // Arrange
      const state = stateIn(WorkflowPhase.STAGES, { loadType: LoadType.FTTH, activeStageId: "gamma" });

      // Act
      const entries = buildStepperEntries(state, STAGES, actions());

      // Assert
      expect(keysOf(entries)).toEqual(["load-type", "connection", "gamma", "result"]);
      expect(entries.map((entry) => entry.title)).toEqual(["Tipo de carga", "Conexión", "Gamma", "Resultado"]);
    });

    it("should list no stage while no type is chosen", () => {
      // Arrange & Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.LOAD_TYPE), STAGES, actions());

      // Assert
      expect(keysOf(entries)).toEqual(["load-type", "connection", "result"]);
    });

    it("should be data-driven: no stages leaves only Tipo de carga, Conexión and Resultado", () => {
      // Arrange & Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.CONNECTION), [], actions());

      // Assert
      expect(keysOf(entries)).toEqual(["load-type", "connection", "result"]);
    });
  });

  describe("LOAD_TYPE phase", () => {
    it("should make only Tipo de carga active and nothing selectable, with a caption that names neither type", () => {
      // Arrange & Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.LOAD_TYPE), STAGES, actions());

      // Assert
      expect(entries.map((entry) => entry.isActive)).toEqual([true, false, false]);
      expect(entries.map((entry) => entry.select)).toEqual([null, null, null]);
      expect(entries[0].tone).toBe(StepperTone.IDLE);
      expect(entries[0].caption.length).toBeGreaterThan(0);
      expect(Object.values(LOAD_TYPE_LABELS)).not.toContain(entries[0].caption);
    });

    it("should keep the chosen type captioned while the choice is being reopened, active and not clickable", () => {
      // Arrange
      const state = stateIn(WorkflowPhase.LOAD_TYPE, { loadType: LoadType.FTTH, confirmedConnection: CONNECTION });

      // Act
      const entries = buildStepperEntries(state, STAGES, actions());

      // Assert
      expect(entries[0]).toMatchObject({ caption: LOAD_TYPE_LABELS[LoadType.FTTH], isActive: true, select: null });
      expect(entries[1].select).toBeNull();
      expect(entries.at(-1)?.select).toBeNull();
    });
  });

  describe("Tipo de carga entry", () => {
    it.each([
      [LoadType.COVERAGE, "Cobertura (3G, LTE, 5G, NBIOT)"],
      [LoadType.FTTH, "FTTH"],
    ])("should caption the chosen type %s with its label and mark it done", (loadType, label) => {
      // Arrange
      const state = stateIn(WorkflowPhase.STAGES, { loadType });

      // Act
      const [entry] = buildStepperEntries(state, STAGES, actions());

      // Assert
      expect(entry).toMatchObject({ key: "load-type", caption: label, tone: StepperTone.DONE, isActive: false });
    });

    it.each([WorkflowPhase.CONNECTION, WorkflowPhase.STAGES, WorkflowPhase.RESULT])(
      "should call editLoadType when clicked from %s and no stage is busy",
      (phase) => {
        // Arrange
        const wired = actions();

        // Act
        const [entry] = buildStepperEntries(stateIn(phase), STAGES, wired);
        entry.select?.();

        // Assert
        expect(wired.editLoadType).toHaveBeenCalledTimes(1);
        expect(wired.editConnection).not.toHaveBeenCalled();
      }
    );

    it.each(["alpha", "beta"])("should not be clickable while stage %s is BUSY", (busyStage) => {
      // Arrange
      const wired = actions();
      const state = withStatus(stateIn(WorkflowPhase.STAGES), busyStage, StageStatus.BUSY);

      // Act
      const [entry] = buildStepperEntries(state, STAGES, wired);

      // Assert
      expect(entry.select).toBeNull();
      expect(wired.editLoadType).not.toHaveBeenCalled();
    });

    it("should be clickable again once no stage is BUSY", () => {
      // Arrange
      const busy = withStatus(stateIn(WorkflowPhase.STAGES), "alpha", StageStatus.BUSY);
      const settled = withStatus(busy, "alpha", StageStatus.DONE);

      // Act
      const [whileBusy] = buildStepperEntries(busy, STAGES, actions());
      const [afterwards] = buildStepperEntries(settled, STAGES, actions());

      // Assert
      expect(whileBusy.select).toBeNull();
      expect(afterwards.select).not.toBeNull();
    });
  });

  describe("CONNECTION phase", () => {
    it("should make only Conexión active; the type is clickable, stages and Resultado are not", () => {
      // Arrange & Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.CONNECTION), STAGES, actions());

      // Assert
      expect(entries.map((entry) => entry.isActive)).toEqual([false, true, false, false, false]);
      expect(entries.map((entry) => entry.select === null)).toEqual([false, true, true, true, true]);
      expect(entries[1]).toMatchObject({ caption: "Base de datos", tone: StepperTone.IDLE });
    });

    it("should keep the earlier confirmation from showing as confirmed while it is being edited", () => {
      // Arrange
      const state = stateIn(WorkflowPhase.CONNECTION, { confirmedConnection: CONNECTION });

      // Act
      const [, connection] = buildStepperEntries(state, STAGES, actions());

      // Assert
      expect(connection).toMatchObject({ caption: "Base de datos", tone: StepperTone.IDLE, isActive: true, select: null });
    });
  });

  describe("STAGES phase", () => {
    it("should show Conexión confirmed and clickable, calling editConnection", () => {
      // Arrange
      const wired = actions();

      // Act
      const [, connection] = buildStepperEntries(stateIn(WorkflowPhase.STAGES), STAGES, wired);
      connection.select?.();

      // Assert
      expect(connection).toMatchObject({ caption: "Confirmada", tone: StepperTone.DONE, isActive: false });
      expect(wired.editConnection).toHaveBeenCalledTimes(1);
    });

    it.each(["alpha", "beta"])("should make Conexión non-clickable while stage %s is BUSY", (busyStage) => {
      // Arrange
      const wired = actions();
      const state = withStatus(stateIn(WorkflowPhase.STAGES), busyStage, StageStatus.BUSY);

      // Act
      const [, connection] = buildStepperEntries(state, STAGES, wired);

      // Assert
      expect(connection.select).toBeNull();
      expect(wired.editConnection).not.toHaveBeenCalled();
    });

    it("should make Conexión clickable again once no stage is BUSY", () => {
      // Arrange
      const wired = actions();
      const busy = withStatus(stateIn(WorkflowPhase.STAGES), "alpha", StageStatus.BUSY);
      const settled = withStatus(busy, "alpha", StageStatus.DONE);

      // Act
      const [, whileBusy] = buildStepperEntries(busy, STAGES, wired);
      const [, afterwards] = buildStepperEntries(settled, STAGES, wired);
      afterwards.select?.();

      // Assert
      expect(whileBusy.select).toBeNull();
      expect(afterwards.select).not.toBeNull();
      expect(wired.editConnection).toHaveBeenCalledTimes(1);
    });

    it("should mark only the active stage active", () => {
      // Arrange
      const state = stateIn(WorkflowPhase.STAGES, { activeStageId: "beta" });

      // Act
      const entries = buildStepperEntries(state, STAGES, actions());

      // Assert
      expect(entries.map((entry) => entry.isActive)).toEqual([false, false, false, true, false]);
    });

    it("should select the clicked stage by id", () => {
      // Arrange
      const wired = actions();

      // Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.STAGES), STAGES, wired);
      entries[3].select?.();

      // Assert
      expect(wired.selectStage).toHaveBeenCalledWith("beta");
      expect(wired.selectStage).toHaveBeenCalledTimes(1);
    });

    it("should make Resultado clickable, calling goToResult", () => {
      // Arrange
      const wired = actions();

      // Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.STAGES), STAGES, wired);
      entries[4].select?.();

      // Assert
      expect(wired.goToResult).toHaveBeenCalledTimes(1);
      expect(entries[4]).toMatchObject({ isActive: false, caption: "Resumen y reportes" });
    });

    it.each([
      [StageStatus.PENDING, StepperTone.IDLE],
      [StageStatus.FAILED, StepperTone.IDLE],
      [StageStatus.DONE, StepperTone.DONE],
      [StageStatus.SKIPPED, StepperTone.SKIPPED],
      [StageStatus.BUSY, StepperTone.BUSY],
    ])("should caption a %s stage with its label and tone %s", (status, tone) => {
      // Arrange
      const state = withStatus(stateIn(WorkflowPhase.STAGES), "alpha", status);

      // Act
      const [, , alpha, beta] = buildStepperEntries(state, STAGES, actions());

      // Assert
      expect(alpha).toMatchObject({ caption: STAGE_STATUS_LABELS[status], tone });
      expect(beta).toMatchObject({ caption: STAGE_STATUS_LABELS[StageStatus.PENDING], tone: StepperTone.IDLE });
    });
  });

  describe("RESULT phase", () => {
    it("should make only Resultado active, keep stages clickable and Resultado itself not clickable", () => {
      // Arrange & Act
      const entries = buildStepperEntries(stateIn(WorkflowPhase.RESULT, { activeStageId: "alpha" }), STAGES, actions());

      // Assert
      expect(entries.map((entry) => entry.isActive)).toEqual([false, false, false, false, true]);
      expect(entries[0].select).not.toBeNull();
      expect(entries[1].select).not.toBeNull();
      expect(entries[2].select).not.toBeNull();
      expect(entries[4].select).toBeNull();
    });

    it("should call editConnection from Conexión when no stage is BUSY", () => {
      // Arrange
      const wired = actions();

      // Act
      const [, connection] = buildStepperEntries(stateIn(WorkflowPhase.RESULT), STAGES, wired);
      connection.select?.();

      // Assert
      expect(wired.editConnection).toHaveBeenCalledTimes(1);
    });

    it.each(["alpha", "beta"])("should make Conexión non-clickable while stage %s is BUSY", (busyStage) => {
      // Arrange
      const wired = actions();
      const state = withStatus(stateIn(WorkflowPhase.RESULT), busyStage, StageStatus.BUSY);

      // Act
      const [, connection] = buildStepperEntries(state, STAGES, wired);

      // Assert
      expect(connection.select).toBeNull();
      expect(wired.editConnection).not.toHaveBeenCalled();
    });
  });
});

describe("STAGE_STATUS_LABELS", () => {
  it("should label every stage status with a distinct non-empty text", () => {
    // Arrange
    const statuses = Object.values(StageStatus);

    // Act
    const labels = statuses.map((status) => STAGE_STATUS_LABELS[status]);

    // Assert
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(statuses.length);
  });
});
