import { CENTROS_DEFAULT_TABLES, CENTROS_ROLES, type CentrosTableRole } from "../jobs/centros-anep/constants";
import { connectionBlockingReason, type ConnectionField } from "./cargarPadronesWizardState";
import type { CentrosAnepRunSnapshot } from "./centrosAnepRunStore";
import type { CentrosAnepStartRequest, ClientConnection } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";

export const CentrosAnepStep = {
  CONNECTION: "connection",
  TABLES: "tables",
  REVIEW: "review",
  RESULT: "result",
} as const;

export type CentrosAnepStep = (typeof CentrosAnepStep)[keyof typeof CentrosAnepStep];

export interface CentrosAnepSlotDraft {
  schema: string;
  table: string;
  valid: boolean;
}

export interface CentrosAnepConfirmation {
  password: string;
  acknowledged: boolean;
}

export interface CentrosAnepWizardState {
  step: CentrosAnepStep;
  connection: ClientConnection;
  slots: Record<CentrosTableRole, CentrosAnepSlotDraft>;
  confirmation: CentrosAnepConfirmation;
}

export type CentrosAnepWizardAction =
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "slotSchemaChanged"; key: CentrosTableRole; schema: string }
  | { type: "slotTableChosen"; key: CentrosTableRole; table: string; valid: boolean }
  | { type: "confirmationChanged"; patch: Partial<CentrosAnepConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: CentrosAnepStep }
  | { type: "runStarted" }
  | { type: "reset" };

const STEP_ORDER: readonly CentrosAnepStep[] = [
  CentrosAnepStep.CONNECTION,
  CentrosAnepStep.TABLES,
  CentrosAnepStep.REVIEW,
  CentrosAnepStep.RESULT,
];

const DEFAULT_PORT = "5432";

const MESSAGES = {
  schema: "Indique el esquema de cada tabla.",
  table: "Elija una tabla para cada rol.",
  distinct: "Las tablas de staging y final deben ser distintas: no repita el mismo esquema y nombre.",
  invalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
} as const;

const isBlank = (value: string): boolean => value.trim() === "";

const emptyConfirmation = (): CentrosAnepConfirmation => ({ password: "", acknowledged: false });

const mapSlots = (
  build: (role: CentrosTableRole) => CentrosAnepSlotDraft
): Record<CentrosTableRole, CentrosAnepSlotDraft> =>
  Object.fromEntries(CENTROS_ROLES.map((role) => [role, build(role)])) as Record<CentrosTableRole, CentrosAnepSlotDraft>;

export function initialCentrosAnepWizardState(): CentrosAnepWizardState {
  return {
    step: CentrosAnepStep.CONNECTION,
    connection: { host: "", port: DEFAULT_PORT, db_name: "", user: "", password: "" },
    slots: mapSlots((role) => ({ ...CENTROS_DEFAULT_TABLES[role], valid: false })),
    confirmation: emptyConfirmation(),
  };
}

/** The wizard opens on the connection step when no run exists, otherwise on the result step. */
export function initialCentrosAnepWizardStateFor(snapshot: CentrosAnepRunSnapshot): CentrosAnepWizardState {
  const seeded = initialCentrosAnepWizardState();
  return snapshot.phase === RunPhase.IDLE ? seeded : { ...seeded, step: CentrosAnepStep.RESULT };
}

/** Names already chosen in the same schema by the other role: a table cannot repeat them. */
export function excludedCentrosAnepTablesOf(state: CentrosAnepWizardState): Record<CentrosTableRole, string[]> {
  const excludedAt = (ownKey: CentrosTableRole): string[] => {
    const own = state.slots[ownKey];
    const names = CENTROS_ROLES.filter((key) => key !== ownKey && state.slots[key].schema.trim() === own.schema.trim())
      .map((key) => state.slots[key].table.trim())
      .filter((name) => name !== "");
    return [...new Set(names)];
  };
  return Object.fromEntries(CENTROS_ROLES.map((key) => [key, excludedAt(key)])) as Record<CentrosTableRole, string[]>;
}

function tablesBlockingReason(state: CentrosAnepWizardState): string | null {
  const slots = CENTROS_ROLES.map((key) => state.slots[key]);
  if (slots.some((slot) => isBlank(slot.schema))) return MESSAGES.schema;
  if (slots.some((slot) => isBlank(slot.table))) return MESSAGES.table;
  const names = slots.map((slot) => `${slot.schema.trim()}.${slot.table.trim()}`);
  if (new Set(names).size !== names.length) return MESSAGES.distinct;
  if (slots.some((slot) => !slot.valid)) return MESSAGES.invalid;
  return null;
}

