// fallow-ignore-file duplicate-export
import { MONTHLY_TABLES } from "../config/monthlyTables";
import type { ClientConnection, CompletarStartRequest } from "./clientTypes";
import type { CompletarRunSnapshot } from "./completarUnidadTerritorialRunStore";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";

export const CompletarStep = {
  TABLES: "tables",
  REVIEW: "review",
  RUN: "run",
  REPORT: "report",
} as const;

export type CompletarStep = (typeof CompletarStep)[keyof typeof CompletarStep];

export const CompletarSlot = {
  UNIT: "unit",
  ADDRESS_MASTER: "addressMaster",
} as const;

export type CompletarSlot = (typeof CompletarSlot)[keyof typeof CompletarSlot];

export interface CompletarSlotDraft {
  schema: string;
  table: string;
  valid: boolean;
}

export interface CompletarConfirmation {
  password: string;
  typedTables: Record<CompletarSlot, string>;
}

export interface CompletarWizardState {
  step: CompletarStep;
  connection: ClientConnection;
  slots: Record<CompletarSlot, CompletarSlotDraft>;
  confirmation: CompletarConfirmation;
}

/** Hub-validated connection; the unit table prefills from the last stage 3 run when there is one. */
export interface CompletarWizardSeed {
  connection: ClientConnection;
  unit?: { schema: string; table: string };
}

export type CompletarWizardAction =
  | { type: "slotSchemaChanged"; key: CompletarSlot; schema: string }
  | { type: "slotTableChosen"; key: CompletarSlot; table: string; valid: boolean }
  | { type: "passwordChanged"; password: string }
  | { type: "typedTableChanged"; key: CompletarSlot; value: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: CompletarStep }
  | { type: "runStarted" }
  | { type: "reset"; seed: CompletarWizardSeed };

const STEP_ORDER: readonly CompletarStep[] = [
  CompletarStep.TABLES,
  CompletarStep.REVIEW,
  CompletarStep.RUN,
  CompletarStep.REPORT,
];

const SLOT_ORDER: readonly CompletarSlot[] = [CompletarSlot.UNIT, CompletarSlot.ADDRESS_MASTER];

const MESSAGES = {
  schema: "Indique el esquema de la tabla de unidades territoriales y el de la tabla de direcciones maestras.",
  table: "Elija la tabla de unidades territoriales y la de direcciones maestras.",
  distinct: "Las tablas elegidas deben ser distintas: no repita el mismo esquema y nombre.",
  invalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
} as const;

const isBlank = (value: string): boolean => value.trim() === "";

const emptyTypedTables = (): Record<CompletarSlot, string> => ({
  [CompletarSlot.UNIT]: "",
  [CompletarSlot.ADDRESS_MASTER]: "",
});

const emptyConfirmation = (): CompletarConfirmation => ({ password: "", typedTables: emptyTypedTables() });

function initialState(seed: CompletarWizardSeed): CompletarWizardState {
  return {
    step: CompletarStep.TABLES,
    connection: seed.connection,
    slots: {
      [CompletarSlot.UNIT]: {
        schema: seed.unit?.schema ?? MONTHLY_TABLES.completarUnidades.unit.schema,
        table: seed.unit?.table ?? MONTHLY_TABLES.completarUnidades.unit.table,
        valid: false,
      },
      [CompletarSlot.ADDRESS_MASTER]: {
        schema: MONTHLY_TABLES.completarUnidades.addressMaster.schema,
        table: MONTHLY_TABLES.completarUnidades.addressMaster.table,
        valid: false,
      },
    },
    confirmation: emptyConfirmation(),
  };
}

/** The wizard opens on the tables step when no run exists, otherwise on the run step. */
export function initialCompletarWizardStateFor(snapshot: CompletarRunSnapshot, seed: CompletarWizardSeed): CompletarWizardState {
  const seeded = initialState(seed);
  return snapshot.phase === RunPhase.IDLE ? seeded : { ...seeded, step: CompletarStep.RUN };
}

/** The name already chosen in the same schema by the other slot: a table cannot repeat it. */
export function excludedCompletarTablesOf(state: CompletarWizardState): Record<CompletarSlot, string[]> {
  const excludedAt = (ownKey: CompletarSlot, otherKey: CompletarSlot): string[] => {
    const other = state.slots[otherKey];
    const sameSchema = other.schema.trim() === state.slots[ownKey].schema.trim();
    return sameSchema && !isBlank(other.table) ? [other.table.trim()] : [];
  };
  return {
    [CompletarSlot.UNIT]: excludedAt(CompletarSlot.UNIT, CompletarSlot.ADDRESS_MASTER),
    [CompletarSlot.ADDRESS_MASTER]: excludedAt(CompletarSlot.ADDRESS_MASTER, CompletarSlot.UNIT),
  };
}

