import { describe, expect, it } from "vitest";
import {
  blockingReason,
  canContinue,
  canRunNow,
  connectionFieldInvalidatesCatalog,
  initialWizardState,
  initialWizardStateFor,
  isRealRunConfirmed,
  runBlockedReason,
  toStartRequest,
  wizardReducer,
  WizardStep,
  type ConnectionField,
  type WizardState,
} from "@/modules/routine-jobs/ui/cargarPadronesWizardState";
import type { JobSetup } from "@/modules/routine-jobs/ui/jobProfileStorage";

const PASSWORD = "s3cret-pw";

function withConnection(overrides: Partial<WizardState["connection"]> = {}): WizardState {
  const base = initialWizardState();
  return {
    ...base,
    connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD, ...overrides },
  };
}

function withTables(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...withConnection(),
    step: WizardStep.TABLES,
    schema: "carto",
    tables: { rural: "rural", urbano: "urbano", target: "destino" },
    tableValidity: { rural: true, urbano: true, target: true },
    ...overrides,
  };
}

const at = (step: WizardState["step"], base: WizardState = withTables()): WizardState => ({ ...base, step });

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe("cargarPadronesWizardState", () => {
  describe("WizardStep", () => {
    it("AC-30: should expose the five steps in their documented values", () => {
      expect(WizardStep).toEqual({
        CONNECTION: "connection",
        TABLES: "tables",
        OPTIONS: "options",
        REVIEW: "review",
        RESULT: "result",
      });
    });
  });

  describe("initialWizardState", () => {
    it("AC-30: should start at the connection step with documented defaults", () => {
      expect(initialWizardState()).toEqual({
        step: "connection",
        connection: { host: "", port: "5432", db_name: "", user: "", password: "" },
        schema: "",
        tables: { rural: "", urbano: "", target: "" },
        tableValidity: { rural: false, urbano: false, target: false },
        options: { repair: true, clearMode: "delete", resetSequences: true },
        confirmation: { password: "", targetLabel: "" },
      });
    });

    it("AC-30: should return independent objects on every call", () => {
      const first = initialWizardState();
      first.connection.host = "mutado";

      expect(initialWizardState().connection.host).toBe("");
    });
  });

  describe("canContinue: connection step", () => {
    it("AC-30: should not continue from the initial state", () => {
      expect(canContinue(initialWizardState())).toBe(false);
    });

    it("AC-30: should continue with host, user, database and a valid port", () => {
      expect(canContinue(withConnection())).toBe(true);
    });

    it("AC-30: should continue with an empty password", () => {
      expect(canContinue(withConnection({ password: "" }))).toBe(true);
    });

    it.each(["host", "user", "db_name"] as const)("AC-30: should not continue with an empty %s", (field) => {
      expect(canContinue(withConnection({ [field]: "" }))).toBe(false);
    });

    it.each(["host", "user", "db_name"] as const)("AC-30: should not continue with a blank %s", (field) => {
      expect(canContinue(withConnection({ [field]: "   " }))).toBe(false);
    });

    it.each(["1", "5432", "65535"])("AC-30: should accept the port %s", (port) => {
      expect(canContinue(withConnection({ port }))).toBe(true);
    });

    it.each(["", "0", "65536", "-1", "abc", "12.5", " "])("AC-30: should reject the port %j", (port) => {
      expect(canContinue(withConnection({ port }))).toBe(false);
    });
  });

  describe("canContinue: tables step", () => {
    it("AC-30: should continue with a schema and three distinct valid tables", () => {
      expect(canContinue(withTables())).toBe(true);
    });

    it("AC-30: should not continue without a schema", () => {
      expect(canContinue(withTables({ schema: "" }))).toBe(false);
    });

    it("AC-30: should not continue with a blank schema", () => {
      expect(canContinue(withTables({ schema: "  " }))).toBe(false);
    });

    it.each(["rural", "urbano", "target"] as const)("AC-30: should not continue with an empty %s table", (role) => {
      const base = withTables();

      expect(canContinue({ ...base, tables: { ...base.tables, [role]: "" } })).toBe(false);
    });

    it.each(["rural", "urbano", "target"] as const)("AC-30: should not continue with a blank %s table", (role) => {
      const base = withTables();

      expect(canContinue({ ...base, tables: { ...base.tables, [role]: "   " } })).toBe(false);
    });

    it.each([
      ["rural", "rural", "x"],
      ["rural", "x", "rural"],
      ["x", "urbano", "urbano"],
      ["x", "x", "x"],
    ])("AC-30: should not continue with repeated tables %s / %s / %s", (rural, urbano, target) => {
      expect(canContinue(withTables({ tables: { rural, urbano, target } }))).toBe(false);
    });

    it.each(["rural", "urbano", "target"] as const)("AC-30: should not continue when the %s table is not valid", (role) => {
      const base = withTables();

      expect(canContinue({ ...base, tableValidity: { ...base.tableValidity, [role]: false } })).toBe(false);
    });
  });

  describe("canContinue: other steps", () => {
    it("AC-30: should always continue from the options step", () => {
      expect(canContinue(at(WizardStep.OPTIONS))).toBe(true);
      expect(canContinue(at(WizardStep.OPTIONS, initialWizardState()))).toBe(true);
    });

    it("AC-30: should not continue from the review step", () => {
      expect(canContinue(at(WizardStep.REVIEW))).toBe(false);
    });

    it("AC-30: should not continue from the result step", () => {
      expect(canContinue(at(WizardStep.RESULT))).toBe(false);
    });
  });

  describe("blockingReason", () => {
    it("AC-30: should be null when the current step can continue", () => {
      expect(blockingReason(withConnection())).toBeNull();
      expect(blockingReason(withTables())).toBeNull();
      expect(blockingReason(at(WizardStep.OPTIONS))).toBeNull();
    });

    it("AC-30: should give a non-empty Spanish reason when the connection step cannot continue", () => {
      const reason = blockingReason(initialWizardState());

      expect(typeof reason).toBe("string");
      expect((reason ?? "").trim().length).toBeGreaterThan(0);
    });

    it("AC-30: should mention the port when only the port is wrong", () => {
      expect(blockingReason(withConnection({ port: "65536" }))).toMatch(/puerto/i);
    });

    it("AC-30: should give a reason when the schema is missing on the tables step", () => {
      const reason = blockingReason(withTables({ schema: "" }));

      expect((reason ?? "").trim().length).toBeGreaterThan(0);
    });

    it("AC-30: should mention distinct tables when two roles share a table", () => {
      const reason = blockingReason(withTables({ tables: { rural: "a", urbano: "a", target: "b" } }));

      expect(reason).toMatch(/distint/i);
    });

    it("AC-30: should give a reason when a table is not valid", () => {
      const base = withTables();
      const reason = blockingReason({ ...base, tableValidity: { ...base.tableValidity, target: false } });

      expect((reason ?? "").trim().length).toBeGreaterThan(0);
    });

    it("AC-30: should agree with canContinue on every connection and tables case", () => {
      const states = [
        initialWizardState(),
        withConnection(),
        withConnection({ port: "0" }),
        withTables(),
        withTables({ schema: "" }),
        withTables({ tables: { rural: "a", urbano: "a", target: "b" } }),
      ];

      for (const state of states) {
        expect(blockingReason(state) === null).toBe(canContinue(state));
      }
    });
  });

  describe("wizardReducer: connection and schema", () => {
    it("AC-30: should update the changed connection field only", () => {
      const next = wizardReducer(initialWizardState(), { type: "connectionChanged", field: "host", value: "db.local" });

      expect(next.connection).toEqual({ host: "db.local", port: "5432", db_name: "", user: "", password: "" });
    });

    it.each(["host", "port", "db_name", "user"] as const)(
      "AC-30: should clear tables, validity and confirmation when %s changes but keep the schema",
      (field) => {
        const state = withTables({ confirmation: { password: "abc", targetLabel: "destino" } });

        const next = wizardReducer(state, { type: "connectionChanged", field, value: "otro" });

        expect(next.tables).toEqual({ rural: "", urbano: "", target: "" });
        expect(next.tableValidity).toEqual({ rural: false, urbano: false, target: false });
        expect(next.confirmation).toEqual({ password: "", targetLabel: "" });
        expect(next.schema).toBe("carto");
      },
    );

    it("AC-30: should keep tables, validity and schema when only the password changes", () => {
      const next = wizardReducer(withTables(), { type: "connectionChanged", field: "password", value: "otra" });

      expect(next.connection.password).toBe("otra");
      expect(next.tables).toEqual({ rural: "rural", urbano: "urbano", target: "destino" });
      expect(next.tableValidity).toEqual({ rural: true, urbano: true, target: true });
      expect(next.schema).toBe("carto");
    });

    it("AC-30: should clear only the confirmation when the password changes", () => {
      const state = withTables({ confirmation: { password: "abc", targetLabel: "destino" } });

      const next = wizardReducer(state, { type: "connectionChanged", field: "password", value: "otra" });

      expect(next.confirmation).toEqual({ password: "", targetLabel: "" });
    });

    it("AC-30: should keep a loaded setup through a password change and clear it on a later host change", () => {
      const loaded: JobSetup = {
        host: "db.local",
        port: "5432",
        db_name: "gis",
        user: "carto",
        schema: "carto",
        ruralTable: "rural",
        urbanoTable: "urbano",
        targetTable: "destino",
        options: { repair: false, clearMode: "truncate", resetSequences: false },
      };
      let state = wizardReducer(initialWizardState(), { type: "loadSetup", setup: loaded });
      state = wizardReducer(state, { type: "tableChosen", role: "rural", table: "rural", valid: true });
      state = wizardReducer(state, { type: "tableChosen", role: "urbano", table: "urbano", valid: true });
      state = wizardReducer(state, { type: "tableChosen", role: "target", table: "destino", valid: true });

      const afterPassword = wizardReducer(state, { type: "connectionChanged", field: "password", value: PASSWORD });

      expect(afterPassword.schema).toBe("carto");
      expect(afterPassword.tables).toEqual({ rural: "rural", urbano: "urbano", target: "destino" });
      expect(afterPassword.tableValidity).toEqual({ rural: true, urbano: true, target: true });

      const afterHost = wizardReducer(afterPassword, { type: "connectionChanged", field: "host", value: "otro" });

      expect(afterHost.tables).toEqual({ rural: "", urbano: "", target: "" });
      expect(afterHost.tableValidity).toEqual({ rural: false, urbano: false, target: false });
      expect(afterHost.schema).toBe("carto");
    });

    it("AC-30: should clear the three tables and their validity when the schema changes", () => {
      const next = wizardReducer(withTables(), { type: "schemaChanged", schema: "otro" });

      expect(next.schema).toBe("otro");
      expect(next.tables).toEqual({ rural: "", urbano: "", target: "" });
      expect(next.tableValidity).toEqual({ rural: false, urbano: false, target: false });
    });

    it("AC-30: should keep the connection when the schema changes", () => {
      const state = withTables();

      expect(wizardReducer(state, { type: "schemaChanged", schema: "otro" }).connection).toEqual(state.connection);
    });

    it("AC-30: should not mutate the previous state", () => {
      const state = deepFreeze(withTables());

      expect(() => {
        wizardReducer(state, { type: "connectionChanged", field: "host", value: "x" });
        wizardReducer(state, { type: "schemaChanged", schema: "x" });
      }).not.toThrow();
      expect(state.connection.host).toBe("db.local");
    });
  });

  describe("wizardReducer: tables, options, confirmation", () => {
    it("AC-30: should record the chosen table and its validity for the role", () => {
      const next = wizardReducer(initialWizardState(), { type: "tableChosen", role: "urbano", table: "u", valid: true });

      expect(next.tables).toEqual({ rural: "", urbano: "u", target: "" });
      expect(next.tableValidity).toEqual({ rural: false, urbano: true, target: false });
    });

    it("AC-30: should overwrite validity when the same role is chosen again as invalid", () => {
      const next = wizardReducer(withTables(), { type: "tableChosen", role: "rural", table: "otra", valid: false });

      expect(next.tables.rural).toBe("otra");
      expect(next.tableValidity.rural).toBe(false);
      expect(next.tableValidity.urbano).toBe(true);
    });

    it("AC-30: should merge an options patch", () => {
      const next = wizardReducer(initialWizardState(), { type: "optionsChanged", patch: { clearMode: "truncate" } });

      expect(next.options).toEqual({ repair: true, clearMode: "truncate", resetSequences: true });
    });

    it("AC-30: should merge a confirmation patch", () => {
      const first = wizardReducer(initialWizardState(), { type: "confirmationChanged", patch: { password: "abc" } });
      const next = wizardReducer(first, { type: "confirmationChanged", patch: { targetLabel: "destino" } });

      expect(next.confirmation).toEqual({ password: "abc", targetLabel: "destino" });
    });
  });

  describe("wizardReducer: navigation", () => {
    it("AC-30: should advance from connection to tables when the connection is valid", () => {
      const next = wizardReducer(withConnection(), { type: "next" });

      expect(next.step).toBe("tables");
    });

    it("AC-30: should stay on the connection step when it cannot continue", () => {
      const state = initialWizardState();

      expect(wizardReducer(state, { type: "next" }).step).toBe("connection");
    });

    it("AC-30: should walk connection, tables, options and review with valid data", () => {
      let state: WizardState = { ...withTables(), step: WizardStep.CONNECTION };
      const visited: string[] = [state.step];

      for (let index = 0; index < 3; index++) {
        state = wizardReducer(state, { type: "next" });
        visited.push(state.step);
      }

      expect(visited).toEqual(["connection", "tables", "options", "review"]);
    });

    it("AC-30: should stay on the tables step when the tables cannot continue", () => {
      const state = withTables({ tables: { rural: "a", urbano: "a", target: "b" } });

      expect(wizardReducer(state, { type: "next" }).step).toBe("tables");
    });

    it("AC-30: should not advance past review through next", () => {
      expect(wizardReducer(at(WizardStep.REVIEW), { type: "next" }).step).toBe("review");
    });

    it("AC-30: should never advance past result", () => {
      expect(wizardReducer(at(WizardStep.RESULT), { type: "next" }).step).toBe("result");
    });

    it("AC-30: should go back one step at a time", () => {
      expect(wizardReducer(at(WizardStep.TABLES), { type: "back" }).step).toBe("connection");
      expect(wizardReducer(at(WizardStep.OPTIONS), { type: "back" }).step).toBe("tables");
      expect(wizardReducer(at(WizardStep.REVIEW), { type: "back" }).step).toBe("options");
    });

    it("AC-30: should never go back before the connection step", () => {
      expect(wizardReducer(at(WizardStep.CONNECTION), { type: "back" }).step).toBe("connection");
    });

    it("AC-30: should keep the data when going back", () => {
      const state = at(WizardStep.OPTIONS);

      const next = wizardReducer(state, { type: "back" });

      expect(next.tables).toEqual(state.tables);
      expect(next.tableValidity).toEqual(state.tableValidity);
    });

    it("AC-30: should jump to an earlier step with goTo", () => {
      expect(wizardReducer(at(WizardStep.REVIEW), { type: "goTo", step: WizardStep.CONNECTION }).step).toBe(
        "connection",
      );
    });

    it("AC-30: should move to the result step with goTo when the run is started", () => {
      expect(wizardReducer(at(WizardStep.REVIEW), { type: "goTo", step: WizardStep.RESULT }).step).toBe("result");
    });
  });

  describe("wizardReducer: loadSetup and reset", () => {
    const loaded: JobSetup = {
      host: "otro.host",
      port: "6543",
      db_name: "otra",
      user: "otro",
      schema: "s2",
      ruralTable: "r2",
      urbanoTable: "u2",
      targetTable: "t2",
      options: { repair: false, clearMode: "truncate", resetSequences: false },
    };

    it("AC-30: should apply the setup to connection, schema, tables and options", () => {
      const next = wizardReducer(initialWizardState(), { type: "loadSetup", setup: loaded });

      expect(next.connection).toMatchObject({ host: "otro.host", port: "6543", db_name: "otra", user: "otro" });
      expect(next.schema).toBe("s2");
      expect(next.tables).toEqual({ rural: "r2", urbano: "u2", target: "t2" });
      expect(next.options).toEqual(loaded.options);
    });

    it("AC-30: should keep the password typed before loading the setup", () => {
      const next = wizardReducer(withConnection({ password: PASSWORD }), { type: "loadSetup", setup: loaded });

      expect(next.connection.password).toBe(PASSWORD);
    });

    it("AC-30: should clear validity until the tables are checked again", () => {
      const next = wizardReducer(withTables(), { type: "loadSetup", setup: loaded });

      expect(next.tableValidity).toEqual({ rural: false, urbano: false, target: false });
      expect(canContinue({ ...next, step: WizardStep.TABLES })).toBe(false);
    });

    it("AC-30: should return to the initial state on reset", () => {
      const next = wizardReducer(
        { ...withTables(), step: WizardStep.RESULT, confirmation: { password: PASSWORD, targetLabel: "destino" } },
        { type: "reset" },
      );

      expect(next).toEqual(initialWizardState());
    });
  });

  describe("isRealRunConfirmed", () => {
    const confirmed = (confirmation: Partial<WizardState["confirmation"]>, state = withTables()): WizardState => ({
      ...state,
      step: WizardStep.REVIEW,
      confirmation: { password: PASSWORD, targetLabel: "destino", ...confirmation },
    });

    it("AC-30: should confirm when password and target label match exactly", () => {
      expect(isRealRunConfirmed(confirmed({}))).toBe(true);
    });

    it("AC-30: should not confirm with a different password", () => {
      expect(isRealRunConfirmed(confirmed({ password: "otra" }))).toBe(false);
    });

    it("AC-30: should not confirm with an empty password when the connection has one", () => {
      expect(isRealRunConfirmed(confirmed({ password: "" }))).toBe(false);
    });

    it("AC-30: should not confirm a password that differs only by case or whitespace", () => {
      expect(isRealRunConfirmed(confirmed({ password: PASSWORD.toUpperCase() }))).toBe(false);
      expect(isRealRunConfirmed(confirmed({ password: `${PASSWORD} ` }))).toBe(false);
    });

    it("AC-30: should not confirm a different target label", () => {
      expect(isRealRunConfirmed(confirmed({ targetLabel: "otra" }))).toBe(false);
    });

    it("AC-30: should not confirm a target label that differs only by case or trailing space", () => {
      expect(isRealRunConfirmed(confirmed({ targetLabel: "DESTINO" }))).toBe(false);
      expect(isRealRunConfirmed(confirmed({ targetLabel: "destino " }))).toBe(false);
    });

    it("AC-30: should not confirm with an empty target label", () => {
      expect(isRealRunConfirmed(confirmed({ targetLabel: "" }))).toBe(false);
    });

    it("AC-30: should confirm an empty password only when the connection password is empty", () => {
      const state = { ...withTables(), connection: { ...withTables().connection, password: "" } };

      expect(isRealRunConfirmed(confirmed({ password: "" }, state))).toBe(true);
      expect(isRealRunConfirmed(confirmed({ password: "x" }, state))).toBe(false);
    });
  });

  describe("toStartRequest", () => {
    const review = (): WizardState => ({
      ...withTables(),
      step: WizardStep.REVIEW,
      options: { repair: false, clearMode: "truncate", resetSequences: false },
    });

    it("AC-30: should build a real run request with confirm true", () => {
      const request = toStartRequest(review(), { dryRun: false });

      expect(request).toEqual({
        connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD },
        schema: "carto",
        ruralTable: "rural",
        urbanoTable: "urbano",
        targetTable: "destino",
        options: { repair: false, clearMode: "truncate", resetSequences: false },
        dryRun: false,
        confirm: true,
      });
    });

    it("AC-30: should build a dry run request with confirm false", () => {
      const request = toStartRequest(review(), { dryRun: true });

      expect(request.dryRun).toBe(true);
      expect(request.confirm).toBe(false);
    });

    it("AC-30: should not mutate the state", () => {
      const state = deepFreeze(review());
      const snapshot = JSON.stringify(state);

      expect(() => toStartRequest(state, { dryRun: false })).not.toThrow();
      expect(JSON.stringify(state)).toBe(snapshot);
    });

    it("AC-30: should send the connection password, never the confirmation password", () => {
      const state: WizardState = { ...review(), confirmation: { password: "otra", targetLabel: "destino" } };

      expect(toStartRequest(state, { dryRun: false }).connection.password).toBe(PASSWORD);
    });
  });

  describe("initialWizardStateFor", () => {
    const phases = ["idle", "starting", "running", "done", "failed", "unknown"] as const;

    it("AC-30: should equal the initial state at the connection step for an idle run", () => {
      expect(initialWizardStateFor({ phase: "idle" })).toEqual(initialWizardState());
    });

    it.each(phases.filter((phase) => phase !== "idle"))(
      "AC-30: should open on the result step, with every other field at its default, when the run is %s",
      (phase) => {
        const state = initialWizardStateFor({ phase });

        expect(state).toEqual({ ...initialWizardState(), step: WizardStep.RESULT });
      },
    );
  });

  describe("wizardReducer: runStarted", () => {
    const reviewState = (): WizardState =>
      withTables({
        step: WizardStep.REVIEW,
        confirmation: { password: PASSWORD, targetLabel: "destino" },
        options: { repair: false, clearMode: "truncate", resetSequences: false },
      });

    it("AC-30: should empty the confirmation and move to the result step", () => {
      const next = wizardReducer(reviewState(), { type: "runStarted" });

      expect(next.confirmation).toEqual({ password: "", targetLabel: "" });
      expect(next.step).toBe(WizardStep.RESULT);
    });

    it("AC-30: should keep connection, schema, tables, validity and options", () => {
      const state = reviewState();

      const next = wizardReducer(state, { type: "runStarted" });

      expect(next.connection).toEqual(state.connection);
      expect(next.schema).toBe(state.schema);
      expect(next.tables).toEqual(state.tables);
      expect(next.tableValidity).toEqual(state.tableValidity);
      expect(next.options).toEqual(state.options);
    });

    it("AC-30: should not mutate the previous state", () => {
      const state = deepFreeze(reviewState());

      expect(() => wizardReducer(state, { type: "runStarted" })).not.toThrow();
      expect(state.confirmation).toEqual({ password: PASSWORD, targetLabel: "destino" });
      expect(state.step).toBe(WizardStep.REVIEW);
    });

    it("AC-30: should leave the real run unconfirmed afterwards", () => {
      const next = wizardReducer(reviewState(), { type: "runStarted" });

      expect(isRealRunConfirmed(next)).toBe(false);
    });
  });

  describe("wizardReducer: back to review from the result", () => {
    it("AC-30: should keep connection, tables, validity and options when going from result back to review", () => {
      const state = withTables({
        step: WizardStep.RESULT,
        options: { repair: false, clearMode: "truncate", resetSequences: false },
      });

      const next = wizardReducer(state, { type: "goTo", step: WizardStep.REVIEW });

      expect(next.step).toBe(WizardStep.REVIEW);
      expect(next.connection).toEqual(state.connection);
      expect(next.tables).toEqual(state.tables);
      expect(next.tableValidity).toEqual(state.tableValidity);
      expect(next.options).toEqual(state.options);
    });
  });

  describe("runBlockedReason", () => {
    const RUN_PHASES = ["starting", "running", "done", "failed", "unknown"] as const;

    it("AC-32: should block the initial state with the connection reason", () => {
      const reason = runBlockedReason(initialWizardState());

      expect(reason).toBe(blockingReason(initialWizardState()));
      expect(reason).toBe("Indique el servidor (host).");
    });

    it("AC-32: should allow the run when the connection and the tables are both valid", () => {
      expect(runBlockedReason(withTables())).toBeNull();
      expect(runBlockedReason(at(WizardStep.REVIEW))).toBeNull();
    });

    it("AC-32: should report canRunNow true when the connection and the tables are both valid", () => {
      expect(canRunNow(at(WizardStep.REVIEW))).toBe(true);
    });

    it("AC-32: should block with the tables reason when only the tables are invalid", () => {
      const base = withTables();
      const state: WizardState = { ...base, tableValidity: { ...base.tableValidity, target: false } };

      expect(runBlockedReason(state)).toBe(blockingReason({ ...state, step: WizardStep.TABLES }));
      expect(runBlockedReason(state)).not.toBeNull();
      expect(canRunNow(state)).toBe(false);
    });

    it("AC-32: should block with the connection reason when only the connection is invalid", () => {
      const state = withConnection({ port: "0" });

      expect(runBlockedReason(state)).toBe(blockingReason(state));
      expect(runBlockedReason(state)).toMatch(/puerto/i);
      expect(canRunNow(state)).toBe(false);
    });

    it("AC-32: should prefer the connection reason when the connection and the tables both fail", () => {
      const state: WizardState = { ...withConnection({ host: "" }), schema: "", tables: { rural: "", urbano: "", target: "" } };

      expect(runBlockedReason(state)).toBe(blockingReason(withConnection({ host: "" })));
      expect(runBlockedReason(state)).toBe("Indique el servidor (host).");
    });

    it("AC-32: should block a schema-less state with the schema reason", () => {
      expect(runBlockedReason(withTables({ schema: "" }))).toBe("Indique el esquema de las tablas.");
    });

    it.each(RUN_PHASES)("AC-32: should block a state re-attached to a %s run", (phase) => {
      const reattached = initialWizardStateFor({ phase });

      expect(runBlockedReason(reattached)).not.toBeNull();
      expect(canRunNow(reattached)).toBe(false);
    });
  });

  describe("connectionFieldInvalidatesCatalog", () => {
    const FIELDS: readonly ConnectionField[] = ["host", "port", "db_name", "user", "password"];

    it.each(FIELDS)("AC-32: should invalidate the catalog failures when %s changes", (field) => {
      expect(connectionFieldInvalidatesCatalog(field)).toBe(true);
    });
  });
});
