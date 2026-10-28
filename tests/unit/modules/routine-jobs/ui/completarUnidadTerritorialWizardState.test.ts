import { describe, expect, it } from "vitest";
import {
  blockingReason,
  canContinue,
  canRunNow,
  completarWizardReducer,
  CompletarSlot,
  CompletarStep,
  excludedCompletarTablesOf,
  initialCompletarWizardStateFor,
  runBlockedReason,
  toCompletarStartRequest,
  type CompletarWizardSeed,
  type CompletarWizardState,
} from "@/modules/routine-jobs/ui/completarUnidadTerritorialWizardState";
import type { CompletarRunSnapshot } from "@/modules/routine-jobs/ui/completarUnidadTerritorialRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const PASSWORD = "s3cret-pw";
const UNIT = { schema: "carto", table: "territorial_unit" };
const ADDRESS_MASTER = { schema: "carto", table: "addresses_master" };
const CONNECTION = { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD };
const SEED: CompletarWizardSeed = { connection: CONNECTION };

const idleSnapshot: CompletarRunSnapshot = { phase: RunPhase.IDLE };
const snapshotOf = (phase: RunPhase): CompletarRunSnapshot => ({ phase });

const initialState = (seed: CompletarWizardSeed = SEED): CompletarWizardState =>
  initialCompletarWizardStateFor(idleSnapshot, seed);

const validState = (overrides: Partial<CompletarWizardState> = {}): CompletarWizardState => ({
  ...initialState(),
  slots: {
    [CompletarSlot.UNIT]: { ...UNIT, valid: true },
    [CompletarSlot.ADDRESS_MASTER]: { ...ADDRESS_MASTER, valid: true },
  },
  ...overrides,
});

const atReview = (base: CompletarWizardState = validState()): CompletarWizardState => ({
  ...base,
  step: CompletarStep.REVIEW,
  confirmation: { password: PASSWORD, typedTables: { [CompletarSlot.UNIT]: UNIT.table, [CompletarSlot.ADDRESS_MASTER]: ADDRESS_MASTER.table } },
});

const withPassword = (state: CompletarWizardState, password = PASSWORD): CompletarWizardState => ({
  ...state,
  confirmation: { ...state.confirmation, password },
});

