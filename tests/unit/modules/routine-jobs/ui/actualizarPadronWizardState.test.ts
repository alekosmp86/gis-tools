import { describe, expect, it } from "vitest";
import {
  actualizarExcludedFor,
  ActualizarTableKey,
  blockingReason,
  canContinue,
  canRunNow,
  initialWizardState,
  initialWizardStateFor,
  isRealRunConfirmed,
  roleOfTableKey,
  runBlockedReason,
  schemaFieldOf,
  toStartRequest,
  wizardReducer,
  WizardStep,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";

const PASSWORD = "s3cret-pw";
const WORK_TABLE = "padron_trabajo";
const ALL_KEYS = [
  ActualizarTableKey.STAGING,
  ActualizarTableKey.WORK,
  ActualizarTableKey.PADRON,
  ActualizarTableKey.PROVINCE,
  ActualizarTableKey.LOCALITY,
] as const;

function withConnection(overrides: Partial<ActualizarWizardState["connection"]> = {}): ActualizarWizardState {
  const base = initialWizardState();
  return {
    ...base,
    connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD, ...overrides },
  };
}

function withTables(overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState {
  return {
    ...withConnection(),
    step: WizardStep.TABLES,
    stagingSchema: "bdj_carto",
    workSchema: "carto",
    tables: {
      staging: "catastro_paispadron_stg",
      work: WORK_TABLE,
      padron: "padron",
      province: "province",
      locality: "cadastral_locality",
    },
    tableValidity: { staging: true, work: true, padron: true, province: true, locality: true },
    ...overrides,
  };
}

const at = (step: WizardStep, base: ActualizarWizardState = withTables()): ActualizarWizardState => ({ ...base, step });

const confirmed = (base: ActualizarWizardState = withTables()): ActualizarWizardState => ({
  ...base,
  step: WizardStep.REVIEW,
  confirmation: { password: PASSWORD, workTableLabel: WORK_TABLE },
});

const snapshotOf = (phase: ActualizarPadronRunSnapshot["phase"]): ActualizarPadronRunSnapshot => ({ phase });

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe("actualizarPadronWizardState", () => {
  describe("WizardStep", () => {
    it("AP-27: should expose the five steps in their documented values", () => {
      expect(WizardStep).toEqual({
        CONNECTION: "connection",
        TABLES: "tables",
        OPTIONS: "options",
        REVIEW: "review",
        RESULT: "result",
      });
    });
  });

  describe("ActualizarTableKey", () => {
    it("AP-29: should name the five tables of the job", () => {
      expect(ActualizarTableKey).toEqual({
        STAGING: "staging",
        WORK: "work",
        PADRON: "padron",
        PROVINCE: "province",
        LOCALITY: "locality",
      });
    });
  });

  describe("roleOfTableKey", () => {
    it.each([
      ["staging", "actualizar-staging"],
      ["work", "actualizar-temp"],
      ["padron", "actualizar-padron"],
      ["province", "actualizar-provincia"],
      ["locality", "actualizar-localidad"],
    ] as const)("AP-1: should map the %s table to the catalog role %s", (key, role) => {
      expect(roleOfTableKey(key)).toBe(role);
    });
  });

  describe("schemaFieldOf", () => {
    it("AP-28: should read only the staging table from the staging schema", () => {
      expect(schemaFieldOf("staging")).toBe("stagingSchema");
    });

    it.each(["work", "padron", "province", "locality"] as const)(
      "AP-28: should read the %s table from the work schema",
      (key) => {
        expect(schemaFieldOf(key)).toBe("workSchema");
      },
    );
  });

  describe("initialWizardState", () => {
    it("AP-27: should start at the connection step with empty fields and the delete clear mode", () => {
      expect(initialWizardState()).toEqual({
        step: "connection",
        connection: { host: "", port: "5432", db_name: "", user: "", password: "" },
        stagingSchema: "",
        workSchema: "",
        tables: { staging: "", work: "", padron: "", province: "", locality: "" },
        tableValidity: { staging: false, work: false, padron: false, province: false, locality: false },
        options: { clearMode: "delete" },
        confirmation: { password: "", workTableLabel: "" },
      });
    });

    it("AP-27: should return independent objects on every call", () => {
      const first = initialWizardState();
      first.connection.host = "mutado";

      expect(initialWizardState().connection.host).toBe("");
    });
  });

  describe("canContinue and blockingReason: connection step", () => {
    it("AP-27: should not continue from the initial state", () => {
      expect(canContinue(initialWizardState())).toBe(false);
      expect(blockingReason(initialWizardState())).not.toBeNull();
    });

    it("AP-27: should continue with host, user, database and a valid port", () => {
      expect(canContinue(withConnection())).toBe(true);
      expect(blockingReason(withConnection())).toBeNull();
    });

    it.each(["host", "user", "db_name"] as const)("AP-27: should not continue with an empty %s", (field) => {
      expect(canContinue(withConnection({ [field]: "" }))).toBe(false);
    });

    it.each(["host", "user", "db_name"] as const)("AP-27: should not continue with a blank %s", (field) => {
      expect(canContinue(withConnection({ [field]: "   " }))).toBe(false);
    });

    it.each(["1", "5432", "65535"])("AP-27: should accept the port %s", (port) => {
      expect(canContinue(withConnection({ port }))).toBe(true);
    });

    it.each(["", "0", "65536", "-1", "abc", "12.5"])("AP-27: should reject the port %j", (port) => {
      expect(canContinue(withConnection({ port }))).toBe(false);
    });
  });

  describe("canContinue and blockingReason: tables step", () => {
    it("AP-27: should continue with two schemas and five distinct valid tables", () => {
      expect(canContinue(withTables())).toBe(true);
      expect(blockingReason(withTables())).toBeNull();
    });

    it.each(["stagingSchema", "workSchema"] as const)("AP-27: should not continue without the %s", (field) => {
      expect(canContinue(withTables({ [field]: "   " }))).toBe(false);
      expect(blockingReason(withTables({ [field]: "" }))).not.toBeNull();
    });

    it.each(ALL_KEYS)("AP-29: should not continue with an empty %s table", (key) => {
      const base = withTables();

      expect(canContinue({ ...base, tables: { ...base.tables, [key]: "" } })).toBe(false);
    });

    it.each(ALL_KEYS)("AP-29: should not continue with a blank %s table", (key) => {
      const base = withTables();

      expect(canContinue({ ...base, tables: { ...base.tables, [key]: "  " } })).toBe(false);
    });

    it.each(ALL_KEYS)("AP-29: should not continue when the %s table is not valid", (key) => {
      const base = withTables();

      expect(canContinue({ ...base, tableValidity: { ...base.tableValidity, [key]: false } })).toBe(false);
    });

    it("AP-3: should refuse a staging table that repeats the work table in the same schema", () => {
      const base = withTables({ stagingSchema: "carto", workSchema: "carto" });

      expect(canContinue({ ...base, tables: { ...base.tables, staging: WORK_TABLE } })).toBe(false);
      expect(blockingReason({ ...base, tables: { ...base.tables, staging: WORK_TABLE } })).not.toBeNull();
    });

    it("AP-3: should accept the same table name in two different schemas", () => {
      const base = withTables({ stagingSchema: "bdj_carto", workSchema: "carto" });

      expect(canContinue({ ...base, tables: { ...base.tables, staging: WORK_TABLE } })).toBe(true);
    });

    it.each([
      ["padron", "province"],
      ["province", "locality"],
      ["work", "padron"],
    ] as const)("AP-3: should refuse the repeated %s / %s pair", (first, second) => {
      const base = withTables();

      expect(canContinue({ ...base, tables: { ...base.tables, [second]: base.tables[first] } })).toBe(false);
    });

    it("AP-3: should refuse a repeated table whose names differ only by surrounding spaces", () => {
      const base = withTables();

      expect(canContinue({ ...base, tables: { ...base.tables, province: " padron " } })).toBe(false);
    });
  });

  describe("canContinue: options and later steps", () => {
    it("AP-30: should always continue from the options step", () => {
      expect(canContinue(at(WizardStep.OPTIONS))).toBe(true);
    });

    it("AP-27: should not continue from the review step", () => {
      expect(canContinue(at(WizardStep.REVIEW))).toBe(false);
    });

    it("AP-27: should not block the options, review or result steps", () => {
      for (const step of [WizardStep.OPTIONS, WizardStep.REVIEW, WizardStep.RESULT]) {
        expect(blockingReason(at(step, withConnection())), step).toBeNull();
      }
    });
  });

  describe("runBlockedReason", () => {
    it("AP-27: should report the connection reason first when both the connection and the tables are wrong", () => {
      const state = withTables({ tables: { staging: "", work: "", padron: "", province: "", locality: "" } });

      expect(runBlockedReason({ ...state, connection: { ...state.connection, host: "" } })).toBe(
        blockingReason(withConnection({ host: "" })),
      );
    });

    it("AP-27: should report nothing when the connection and the tables are complete", () => {
      expect(runBlockedReason(withTables())).toBeNull();
    });
  });

  describe("isRealRunConfirmed", () => {
    it("AP-31: should confirm a real run when the password and the work table name match", () => {
      expect(isRealRunConfirmed(confirmed())).toBe(true);
    });

    it("AP-31: should not confirm when the typed work table name differs in case", () => {
      const state = confirmed();

      expect(isRealRunConfirmed({ ...state, confirmation: { ...state.confirmation, workTableLabel: "PADRON_TRABAJO" } })).toBe(false);
    });

    it("AP-31: should not confirm when the work table name is empty", () => {
      const state = confirmed();

      expect(isRealRunConfirmed({ ...state, confirmation: { password: "", workTableLabel: "" } })).toBe(false);
    });

    it("AP-31: should not confirm when the password does not match the connection password", () => {
      const state = confirmed();

      expect(isRealRunConfirmed({ ...state, confirmation: { ...state.confirmation, password: "otra" } })).toBe(false);
    });

    it("AP-31: should not confirm when the password is empty", () => {
      const state = confirmed(withConnection({ password: "" }));

      expect(isRealRunConfirmed({ ...state, confirmation: { password: "", workTableLabel: WORK_TABLE } })).toBe(false);
    });
  });

  describe("canRunNow", () => {
    it("AP-31: should allow a dry run with the password typed and the tables complete", () => {
      const state = { ...withTables(), confirmation: { password: PASSWORD, workTableLabel: "" } };

      expect(canRunNow(state, { dryRun: true })).toBe(true);
    });

    it("AP-31: should refuse a dry run without the password typed on the review", () => {
      expect(canRunNow(withTables(), { dryRun: true })).toBe(false);
    });

    it("AP-31: should refuse a dry run when the tables are not complete", () => {
      const state = withTables({ stagingSchema: "" });

      expect(canRunNow({ ...state, confirmation: { password: PASSWORD, workTableLabel: "" } }, { dryRun: true })).toBe(false);
    });

    it("AP-31: should allow a real run only when the work table name and the password are confirmed", () => {
      expect(canRunNow(confirmed(), { dryRun: false })).toBe(true);
    });

    it("AP-31: should refuse a real run without the typed work table name", () => {
      const state = confirmed();

      expect(canRunNow({ ...state, confirmation: { password: PASSWORD, workTableLabel: "" } }, { dryRun: false })).toBe(false);
    });
  });

  describe("toStartRequest", () => {
    it("AP-20: should build the start body with the five table names and the schemas", () => {
      const request = toStartRequest(withTables(), { dryRun: true });

      expect(request).toEqual({
        connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD },
        stagingSchema: "bdj_carto",
        stagingTable: "catastro_paispadron_stg",
        workSchema: "carto",
        workTable: WORK_TABLE,
        padronTable: "padron",
        provinceTable: "province",
        localityTable: "cadastral_locality",
        options: { clearMode: "delete" },
        dryRun: true,
        confirm: false,
      });
    });

    it("AP-18: should mark a real run as confirmed and a dry run as not confirmed", () => {
      expect(toStartRequest(confirmed(), { dryRun: false }).confirm).toBe(true);
      expect(toStartRequest(confirmed(), { dryRun: false }).dryRun).toBe(false);
      expect(toStartRequest(confirmed(), { dryRun: true }).confirm).toBe(false);
    });

    it("AP-20: should trim the connection fields, the schemas and the table names", () => {
      const base = withTables({ stagingSchema: " bdj_carto ", workSchema: " carto " });
      const state: ActualizarWizardState = {
        ...base,
        connection: { host: " db.local ", port: " 5432 ", db_name: " gis ", user: " carto ", password: PASSWORD },
        tables: { ...base.tables, work: " padron_trabajo " },
      };

      const request = toStartRequest(state, { dryRun: true });

      expect(request.connection).toEqual({ host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD });
      expect(request.stagingSchema).toBe("bdj_carto");
      expect(request.workSchema).toBe("carto");
      expect(request.workTable).toBe(WORK_TABLE);
    });

    it("AP-20: should send the chosen clear mode", () => {
      const state = withTables({ options: { clearMode: "truncate" } });

      expect(toStartRequest(state, { dryRun: true }).options).toEqual({ clearMode: "truncate" });
    });
  });

  describe("initialWizardStateFor", () => {
    it("AP-33: should open on the connection step when no run exists", () => {
      expect(initialWizardStateFor(snapshotOf("idle")).step).toBe(WizardStep.CONNECTION);
    });

    it.each(["starting", "running", "done", "failed", "unknown"] as const)(
      "AP-33: should open on the result step while a run is %s",
      (phase) => {
        expect(initialWizardStateFor(snapshotOf(phase)).step).toBe(WizardStep.RESULT);
      },
    );
  });

  describe("wizardReducer: connection", () => {
    it("AP-27: should reset every table choice when a connection field changes", () => {
      const state = withTables();

      const next = wizardReducer(state, { type: "connectionChanged", field: "host", value: "otro.local" });

      expect(next.connection.host).toBe("otro.local");
      expect(next.tables).toEqual(initialWizardState().tables);
      expect(next.tableValidity).toEqual(initialWizardState().tableValidity);
    });

    it("AP-27: should keep the table choices when only the password changes", () => {
      const state = confirmed();

      const next = wizardReducer(state, { type: "connectionChanged", field: "password", value: "otra" });

      expect(next.connection.password).toBe("otra");
      expect(next.tables).toEqual(state.tables);
      expect(next.confirmation).toEqual({ password: "", workTableLabel: "" });
    });
  });

  describe("wizardReducer: schemas", () => {
    it.each(["stagingSchema", "workSchema"] as const)("AP-27: should set the %s and reset the table choices", (field) => {
      const state = withTables();

      const next = wizardReducer(state, { type: "schemaChanged", field, value: "otro_esquema" });

      expect(next[field]).toBe("otro_esquema");
      expect(next.tables).toEqual(initialWizardState().tables);
      expect(next.tableValidity).toEqual(initialWizardState().tableValidity);
    });

    it("AP-27: should keep the other schema when one schema changes", () => {
      const next = wizardReducer(withTables(), { type: "schemaChanged", field: "stagingSchema", value: "otro" });

      expect(next.workSchema).toBe("carto");
    });
  });

  describe("wizardReducer: tables", () => {
    it("AP-29: should store the chosen table and its validity under its key only", () => {
      const state = withTables({ tables: initialWizardState().tables, tableValidity: initialWizardState().tableValidity });

      const next = wizardReducer(state, { type: "tableChosen", key: "padron", table: "padron", valid: true });

      expect(next.tables.padron).toBe("padron");
      expect(next.tableValidity.padron).toBe(true);
      expect(next.tables.province).toBe("");
      expect(next.tableValidity.province).toBe(false);
    });

    it("AP-27: should clear the typed work table name when the work table changes", () => {
      const state = confirmed();

      const next = wizardReducer(state, { type: "tableChosen", key: "work", table: "otra_tabla", valid: true });

      expect(next.confirmation.workTableLabel).toBe("");
    });

    it("AP-27: should keep the typed work table name when the same work table is chosen again", () => {
      const state = confirmed();

      const next = wizardReducer(state, { type: "tableChosen", key: "work", table: WORK_TABLE, valid: true });

      expect(next.confirmation.workTableLabel).toBe(WORK_TABLE);
    });
  });

  describe("wizardReducer: options and confirmation", () => {
    it("AP-30: should change the clear mode", () => {
      const next = wizardReducer(withTables(), { type: "optionsChanged", patch: { clearMode: "truncate" } });

      expect(next.options).toEqual({ clearMode: "truncate" });
    });

    it("AP-31: should merge the confirmation patch and keep the other field", () => {
      const next = wizardReducer(withTables(), { type: "confirmationChanged", patch: { password: PASSWORD } });

      expect(next.confirmation).toEqual({ password: PASSWORD, workTableLabel: "" });
    });
  });

  describe("wizardReducer: navigation", () => {
    it("AP-27: should move forward when the current step can continue", () => {
      expect(wizardReducer(withConnection(), { type: "next" }).step).toBe(WizardStep.TABLES);
    });

    it("AP-27: should stay on the connection step when next is pressed with an invalid connection", () => {
      const state = withConnection({ host: "" });

      expect(wizardReducer(state, { type: "next" })).toBe(state);
    });

    it("AP-27: should move back one step", () => {
      expect(wizardReducer(at(WizardStep.TABLES), { type: "back" }).step).toBe(WizardStep.CONNECTION);
    });

    it("AP-27: should not move back from the connection step", () => {
      expect(wizardReducer(at(WizardStep.CONNECTION, withConnection()), { type: "back" }).step).toBe(WizardStep.CONNECTION);
    });

    it("AP-27: should allow a jump backwards to any earlier step", () => {
      expect(wizardReducer(at(WizardStep.REVIEW, confirmed()), { type: "goTo", step: WizardStep.CONNECTION }).step).toBe(
        WizardStep.CONNECTION,
      );
    });

    it("AP-27: should refuse a jump forward over an incomplete step", () => {
      const state = withConnection({ host: "" });

      expect(wizardReducer(state, { type: "goTo", step: WizardStep.REVIEW }).step).toBe(WizardStep.CONNECTION);
    });

    it("AP-27: should allow a jump forward to the review step when the tables are complete", () => {
      expect(wizardReducer(withTables(), { type: "goTo", step: WizardStep.REVIEW }).step).toBe(WizardStep.REVIEW);
    });

    it("AP-27: should refuse a jump forward to the review step when a table is not valid", () => {
      const state = withTables({ tableValidity: { staging: true, work: true, padron: true, province: true, locality: false } });

      expect(wizardReducer(state, { type: "goTo", step: WizardStep.REVIEW }).step).toBe(WizardStep.TABLES);
    });
  });

  describe("wizardReducer: run lifecycle", () => {
    it("AP-27: should open the result step and clear the typed confirmation when a run starts", () => {
      const next = wizardReducer(confirmed(), { type: "runStarted" });

      expect(next.step).toBe(WizardStep.RESULT);
      expect(next.confirmation).toEqual({ password: "", workTableLabel: "" });
      expect(next.tables).toEqual(confirmed().tables);
    });

    it("AP-27: should return to the initial state on reset", () => {
      expect(wizardReducer(confirmed(), { type: "reset" })).toEqual(initialWizardState());
    });

    it("AP-27: should not mutate the state it is given", () => {
      const state = deepFreeze(confirmed());

      expect(() => wizardReducer(state, { type: "connectionChanged", field: "host", value: "x" })).not.toThrow();
      expect(() => wizardReducer(state, { type: "tableChosen", key: "work", table: "x", valid: true })).not.toThrow();
      expect(state.tables.work).toBe(WORK_TABLE);
    });
  });

  describe("actualizarExcludedFor", () => {
    it("AP-3: should exclude nothing when no table is chosen", () => {
      expect(actualizarExcludedFor(initialWizardState())).toEqual({
        staging: [],
        work: [],
        padron: [],
        province: [],
        locality: [],
      });
    });

    it("AP-3: should exclude the names chosen for other keys of the same schema only", () => {
      const state = withTables({ stagingSchema: "bdj_carto", workSchema: "carto" });
      const excluded = actualizarExcludedFor({ ...state, tables: { ...state.tables, staging: "province" } });

      expect(excluded.work).toContain("province");
      expect(excluded.staging).not.toContain("province");
      expect(excluded.staging).not.toContain(WORK_TABLE);
    });
  });
});
