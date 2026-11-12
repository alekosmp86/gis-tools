import { describe, expect, it } from "vitest";
import { EJES_ROLES } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesAnalysisKeyOf } from "@/modules/routine-jobs/ui/ejesCallesAnalysisKey";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/ejesCallesRunStore";
import {
  blockingReason,
  canAnalyzeNow,
  canContinue,
  canLoadNow,
  ejesWizardReducer,
  EjesStep,
  ejesGeometryMapBaseOf,
  excludedEjesTablesOf,
  initialEjesWizardState,
  initialEjesWizardStateFor,
  runBlockedReason,
  toEjesStartRequest,
  type EjesWizardAction,
  type EjesWizardState,
} from "@/modules/routine-jobs/ui/ejesCallesWizardState";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const PASSWORD = "pw-secret";

const reduce = (state: EjesWizardState, ...actions: EjesWizardAction[]): EjesWizardState =>
  actions.reduce(ejesWizardReducer, state);

const validState = (overrides: Partial<EjesWizardState> = {}): EjesWizardState => {
  const initial = initialEjesWizardState();
  return {
    ...initial,
    step: EjesStep.REVIEW,
    connection: { host: "h", port: "5432", db_name: "d", user: "u", password: PASSWORD },
    slots: Object.fromEntries(
      EJES_ROLES.map((role) => [role, { ...initial.slots[role], valid: true }])
    ) as EjesWizardState["slots"],
    confirmation: { password: PASSWORD },
    ...overrides,
  };
};

const jobOf = (blockers: string[]): EjesRunSnapshot["job"] =>
  ({ state: "DONE", result: { blockers } as unknown as EjesResult }) as unknown as EjesRunSnapshot["job"];

const doneSnapshot = (
  state: EjesWizardState,
  overrides: Partial<EjesRunSnapshot> = {},
  blockers: string[] = []
): EjesRunSnapshot => ({
  phase: RunPhase.DONE,
  job: jobOf(blockers),
  plan: { dryRun: true, ejesStaging: "x.y", analysisKey: ejesAnalysisKeyOf(toEjesStartRequest(state, { dryRun: true })) },
  ...overrides,
});