const withTyped = (state: CompletarWizardState, key: CompletarSlot, value: string): CompletarWizardState => ({
  ...state,
  confirmation: { ...state.confirmation, typedTables: { ...state.confirmation.typedTables, [key]: value } },
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe("initialCompletarWizardStateFor (CU-1, CU-17)", () => {
  it.each([RunPhase.STARTING, RunPhase.RUNNING, RunPhase.DONE, RunPhase.FAILED, RunPhase.UNKNOWN])(
    "should open on the run step while a run is %s",
    (phase) => {
      expect(initialCompletarWizardStateFor(snapshotOf(phase), SEED).step).toBe(CompletarStep.RUN);
    },
  );

  it("should open on the tables step when no run exists", () => {
    expect(initialState().step).toBe(CompletarStep.TABLES);
  });

  it("should prefill the unit table from the seed of the last stage 3 run", () => {
    const state = initialState({ connection: CONNECTION, unit: { schema: "otro", table: "unidades_x" } });

    expect(state.slots[CompletarSlot.UNIT]).toEqual({ schema: "otro", table: "unidades_x", valid: false });
  });

  it("should default the unit table to carto.territorial_unit when no stage 3 run exists", () => {
    expect(initialState().slots[CompletarSlot.UNIT]).toEqual({ schema: "carto", table: "territorial_unit", valid: false });
  });

  it("should prefill the address master table with carto.addresses_master whatever the seed says", () => {
    const state = initialState({ connection: CONNECTION, unit: { schema: "otro", table: "unidades_x" } });

    expect(state.slots[CompletarSlot.ADDRESS_MASTER]).toEqual({ schema: "carto", table: "addresses_master", valid: false });
  });

  it("should start with an empty password and empty typed table names", () => {
    expect(initialState().confirmation).toEqual({
      password: "",
      typedTables: { [CompletarSlot.UNIT]: "", [CompletarSlot.ADDRESS_MASTER]: "" },
    });
  });
});

describe("blockingReason and canContinue (CU-1, CU-2)", () => {
  it("should continue from the tables step when both tables are valid and distinct", () => {
    expect(canContinue(validState())).toBe(true);
    expect(blockingReason(validState())).toBeNull();
  });

  it("should not continue while a table has not been chosen as valid", () => {
    const state = validState({
      slots: {
        [CompletarSlot.UNIT]: { ...UNIT, valid: true },
        [CompletarSlot.ADDRESS_MASTER]: { ...ADDRESS_MASTER, valid: false },
      },
    });

    expect(canContinue(state)).toBe(false);
    expect(blockingReason(state)).toMatch(/columnas faltantes o ambiguas/);
  });

  it.each([CompletarSlot.UNIT, CompletarSlot.ADDRESS_MASTER])("should not continue with a blank schema for the %s table", (key) => {
    const base = validState();

    expect(canContinue({ ...base, slots: { ...base.slots, [key]: { ...base.slots[key], schema: "   " } } })).toBe(false);
    expect(blockingReason({ ...base, slots: { ...base.slots, [key]: { ...base.slots[key], schema: "" } } })).not.toBeNull();
  });

  it.each([CompletarSlot.UNIT, CompletarSlot.ADDRESS_MASTER])("should not continue with a blank table for the %s table", (key) => {
    const base = validState();

    expect(canContinue({ ...base, slots: { ...base.slots, [key]: { ...base.slots[key], table: "  " } } })).toBe(false);
  });

  it("should refuse the same schema and table for both tables, even with spaces around the names", () => {
    const base = validState();
    const state = { ...base, slots: { ...base.slots, [CompletarSlot.ADDRESS_MASTER]: { schema: " carto ", table: "territorial_unit ", valid: true } } };

    expect(canContinue(state)).toBe(false);
    expect(blockingReason(state)).toMatch(/distintas/);
  });

  it("should accept the same table name in two different schemas", () => {
    const base = validState();
    const state = { ...base, slots: { ...base.slots, [CompletarSlot.ADDRESS_MASTER]: { schema: "otro", table: UNIT.table, valid: true } } };

    expect(canContinue(state)).toBe(true);
  });

  it("should report no blocking reason outside the tables step", () => {
    expect(runBlockedReason(validState())).toBeNull();
    expect(blockingReason({ ...atReview(), step: CompletarStep.REVIEW })).toBeNull();
  });
});

describe("excludedCompletarTablesOf", () => {
  it("should exclude the address master name from the unit table and the other way round in the same schema", () => {
    const excluded = excludedCompletarTablesOf(validState());

    expect(excluded[CompletarSlot.UNIT]).toEqual([ADDRESS_MASTER.table]);
    expect(excluded[CompletarSlot.ADDRESS_MASTER]).toEqual([UNIT.table]);
  });

  it("should exclude nothing when the two tables sit in different schemas", () => {
    const base = validState();
    const state = { ...base, slots: { ...base.slots, [CompletarSlot.ADDRESS_MASTER]: { schema: "otro", table: ADDRESS_MASTER.table, valid: true } } };

    expect(excludedCompletarTablesOf(state)).toEqual({ [CompletarSlot.UNIT]: [], [CompletarSlot.ADDRESS_MASTER]: [] });
  });

  it("should exclude nothing while the other table has no name yet", () => {
    const base = validState();
    const state = { ...base, slots: { ...base.slots, [CompletarSlot.ADDRESS_MASTER]: { schema: "carto", table: "", valid: false } } };

    expect(excludedCompletarTablesOf(state)[CompletarSlot.UNIT]).toEqual([]);
  });
});

describe("wizard reducer: slots", () => {
  it("should reset the table, its validity and its typed name when the schema of a slot changes", () => {
    const state = withTyped(validState(), CompletarSlot.UNIT, UNIT.table);

    const next = completarWizardReducer(state, { type: "slotSchemaChanged", key: CompletarSlot.UNIT, schema: "otro" });

    expect(next.slots[CompletarSlot.UNIT]).toEqual({ schema: "otro", table: "", valid: false });
    expect(next.confirmation.typedTables[CompletarSlot.UNIT]).toBe("");
  });

  it("should keep the typed name of the other slot when one schema changes", () => {
    const state = withTyped(validState(), CompletarSlot.ADDRESS_MASTER, ADDRESS_MASTER.table);

    const next = completarWizardReducer(state, { type: "slotSchemaChanged", key: CompletarSlot.UNIT, schema: "otro" });

    expect(next.confirmation.typedTables[CompletarSlot.ADDRESS_MASTER]).toBe(ADDRESS_MASTER.table);
  });

  it("should store a chosen table and its validity under its own slot only", () => {
    const next = completarWizardReducer(initialState(), {
      type: "slotTableChosen",
      key: CompletarSlot.ADDRESS_MASTER,
      table: ADDRESS_MASTER.table,
      valid: true,
    });

    expect(next.slots[CompletarSlot.ADDRESS_MASTER]).toMatchObject({ table: ADDRESS_MASTER.table, valid: true });
    expect(next.slots[CompletarSlot.UNIT]).toMatchObject({ table: UNIT.table, valid: false });
  });

  it("should clear the typed name of a slot only when its table actually changes", () => {
    const state = withTyped(validState(), CompletarSlot.UNIT, UNIT.table);

    const same = completarWizardReducer(state, { type: "slotTableChosen", key: CompletarSlot.UNIT, table: UNIT.table, valid: true });
    const other = completarWizardReducer(state, { type: "slotTableChosen", key: CompletarSlot.UNIT, table: "otra", valid: true });

    expect(same.confirmation.typedTables[CompletarSlot.UNIT]).toBe(UNIT.table);
    expect(other.confirmation.typedTables[CompletarSlot.UNIT]).toBe("");
  });
});

describe("wizard reducer: confirmation", () => {
  it("should store the typed password", () => {
    const next = completarWizardReducer(validState(), { type: "passwordChanged", password: PASSWORD });

    expect(next.confirmation.password).toBe(PASSWORD);
  });

  it("should store a typed table name under its own key only", () => {
    const next = completarWizardReducer(validState(), { type: "typedTableChanged", key: CompletarSlot.UNIT, value: "x" });

    expect(next.confirmation.typedTables).toEqual({ [CompletarSlot.UNIT]: "x", [CompletarSlot.ADDRESS_MASTER]: "" });
  });
});

describe("canRunNow (CU-13)", () => {
  it("should allow a dry run with only the password typed and the tables complete", () => {
    expect(canRunNow(withPassword(validState()), { dryRun: true })).toBe(true);
  });

  it("should refuse a dry run without the password typed", () => {
    expect(canRunNow(validState(), { dryRun: true })).toBe(false);
  });

  it("should refuse a dry run while the tables are not complete", () => {
    const base = withPassword(validState());

    expect(canRunNow({ ...base, slots: { ...base.slots, [CompletarSlot.UNIT]: { ...UNIT, valid: false } } }, { dryRun: true })).toBe(false);
  });

  it("should allow a real run only when the password and both typed table names are confirmed", () => {
    const state = withTyped(withTyped(withPassword(validState()), CompletarSlot.UNIT, UNIT.table), CompletarSlot.ADDRESS_MASTER, ADDRESS_MASTER.table);

    expect(canRunNow(state, { dryRun: false })).toBe(true);
  });

  it("should refuse a real run when only the unit table name is typed", () => {
    const state = withTyped(withPassword(validState()), CompletarSlot.UNIT, UNIT.table);

    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });

  it("should refuse a real run when only the address master table name is typed", () => {
    const state = withTyped(withPassword(validState()), CompletarSlot.ADDRESS_MASTER, ADDRESS_MASTER.table);

    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });

  it("should refuse a real run when the typed names are all there but the password is not", () => {
    const state = withTyped(
      withTyped(withPassword(validState(), ""), CompletarSlot.UNIT, UNIT.table),
      CompletarSlot.ADDRESS_MASTER,
      ADDRESS_MASTER.table,
    );

    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });

  it("should refuse a real run when the password typed differs from the connection password", () => {
    const state = withTyped(
      withTyped(withPassword(validState(), "otra"), CompletarSlot.UNIT, UNIT.table),
      CompletarSlot.ADDRESS_MASTER,
      ADDRESS_MASTER.table,
    );

    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });

  it("should refuse a typed table name that differs in case", () => {
    const state = withTyped(
      withTyped(withPassword(validState()), CompletarSlot.UNIT, "Territorial_Unit"),
      CompletarSlot.ADDRESS_MASTER,
      ADDRESS_MASTER.table,
    );

    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });

  it("should accept a typed table name that only differs by surrounding spaces", () => {
    const state = withTyped(
      withTyped(withPassword(validState()), CompletarSlot.UNIT, `  ${UNIT.table} `),
      CompletarSlot.ADDRESS_MASTER,
      ADDRESS_MASTER.table,
    );

    expect(canRunNow(state, { dryRun: false })).toBe(true);
  });

  it("should refuse a real run when each typed name sits in the wrong slot", () => {
    const state = withTyped(
      withTyped(withPassword(validState()), CompletarSlot.UNIT, ADDRESS_MASTER.table),
      CompletarSlot.ADDRESS_MASTER,
      UNIT.table,
    );

    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });
});

describe("toCompletarStartRequest", () => {
  it("should build the start request with the four trimmed table names and a confirmed real run", () => {
    const state = validState({
      slots: {
        [CompletarSlot.UNIT]: { schema: " carto ", table: " territorial_unit ", valid: true },
        [CompletarSlot.ADDRESS_MASTER]: { schema: "otro", table: " direcciones ", valid: true },
      },
    });

    const request = toCompletarStartRequest(state, { dryRun: false });

    expect(request).toMatchObject({
      unitSchema: "carto",
      unitTable: "territorial_unit",
      addressMasterSchema: "otro",
      addressMasterTable: "direcciones",
      dryRun: false,
      confirm: true,
    });
  });

  it("should send confirm false on a dry run", () => {
    expect(toCompletarStartRequest(validState(), { dryRun: true })).toMatchObject({ dryRun: true, confirm: false });
  });

  it("should trim the connection fields", () => {
    const state = validState({ connection: { ...CONNECTION, host: " db.local " } });

    expect(toCompletarStartRequest(state, { dryRun: true }).connection.host).toBe("db.local");
  });
});

describe("wizard reducer: navigation", () => {
  it("should move from the tables step to the review step when the tables are complete", () => {
    expect(completarWizardReducer(validState(), { type: "next" }).step).toBe(CompletarStep.REVIEW);
  });

  it("should stay on the tables step and return the same state when next is pressed with an invalid table", () => {
    const state = validState({ slots: { ...validState().slots, [CompletarSlot.UNIT]: { ...UNIT, valid: false } } });

    expect(completarWizardReducer(state, { type: "next" })).toBe(state);
  });

  it("should refuse a jump to the run step over an incomplete tables step", () => {
    const state = validState({ slots: { ...validState().slots, [CompletarSlot.UNIT]: { ...UNIT, valid: false } } });

    expect(completarWizardReducer(state, { type: "goTo", step: CompletarStep.RUN }).step).toBe(CompletarStep.TABLES);
  });

  it("should allow a jump to the review step when the tables are complete", () => {
    expect(completarWizardReducer(validState(), { type: "goTo", step: CompletarStep.REVIEW }).step).toBe(CompletarStep.REVIEW);
  });

  it("should clear the typed confirmation when going back from the review step", () => {
    const next = completarWizardReducer(atReview(), { type: "back" });

    expect(next.step).toBe(CompletarStep.TABLES);
    expect(next.confirmation).toEqual({ password: "", typedTables: { [CompletarSlot.UNIT]: "", [CompletarSlot.ADDRESS_MASTER]: "" } });
  });

  it("should keep the typed confirmation when a jump to the same review step happens", () => {
    const state = atReview();

    expect(completarWizardReducer(state, { type: "goTo", step: CompletarStep.REVIEW }).confirmation).toEqual(state.confirmation);
  });

  it("should open the run step and clear the typed confirmation when a run starts", () => {
    const next = completarWizardReducer(atReview(), { type: "runStarted" });

    expect(next.step).toBe(CompletarStep.RUN);
    expect(next.confirmation.password).toBe("");
    expect(next.confirmation.typedTables).toEqual({ [CompletarSlot.UNIT]: "", [CompletarSlot.ADDRESS_MASTER]: "" });
  });

  it("should return to the initial tables state with the seed when reset", () => {
    const next = completarWizardReducer(atReview(), { type: "reset", seed: SEED });

    expect(next).toEqual(initialState());
  });

  it("should not mutate the state it is given", () => {
    const state = deepFreeze(atReview());

    expect(() => completarWizardReducer(state, { type: "passwordChanged", password: "x" })).not.toThrow();
    expect(() => completarWizardReducer(state, { type: "slotTableChosen", key: CompletarSlot.UNIT, table: "x", valid: true })).not.toThrow();
    expect(state.confirmation.password).toBe(PASSWORD);
  });
});