function tablesBlockingReason(state: CompletarWizardState): string | null {
  const slots = SLOT_ORDER.map((key) => state.slots[key]);
  if (slots.some((slot) => isBlank(slot.schema))) return MESSAGES.schema;
  if (slots.some((slot) => isBlank(slot.table))) return MESSAGES.table;
  const names = slots.map((slot) => `${slot.schema.trim()}.${slot.table.trim()}`);
  if (new Set(names).size !== names.length) return MESSAGES.distinct;
  if (slots.some((slot) => !slot.valid)) return MESSAGES.invalid;
  return null;
}

export function blockingReason(state: CompletarWizardState): string | null {
  return state.step === CompletarStep.TABLES ? tablesBlockingReason(state) : null;
}

export const runBlockedReason = tablesBlockingReason;

export function canContinue(state: CompletarWizardState): boolean {
  return state.step === CompletarStep.TABLES && tablesBlockingReason(state) === null;
}

const isPasswordTyped = (state: CompletarWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

const isTableTyped = (state: CompletarWizardState, key: CompletarSlot): boolean => {
  const table = state.slots[key].table.trim();
  return !isBlank(table) && state.confirmation.typedTables[key].trim() === table;
};

const isRealRunConfirmed = (state: CompletarWizardState): boolean =>
  isPasswordTyped(state) && SLOT_ORDER.every((key) => isTableTyped(state, key));

export function canRunNow(state: CompletarWizardState, flags: { dryRun: boolean }): boolean {
  if (tablesBlockingReason(state) !== null) return false;
  return flags.dryRun ? isPasswordTyped(state) : isRealRunConfirmed(state);
}

export function toCompletarStartRequest(state: CompletarWizardState, flags: { dryRun: boolean }): CompletarStartRequest {
  const unit = state.slots[CompletarSlot.UNIT];
  const addressMaster = state.slots[CompletarSlot.ADDRESS_MASTER];
  return {
    connection: trimConnection(state.connection),
    unitSchema: unit.schema.trim(),
    unitTable: unit.table.trim(),
    addressMasterSchema: addressMaster.schema.trim(),
    addressMasterTable: addressMaster.table.trim(),
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
}

const indexOfStep = (step: CompletarStep): number => STEP_ORDER.indexOf(step);

/** A forward jump stops at the tables step while it is not valid. */
function landingStepOf(state: CompletarWizardState, target: CompletarStep): CompletarStep {
  const crossesTables = indexOfStep(state.step) <= indexOfStep(CompletarStep.TABLES) && indexOfStep(target) > indexOfStep(CompletarStep.TABLES);
  return crossesTables && tablesBlockingReason(state) !== null ? CompletarStep.TABLES : target;
}

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: CompletarWizardState, step: CompletarStep): CompletarWizardState {
  const landing = landingStepOf(state, step);
  const leavesReview = state.step === CompletarStep.REVIEW && landing !== CompletarStep.REVIEW;
  return { ...state, step: landing, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

const stepAfter = (step: CompletarStep, delta: number): CompletarStep => STEP_ORDER[indexOfStep(step) + delta] ?? step;

const clearTyped = (confirmation: CompletarConfirmation, key: CompletarSlot): CompletarConfirmation => ({
  ...confirmation,
  typedTables: { ...confirmation.typedTables, [key]: "" },
});

function slotSchemaReducer(state: CompletarWizardState, key: CompletarSlot, schema: string): CompletarWizardState {
  return {
    ...state,
    slots: { ...state.slots, [key]: { schema, table: "", valid: false } },
    confirmation: clearTyped(state.confirmation, key),
  };
}

function slotTableReducer(state: CompletarWizardState, key: CompletarSlot, table: string, valid: boolean): CompletarWizardState {
  const changed = table !== state.slots[key].table;
  const next = { ...state, slots: { ...state.slots, [key]: { ...state.slots[key], table, valid } } };
  return changed ? { ...next, confirmation: clearTyped(next.confirmation, key) } : next;
}

export function completarWizardReducer(state: CompletarWizardState, action: CompletarWizardAction): CompletarWizardState {
  switch (action.type) {
    case "slotSchemaChanged":
      return slotSchemaReducer(state, action.key, action.schema);
    case "slotTableChosen":
      return slotTableReducer(state, action.key, action.table, action.valid);
    case "passwordChanged":
      return { ...state, confirmation: { ...state.confirmation, password: action.password } };
    case "typedTableChanged":
      return {
        ...state,
        confirmation: {
          ...state.confirmation,
          typedTables: { ...state.confirmation.typedTables, [action.key]: action.value },
        },
      };
    case "next":
      return canContinue(state) ? moveTo(state, stepAfter(state.step, 1)) : state;
    case "back":
      return moveTo(state, stepAfter(state.step, -1));
    case "goTo":
      return moveTo(state, action.step);
    case "runStarted":
      return { ...state, step: CompletarStep.RUN, confirmation: emptyConfirmation() };
    case "reset":
      return initialState(action.seed);
  }
}