describe("ejes wizard state", () => {
  describe("initial state", () => {
    it("should start on the connection step with default tables, port 5432 and invalid slots", () => {
      const state = initialEjesWizardState();

      expect(state.step).toBe(EjesStep.CONNECTION);
      expect(state.connection.port).toBe("5432");
      expect(state.slots["ejes-origen"]).toEqual({ schema: "bdj_carto", table: "ide_ejesviacirculacion", valid: false });
      expect(state.confirmation.password).toBe("");
    });

    it("should open on the result step when a run exists and on connection when idle", () => {
      expect(initialEjesWizardStateFor({ phase: RunPhase.IDLE }).step).toBe(EjesStep.CONNECTION);
      expect(initialEjesWizardStateFor({ phase: RunPhase.RUNNING }).step).toBe(EjesStep.RESULT);
    });
  });

  describe("blocking reasons", () => {
    it("should block the connection step until host, port, db and user are set", () => {
      expect(blockingReason(initialEjesWizardState())).not.toBeNull();
      expect(canContinue(initialEjesWizardState())).toBe(false);
    });

    it("should block the tables step on a blank schema", () => {
      const state = validState({ step: EjesStep.TABLES });
      state.slots["ejes-vias"] = { ...state.slots["ejes-vias"], schema: " " };

      expect(blockingReason(state)).toBe("Indique el esquema de cada tabla.");
    });

    it("should block the tables step on a blank table", () => {
      const state = validState({ step: EjesStep.TABLES });
      state.slots["ejes-vias"] = { ...state.slots["ejes-vias"], table: "" };

      expect(blockingReason(state)).toBe("Elija una tabla para cada rol.");
    });

    it("should block the tables step on a repeated schema and table", () => {
      const state = validState({ step: EjesStep.TABLES });
      state.slots["ejes-vias"] = { ...state.slots["ejes-tramos"] };

      expect(blockingReason(state)).toMatch(/distintas/);
    });

    it("should block the tables step when a slot is invalid", () => {
      const state = validState({ step: EjesStep.TABLES });
      state.slots["ejes-accesos"] = { ...state.slots["ejes-accesos"], valid: false };

      expect(blockingReason(state)).toBe("Alguna tabla tiene columnas faltantes o ambiguas.");
    });

    it("should allow continuing from tables when valid, and never from review or result", () => {
      expect(canContinue(validState({ step: EjesStep.TABLES }))).toBe(true);
      expect(canContinue(validState({ step: EjesStep.REVIEW }))).toBe(false);
      expect(canContinue(validState({ step: EjesStep.RESULT }))).toBe(false);
    });

    it("should give the connection reason priority in runBlockedReason", () => {
      const state = validState({ connection: { host: "", port: "5432", db_name: "d", user: "u", password: "" } });

      expect(runBlockedReason(state)).toBe(blockingReason({ ...state, step: EjesStep.CONNECTION }));
    });
  });

  describe("canAnalyzeNow", () => {
    it("should be true when valid and the password is retyped", () => {
      expect(canAnalyzeNow(validState())).toBe(true);
    });

    it("should be false when the retyped password is empty or different", () => {
      expect(canAnalyzeNow(validState({ confirmation: { password: "" } }))).toBe(false);
      expect(canAnalyzeNow(validState({ confirmation: { password: "other" } }))).toBe(false);
    });

    it("should be false when both passwords are empty", () => {
      const state = validState();
      state.connection = { ...state.connection, password: "" };

      expect(canAnalyzeNow({ ...state, confirmation: { password: "" } })).toBe(false);
    });
  });

  describe("toEjesStartRequest", () => {
    it("should trim connection and tables and carry dryRun", () => {
      const state = validState();
      state.slots["ejes-origen"] = { schema: " s ", table: " t ", valid: true };
      state.connection = { ...state.connection, host: " h " };

      const request = toEjesStartRequest(state, { dryRun: true });

      expect(request.dryRun).toBe(true);
      expect(request.tables["ejes-origen"]).toEqual({ schema: "s", table: "t" });
      expect(request.connection.host).toBe("h");
      expect(Object.keys(request.tables)).toHaveLength(9);
    });
  });

  describe("ejesGeometryMapBaseOf (EM-15)", () => {
    it("should be null while the wizard holds no password", () => {
      const state = validState();
      state.connection = { ...state.connection, password: "" };

      expect(ejesGeometryMapBaseOf(state)).toBeNull();
    });

    it("should carry the trimmed connection and only the staging, road section and padrones tables (ET-7, ET-8)", () => {
      const state = validState();
      state.slots["ejes-origen"] = { schema: " s ", table: " t ", valid: true };
      state.slots["ejes-tramos"] = { schema: " carto ", table: " road_section ", valid: true };
      state.slots["ejes-padrones"] = { schema: " carto ", table: " padron ", valid: true };
      state.connection = { ...state.connection, host: " h " };

      const base = ejesGeometryMapBaseOf(state);

      expect(base?.connection.host).toBe("h");
      expect(base?.connection.password).toBe(PASSWORD);
      expect(base?.tables).toEqual({
        "ejes-origen": { schema: "s", table: "t" },
        "ejes-tramos": { schema: "carto", table: "road_section" },
        "ejes-padrones": { schema: "carto", table: "padron" },
      });
    });
  });

  describe("ejes-padrones slot (ET-1)", () => {
    it("should start with the default carto.padron table, invalid until checked", () => {
      expect(initialEjesWizardState().slots["ejes-padrones"]).toEqual({ schema: "carto", table: "padron", valid: false });
    });

    it("should carry the padrones table, trimmed, in the start request", () => {
      const state = validState();
      state.slots["ejes-padrones"] = { schema: " s ", table: " p ", valid: true };

      expect(toEjesStartRequest(state, { dryRun: true }).tables["ejes-padrones"]).toEqual({ schema: "s", table: "p" });
    });

    it("should exclude the tables of the other roles in the same schema from the padrones choices", () => {
      const state = validState();
      state.slots["ejes-padrones"] = { ...state.slots["ejes-tramos"] };

      expect(excludedEjesTablesOf(state)["ejes-padrones"]).toContain("road_section");
    });

    it("should change the analysis key when the padrones table changes", () => {
      const state = validState();
      const changed = validState();
      changed.slots["ejes-padrones"] = { ...changed.slots["ejes-padrones"], table: "otra" };

      expect(ejesAnalysisKeyOf(toEjesStartRequest(changed, { dryRun: true }))).not.toBe(
        ejesAnalysisKeyOf(toEjesStartRequest(state, { dryRun: true }))
      );
    });
  });

  describe("canLoadNow (EJ-24)", () => {
    it("should be true after a finished dry run of the same data with no blocker and the password retyped", () => {
      const state = validState();

      expect(canLoadNow(state, doneSnapshot(state))).toBe(true);
    });

    it("should be false when the analysis has blockers", () => {
      const state = validState();

      expect(canLoadNow(state, doneSnapshot(state, {}, ["algo"]))).toBe(false);
    });

    it("should be false when there is no analysis, a running one or a failed one", () => {
      const state = validState();

      expect(canLoadNow(state, { phase: RunPhase.IDLE })).toBe(false);
      expect(canLoadNow(state, doneSnapshot(state, { phase: RunPhase.RUNNING }))).toBe(false);
      expect(canLoadNow(state, doneSnapshot(state, { phase: RunPhase.FAILED }))).toBe(false);
      expect(canLoadNow(state, doneSnapshot(state, { job: undefined }))).toBe(false);
    });

    it("should be false when the last run was not a dry run", () => {
      const state = validState();
      const snapshot = doneSnapshot(state);

      expect(canLoadNow(state, { ...snapshot, plan: { ...snapshot.plan!, dryRun: false } })).toBe(false);
    });

    it("should be false when the password is not retyped", () => {
      const state = validState();

      expect(canLoadNow({ ...state, confirmation: { password: "" } }, doneSnapshot(state))).toBe(false);
    });

    it("should be false when the staging table changed after the analysis", () => {
      const snapshot = doneSnapshot(validState());
      const changed = validState();
      changed.slots["ejes-origen"] = { ...changed.slots["ejes-origen"], table: "otra" };

      expect(canLoadNow(changed, snapshot)).toBe(false);
    });

    it("should be false when the connection changed after the analysis", () => {
      const snapshot = doneSnapshot(validState());
      const changed = validState();
      changed.connection = { ...changed.connection, db_name: "otra" };

      expect(canLoadNow(changed, snapshot)).toBe(false);
    });

    it("should keep the password out of the analysis key", () => {
      expect(ejesAnalysisKeyOf(toEjesStartRequest(validState(), { dryRun: true }))).not.toContain(PASSWORD);
    });
  });

  describe("reducer", () => {
    it("should clear slot validity and confirmation when a connection field changes", () => {
      const next = reduce(validState(), { type: "connectionChanged", field: "host", value: "nuevo" });

      expect(next.connection.host).toBe("nuevo");
      expect(Object.values(next.slots).every((slot) => !slot.valid)).toBe(true);
      expect(next.confirmation.password).toBe("");
    });

    it("should only clear the confirmation when the password changes", () => {
      const next = reduce(validState(), { type: "connectionChanged", field: "password", value: "x" });

      expect(next.confirmation.password).toBe("");
      expect(Object.values(next.slots).every((slot) => slot.valid)).toBe(true);
    });

    it("should reset the table when a slot schema changes", () => {
      const next = reduce(validState(), { type: "slotSchemaChanged", key: "ejes-vias", schema: "otro" });

      expect(next.slots["ejes-vias"]).toEqual({ schema: "otro", table: "", valid: false });
    });

    it("should store the table and validity when a slot table is chosen", () => {
      const next = reduce(validState(), { type: "slotTableChosen", key: "ejes-vias", table: "cw", valid: false });

      expect(next.slots["ejes-vias"]).toMatchObject({ table: "cw", valid: false });
    });

    it("should patch the confirmation", () => {
      const next = reduce(initialEjesWizardState(), { type: "confirmationChanged", patch: { password: "abc" } });

      expect(next.confirmation.password).toBe("abc");
    });

    it("should not advance when blocked and advance when valid", () => {
      const blocked = initialEjesWizardState();
      expect(reduce(blocked, { type: "next" })).toBe(blocked);

      expect(reduce(validState({ step: EjesStep.CONNECTION }), { type: "next" }).step).toBe(EjesStep.TABLES);
    });

    it("should go back one step and clear the confirmation when leaving review", () => {
      const next = reduce(validState(), { type: "back" });

      expect(next.step).toBe(EjesStep.TABLES);
      expect(next.confirmation.password).toBe("");
    });

    it("should stay on the first step when going back from it", () => {
      expect(reduce(initialEjesWizardState(), { type: "back" }).step).toBe(EjesStep.CONNECTION);
    });

    it("should stop goTo at the first blocked step", () => {
      expect(reduce(initialEjesWizardState(), { type: "goTo", step: EjesStep.REVIEW }).step).toBe(EjesStep.CONNECTION);
      expect(reduce(validState({ step: EjesStep.CONNECTION }), { type: "goTo", step: EjesStep.REVIEW }).step).toBe(
        EjesStep.REVIEW
      );
    });

    it("should move to result and clear the confirmation on runStarted", () => {
      const next = reduce(validState(), { type: "runStarted" });

      expect(next.step).toBe(EjesStep.RESULT);
      expect(next.confirmation.password).toBe("");
    });

    it("should reset to the initial state", () => {
      expect(reduce(validState(), { type: "reset" })).toEqual(initialEjesWizardState());
    });

    it("should not mutate the previous state", () => {
      const state = validState();
      const before = JSON.stringify(state);

      reduce(state, { type: "connectionChanged", field: "host", value: "z" }, { type: "back" });

      expect(JSON.stringify(state)).toBe(before);
    });
  });

  describe("excludedEjesTablesOf", () => {
    it("should exclude names chosen by other roles in the same schema only", () => {
      const excluded = excludedEjesTablesOf(initialEjesWizardState());

      expect(excluded["ejes-tramos"]).toEqual(expect.arrayContaining(["circulation_way", "addresses_master"]));
      expect(excluded["ejes-tramos"]).not.toContain("road_section");
      expect(excluded["ejes-tramos"]).not.toContain("ide_ejesviacirculacion");
    });
  });
});
