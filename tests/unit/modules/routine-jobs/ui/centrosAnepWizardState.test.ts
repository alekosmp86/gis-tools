import { describe, expect, it } from "vitest";
import { CENTROS_DEFAULT_TABLES, CENTROS_ROLES } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import { centrosAnepAnalysisKeyOf } from "@/modules/routine-jobs/ui/centrosAnepAnalysisKey";
import {
  blockingReason,
  canAnalyzeNow,
  canContinue,
  canLoadNow,
  centrosAnepWizardReducer,
  CentrosAnepStep,
  excludedCentrosAnepTablesOf,
  initialCentrosAnepWizardState,
  initialCentrosAnepWizardStateFor,
  runBlockedReason,
  toCentrosAnepStartRequest,
  type CentrosAnepWizardAction,
  type CentrosAnepWizardState,
} from "@/modules/routine-jobs/ui/centrosAnepWizardState";
import {
  buildCentrosAnepWizardSteps,
  centrosAnepStepIdOf,
  centrosAnepStepOfId,
} from "@/modules/routine-jobs/ui/centrosAnepWizardSteps";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const PASSWORD = "pw-secret";

const reduce = (state: CentrosAnepWizardState, ...actions: CentrosAnepWizardAction[]): CentrosAnepWizardState =>
  actions.reduce(centrosAnepWizardReducer, state);

const validState = (overrides: Partial<CentrosAnepWizardState> = {}): CentrosAnepWizardState => {
  const initial = initialCentrosAnepWizardState();
  return {
    ...initial,
    step: CentrosAnepStep.REVIEW,
    connection: { host: "h", port: "5432", db_name: "d", user: "u", password: PASSWORD },
    slots: Object.fromEntries(
      CENTROS_ROLES.map((role) => [role, { ...initial.slots[role], valid: true }])
    ) as CentrosAnepWizardState["slots"],
    confirmation: { password: PASSWORD, acknowledged: true },
    ...overrides,
  };
};