export function blockingReason(state: CentrosAnepWizardState): string | null {
  switch (state.step) {
    case CentrosAnepStep.CONNECTION:
      return connectionBlockingReason(state.connection);
    case CentrosAnepStep.TABLES:
      return tablesBlockingReason(state);
    default:
      return null;
  }
}

export const runBlockedReason = (state: CentrosAnepWizardState): string | null =>
  connectionBlockingReason(state.connection) ?? tablesBlockingReason(state);

export function canContinue(state: CentrosAnepWizardState): boolean {
  return (
    (state.step === CentrosAnepStep.CONNECTION || state.step === CentrosAnepStep.TABLES) &&
    blockingReason(state) === null
  );
}

const isPasswordTyped = (state: CentrosAnepWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

export const canAnalyzeNow = (state: CentrosAnepWizardState): boolean =>
  runBlockedReason(state) === null && isPasswordTyped(state);

export function toCentrosAnepStartRequest(
  state: CentrosAnepWizardState,
  flags: { dryRun: boolean }
): CentrosAnepStartRequest {
  const tables = Object.fromEntries(
    CENTROS_ROLES.map((role) => [role, { schema: state.slots[role].schema.trim(), table: state.slots[role].table.trim() }])
  ) as CentrosAnepStartRequest["tables"];
  return { connection: trimConnection(state.connection), tables, dryRun: flags.dryRun, confirm: !flags.dryRun };
}

/** "Cargar ahora" needs the password typed again and the destructive confirmation. The real run checks the staging blockers itself, inside its transaction and before writing. */
export const canLoadNow = (state: CentrosAnepWizardState): boolean =>
  runBlockedReason(state) === null && isPasswordTyped(state) && state.confirmation.acknowledged;

const indexOfStep = (step: CentrosAnepStep): number => STEP_ORDER.indexOf(step);

function landingStepOf(state: CentrosAnepWizardState, target: CentrosAnepStep): CentrosAnepStep {
  const from = indexOfStep(state.step);
  const to = indexOfStep(target);
  if (to <= from) return target;
  const limit = Math.min(to, indexOfStep(CentrosAnepStep.REVIEW));
  for (let index = from; index < limit; index++) {
    const step = STEP_ORDER[index];
    if (!canContinue({ ...state, step })) return step;
  }
  return target;
}

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: CentrosAnepWizardState, step: CentrosAnepStep): CentrosAnepWizardState {
  const landing = landingStepOf(state, step);
  const leavesReview = state.step === CentrosAnepStep.REVIEW && landing !== CentrosAnepStep.REVIEW;
  return { ...state, step: landing, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

const stepAfter = (step: CentrosAnepStep, delta: number): CentrosAnepStep =>
  STEP_ORDER[indexOfStep(step) + delta] ?? step;

const withoutDependents = (state: CentrosAnepWizardState): CentrosAnepWizardState => ({
  ...state,
  slots: mapSlots((role) => ({ ...state.slots[role], valid: false })),
  confirmation: emptyConfirmation(),
});

function connectionReducer(state: CentrosAnepWizardState, field: ConnectionField, value: string): CentrosAnepWizardState {
  const connection = { ...state.connection, [field]: value };
  if (field === "password") return { ...state, connection, confirmation: emptyConfirmation() };
  return withoutDependents({ ...state, connection });
}

export function centrosAnepWizardReducer(
  state: CentrosAnepWizardState,
  action: CentrosAnepWizardAction
): CentrosAnepWizardState {
  switch (action.type) {
    case "connectionChanged":
      return connectionReducer(state, action.field, action.value);
    case "slotSchemaChanged":
      return { ...state, slots: { ...state.slots, [action.key]: { schema: action.schema, table: "", valid: false } } };
    case "slotTableChosen":
      return {
        ...state,
        slots: { ...state.slots, [action.key]: { ...state.slots[action.key], table: action.table, valid: action.valid } },
      };
    case "confirmationChanged":
      return { ...state, confirmation: { ...state.confirmation, ...action.patch } };
    case "next":
      return canContinue(state) ? moveTo(state, stepAfter(state.step, 1)) : state;
    case "back":
      return moveTo(state, stepAfter(state.step, -1));
    case "goTo":
      return moveTo(state, action.step);
    case "runStarted":
      return { ...state, step: CentrosAnepStep.RESULT, confirmation: emptyConfirmation() };
    case "reset":
      return initialCentrosAnepWizardState();
  }
}