describe("centros-anep wizard state", () => {
  describe("initial state (CA-15)", () => {
    it("should start on Conexión with the default tables, port 5432, invalid slots and no confirmation", () => {
      const state = initialCentrosAnepWizardState();

      expect(state.step).toBe(CentrosAnepStep.CONNECTION);
      expect(state.connection.port).toBe("5432");
      for (const role of CENTROS_ROLES) {
        expect(state.slots[role]).toEqual({ ...CENTROS_DEFAULT_TABLES[role], valid: false });
      }
      expect(state.confirmation).toEqual({ password: "", acknowledged: false });
    });

    it("should open on Conexión for an idle run and on Resultado for any other phase", () => {
      expect(initialCentrosAnepWizardStateFor({ phase: RunPhase.IDLE }).step).toBe(CentrosAnepStep.CONNECTION);
      expect(initialCentrosAnepWizardStateFor({ phase: RunPhase.RUNNING }).step).toBe(CentrosAnepStep.RESULT);
      expect(initialCentrosAnepWizardStateFor({ phase: RunPhase.DONE }).step).toBe(CentrosAnepStep.RESULT);
    });
  });

  describe("blocking reasons and navigation", () => {
    it("should block Conexión without host, with a bad port, without database or user", () => {
      const base = validState({ step: CentrosAnepStep.CONNECTION });

      expect(blockingReason({ ...base, connection: { ...base.connection, host: " " } })).toMatch(/servidor/i);
      expect(blockingReason({ ...base, connection: { ...base.connection, port: "abc" } })).toMatch(/puerto/i);
      expect(blockingReason({ ...base, connection: { ...base.connection, db_name: "" } })).toMatch(/base de datos/i);
      expect(blockingReason({ ...base, connection: { ...base.connection, user: "" } })).toMatch(/usuario/i);
      expect(blockingReason(base)).toBeNull();
      expect(canContinue(base)).toBe(true);
    });

    it("should block Tablas for a blank schema, a blank table, equal tables and invalid slots", () => {
      const base = validState({ step: CentrosAnepStep.TABLES });
      const staging = base.slots["centros-anep-staging"];
      const withStaging = (patch: Partial<typeof staging>): CentrosAnepWizardState => ({
        ...base,
        slots: { ...base.slots, "centros-anep-staging": { ...staging, ...patch } },
      });

      expect(blockingReason(withStaging({ schema: " " }))).toMatch(/esquema/i);
      expect(blockingReason(withStaging({ table: "" }))).toMatch(/tabla/i);
      expect(blockingReason(withStaging({ ...base.slots["centros-anep-final"] }))).toMatch(/distintas/);
      expect(blockingReason(withStaging({ valid: false }))).toMatch(/columnas/);
      expect(blockingReason(base)).toBeNull();
    });

    it("should never let Revisar or Resultado continue", () => {
      expect(canContinue(validState({ step: CentrosAnepStep.REVIEW }))).toBe(false);
      expect(canContinue(validState({ step: CentrosAnepStep.RESULT }))).toBe(false);
    });

    it("should move next only when the step is valid and back always", () => {
      const connected = validState({ step: CentrosAnepStep.CONNECTION });
      const broken = { ...connected, connection: { ...connected.connection, host: "" } };

      expect(reduce(connected, { type: "next" }).step).toBe(CentrosAnepStep.TABLES);
      expect(reduce(broken, { type: "next" }).step).toBe(CentrosAnepStep.CONNECTION);
      expect(reduce(connected, { type: "next" }, { type: "back" }).step).toBe(CentrosAnepStep.CONNECTION);
      expect(reduce(connected, { type: "back" }).step).toBe(CentrosAnepStep.CONNECTION);
    });

    it("should stop goTo at the first invalid step before the target", () => {
      const state = validState({ step: CentrosAnepStep.CONNECTION });
      const invalidTables = reduce(state, { type: "slotSchemaChanged", key: "centros-anep-final", schema: "otro" });

      expect(reduce(state, { type: "goTo", step: CentrosAnepStep.REVIEW }).step).toBe(CentrosAnepStep.REVIEW);
      expect(reduce(invalidTables, { type: "goTo", step: CentrosAnepStep.REVIEW }).step).toBe(CentrosAnepStep.TABLES);
    });

    it("should clear the typed confirmation when leaving Revisar", () => {
      const state = validState();

      const back = reduce(state, { type: "back" });

      expect(back.step).toBe(CentrosAnepStep.TABLES);
      expect(back.confirmation).toEqual({ password: "", acknowledged: false });
    });

    it("should go to Resultado on runStarted and clear the confirmation", () => {
      const next = reduce(validState(), { type: "runStarted" });

      expect(next.step).toBe(CentrosAnepStep.RESULT);
      expect(next.confirmation).toEqual({ password: "", acknowledged: false });
    });

    it("should return to the initial state on reset", () => {
      expect(reduce(validState(), { type: "reset" })).toEqual(initialCentrosAnepWizardState());
    });
  });

  describe("field reducers", () => {
    it("should invalidate the slots and the confirmation when a connection field other than the password changes", () => {
      const next = reduce(validState(), { type: "connectionChanged", field: "host", value: "otro" });

      expect(next.connection.host).toBe("otro");
      expect(CENTROS_ROLES.every((role) => !next.slots[role].valid)).toBe(true);
      expect(next.confirmation).toEqual({ password: "", acknowledged: false });
    });

    it("should only clear the confirmation, and keep the slots, when the password changes", () => {
      const next = reduce(validState(), { type: "connectionChanged", field: "password", value: "nueva" });

      expect(next.connection.password).toBe("nueva");
      expect(CENTROS_ROLES.every((role) => next.slots[role].valid)).toBe(true);
      expect(next.confirmation).toEqual({ password: "", acknowledged: false });
    });

    it("should reset the table and validity when the schema of a slot changes, and set them when a table is chosen", () => {
      const changed = reduce(validState(), { type: "slotSchemaChanged", key: "centros-anep-final", schema: "otro" });
      const chosen = reduce(changed, { type: "slotTableChosen", key: "centros-anep-final", table: "t", valid: true });

      expect(changed.slots["centros-anep-final"]).toEqual({ schema: "otro", table: "", valid: false });
      expect(chosen.slots["centros-anep-final"]).toEqual({ schema: "otro", table: "t", valid: true });
    });

    it("should merge confirmation patches", () => {
      const next = reduce(initialCentrosAnepWizardState(), { type: "confirmationChanged", patch: { acknowledged: true } }, {
        type: "confirmationChanged",
        patch: { password: "x" },
      });

      expect(next.confirmation).toEqual({ password: "x", acknowledged: true });
    });

    it("should exclude, per role, the table of the other role in the same schema only", () => {
      const state = initialCentrosAnepWizardState();
      const sameSchema = reduce(state, { type: "slotSchemaChanged", key: "centros-anep-final", schema: "bdj_carto" });

      expect(excludedCentrosAnepTablesOf(state)).toEqual({ "centros-anep-staging": [], "centros-anep-final": [] });
      expect(excludedCentrosAnepTablesOf(sameSchema)["centros-anep-final"]).toEqual(["ine_centros_anep"]);
    });
  });

  describe("toCentrosAnepStartRequest", () => {
    it("should trim values and set confirm from dryRun", () => {
      const state = validState({
        connection: { host: " h ", port: " 5432 ", db_name: " d ", user: " u ", password: PASSWORD },
      });
      state.slots["centros-anep-final"] = { schema: " carto ", table: " t ", valid: true };

      const dry = toCentrosAnepStartRequest(state, { dryRun: true });
      const real = toCentrosAnepStartRequest(state, { dryRun: false });

      expect(dry.connection).toMatchObject({ host: "h", db_name: "d", user: "u", password: PASSWORD });
      expect(dry.tables["centros-anep-final"]).toEqual({ schema: "carto", table: "t" });
      expect(dry).toMatchObject({ dryRun: true, confirm: false });
      expect(real).toMatchObject({ dryRun: false, confirm: true });
    });
  });

  describe("canAnalyzeNow and runBlockedReason", () => {
    it("should allow analysis when connection and tables are valid and the password is typed again", () => {
      expect(runBlockedReason(validState())).toBeNull();
      expect(canAnalyzeNow(validState())).toBe(true);
    });

    it("should refuse analysis without a typed password or with a different one", () => {
      expect(canAnalyzeNow(validState({ confirmation: { password: "", acknowledged: true } }))).toBe(false);
      expect(canAnalyzeNow(validState({ confirmation: { password: "otra", acknowledged: true } }))).toBe(false);
    });

    it("should let the connection reason win over the tables reason", () => {
      const state = validState();
      const broken = { ...state, connection: { ...state.connection, host: "" }, slots: { ...state.slots, "centros-anep-final": { schema: "", table: "", valid: false } } };

      expect(runBlockedReason(broken)).toMatch(/servidor/i);
    });
  });

  describe("canLoadNow (CA-15)", () => {
    it("should enable Cargar ahora without any prior analysis when password and confirmation are set", () => {
      expect(canLoadNow(validState())).toBe(true);
    });

    it("should disable it without the typed password, with a different one or without the destructive confirmation", () => {
      expect(canLoadNow(validState({ confirmation: { password: "", acknowledged: true } }))).toBe(false);
      expect(canLoadNow(validState({ confirmation: { password: "otra", acknowledged: true } }))).toBe(false);
      expect(canLoadNow(validState({ confirmation: { password: PASSWORD, acknowledged: false } }))).toBe(false);
    });

    it("should disable it when runBlockedReason is set (connection or tables)", () => {
      const state = validState();
      const noHost = { ...state, connection: { ...state.connection, host: "" } };
      const invalidSlot = { ...state, slots: { ...state.slots, "centros-anep-final": { schema: "carto", table: "t", valid: false } } };

      expect(runBlockedReason(noHost)).not.toBeNull();
      expect(canLoadNow(noHost)).toBe(false);
      expect(runBlockedReason(invalidSlot)).not.toBeNull();
      expect(canLoadNow(invalidSlot)).toBe(false);
    });
  });
});

describe("centrosAnepAnalysisKeyOf", () => {
  const request = toCentrosAnepStartRequest(validState(), { dryRun: true });

  it("should be stable and ignore the password and the dryRun flag", () => {
    const real = { ...request, dryRun: false, connection: { ...request.connection, password: "otra" } };

    expect(centrosAnepAnalysisKeyOf(request)).toBe(centrosAnepAnalysisKeyOf(real));
  });

  it("should change with the host, port, database, user or either table", () => {
    const key = centrosAnepAnalysisKeyOf(request);
    const variants = [
      { ...request, connection: { ...request.connection, host: "x" } },
      { ...request, connection: { ...request.connection, port: "1" } },
      { ...request, connection: { ...request.connection, db_name: "x" } },
      { ...request, connection: { ...request.connection, user: "x" } },
      { ...request, tables: { ...request.tables, "centros-anep-staging": { schema: "a", table: "b" } } },
      { ...request, tables: { ...request.tables, "centros-anep-final": { schema: "a", table: "b" } } },
    ];

    for (const variant of variants) expect(centrosAnepAnalysisKeyOf(variant)).not.toBe(key);
  });
});

describe("centros-anep wizard steps (CA-15)", () => {
  it("should define Conexión, Tablas, Revisar and Resultado in order", () => {
    const steps = buildCentrosAnepWizardSteps(validState({ step: CentrosAnepStep.CONNECTION }));

    expect(steps.map((step) => step.title)).toEqual(["Conexión", "Tablas", "Revisar", "Resultado"]);
    expect(steps.map((step) => step.id)).toEqual([1, 2, 3, 4]);
  });

  it("should let only the current step proceed, and only when it is valid", () => {
    const connection = buildCentrosAnepWizardSteps(validState({ step: CentrosAnepStep.CONNECTION }));
    const review = buildCentrosAnepWizardSteps(validState({ step: CentrosAnepStep.REVIEW }));

    expect(connection.map((step) => step.canProceed)).toEqual([true, false, false, false]);
    expect(review.every((step) => !step.canProceed)).toBe(true);
  });

  it("should map steps to ids and back, falling back to Conexión for an unknown id", () => {
    expect(centrosAnepStepIdOf(CentrosAnepStep.RESULT)).toBe(4);
    expect(centrosAnepStepOfId(3)).toBe(CentrosAnepStep.REVIEW);
    expect(centrosAnepStepOfId(0)).toBe(CentrosAnepStep.CONNECTION);
    expect(centrosAnepStepOfId(99)).toBe(CentrosAnepStep.CONNECTION);
  });
});
