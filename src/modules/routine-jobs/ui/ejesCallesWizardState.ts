import { EJES_DEFAULT_TABLES, EJES_ROLES, type EjesTableRole } from "../jobs/ejes-calles/constants";
import { connectionBlockingReason, type ConnectionField } from "./cargarPadronesWizardState";
import type { ClientConnection, EjesStartRequest } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { ejesAnalysisKeyOf } from "./ejesCallesAnalysisKey";
import type { EjesRunSnapshot } from "./ejesCallesRunStore";
import { RunPhase } from "./jobRunStore";

export const EjesStep = {
  CONNECTION: "connection",
  TABLES: "tables",
  REVIEW: "review",
  RESULT: "result",
} as const;

export type EjesStep = (typeof EjesStep)[keyof typeof EjesStep];

export interface EjesSlotDraft {
  schema: string;
  table: string;
  valid: boolean;
}

export interface EjesConfirmation {
  password: string;
}

export interface EjesWizardState {
  step: EjesStep;
  connection: ClientConnection;
  slots: Record<EjesTableRole, EjesSlotDraft>;
  confirmation: EjesConfirmation;
}

export type EjesWizardAction =
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "slotSchemaChanged"; key: EjesTableRole; schema: string }
  | { type: "slotTableChosen"; key: EjesTableRole; table: string; valid: boolean }
  | { type: "confirmationChanged"; patch: Partial<EjesConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: EjesStep }
  | { type: "runStarted" }
  | { type: "reset" };

const STEP_ORDER: readonly EjesStep[] = [EjesStep.CONNECTION, EjesStep.TABLES, EjesStep.REVIEW, EjesStep.RESULT];

const DEFAULT_PORT = "5432";

const MESSAGES = {
  schema: "Indique el esquema de cada tabla.",
  table: "Elija una tabla para cada rol.",
  distinct: "Las tablas elegidas deben ser distintas: no repita el mismo esquema y nombre.",
  invalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
  password: "Escriba de nuevo la contraseña de la base de datos.",
} as const;

const isBlank = (value: string): boolean => value.trim() === "";

const emptyConfirmation = (): EjesConfirmation => ({ password: "" });

const mapSlots = (build: (role: EjesTableRole) => EjesSlotDraft): Record<EjesTableRole, EjesSlotDraft> =>
  Object.fromEntries(EJES_ROLES.map((role) => [role, build(role)])) as Record<EjesTableRole, EjesSlotDraft>;

export function initialEjesWizardState(): EjesWizardState {
  return {
    step: EjesStep.CONNECTION,
    connection: { host: "", port: DEFAULT_PORT, db_name: "", user: "", password: "" },
    slots: mapSlots((role) => ({ ...EJES_DEFAULT_TABLES[role], valid: false })),
    confirmation: emptyConfirmation(),
  };
}

/** The wizard opens on the connection step when no run exists, otherwise on the result step. */
export function initialEjesWizardStateFor(snapshot: EjesRunSnapshot): EjesWizardState {
  const seeded = initialEjesWizardState();
  return snapshot.phase === RunPhase.IDLE ? seeded : { ...seeded, step: EjesStep.RESULT };
}

/** Names already chosen in the same schema by another role: a table cannot repeat them. */
export function excludedEjesTablesOf(state: EjesWizardState): Record<EjesTableRole, string[]> {
  const excludedAt = (ownKey: EjesTableRole): string[] => {
    const own = state.slots[ownKey];
    const names = EJES_ROLES.filter((key) => key !== ownKey && state.slots[key].schema.trim() === own.schema.trim())
      .map((key) => state.slots[key].table.trim())
      .filter((name) => name !== "");
    return [...new Set(names)];
  };
  return Object.fromEntries(EJES_ROLES.map((key) => [key, excludedAt(key)])) as Record<EjesTableRole, string[]>;
}

function tablesBlockingReason(state: EjesWizardState): string | null {
  const slots = EJES_ROLES.map((key) => state.slots[key]);
  if (slots.some((slot) => isBlank(slot.schema))) return MESSAGES.schema;
  if (slots.some((slot) => isBlank(slot.table))) return MESSAGES.table;
  const names = slots.map((slot) => `${slot.schema.trim()}.${slot.table.trim()}`);
  if (new Set(names).size !== names.length) return MESSAGES.distinct;
  if (slots.some((slot) => !slot.valid)) return MESSAGES.invalid;
  return null;
}

export function blockingReason(state: EjesWizardState): string | null {
  switch (state.step) {
    case EjesStep.CONNECTION:
      return connectionBlockingReason(state.connection);
    case EjesStep.TABLES:
      return tablesBlockingReason(state);
    default:
      return null;
  }
}

export const runBlockedReason = (state: EjesWizardState): string | null =>
  connectionBlockingReason(state.connection) ?? tablesBlockingReason(state);

export function canContinue(state: EjesWizardState): boolean {
  return (state.step === EjesStep.CONNECTION || state.step === EjesStep.TABLES) && blockingReason(state) === null;
}

const isPasswordTyped = (state: EjesWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

export const canAnalyzeNow = (state: EjesWizardState): boolean =>
  runBlockedReason(state) === null && isPasswordTyped(state);

export function toEjesStartRequest(state: EjesWizardState, flags: { dryRun: boolean }): EjesStartRequest {
  const tables = Object.fromEntries(
    EJES_ROLES.map((role) => [role, { schema: state.slots[role].schema.trim(), table: state.slots[role].table.trim() }])
  ) as EjesStartRequest["tables"];
  return { connection: trimConnection(state.connection), tables, dryRun: flags.dryRun };
}

/** "Cargar ahora" needs an analysis of this same connection and tables that finished with no blocker. */
export function canLoadNow(state: EjesWizardState, snapshot: EjesRunSnapshot): boolean {
  const result = snapshot.job?.result;
  if (snapshot.phase !== RunPhase.DONE || result === undefined || snapshot.plan?.dryRun !== true) return false;
  if (result.blockers.length > 0 || !isPasswordTyped(state)) return false;
  return snapshot.plan.analysisKey === ejesAnalysisKeyOf(toEjesStartRequest(state, { dryRun: true }));
}

const indexOfStep = (step: EjesStep): number => STEP_ORDER.indexOf(step);

function landingStepOf(state: EjesWizardState, target: EjesStep): EjesStep {
  const from = indexOfStep(state.step);
  const to = indexOfStep(target);
  if (to <= from) return target;
  const limit = Math.min(to, indexOfStep(EjesStep.REVIEW));
  for (let index = from; index < limit; index++) {
    const step = STEP_ORDER[index];
    if (!canContinue({ ...state, step })) return step;
  }
  return target;
}

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: EjesWizardState, step: EjesStep): EjesWizardState {
  const landing = landingStepOf(state, step);
  const leavesReview = state.step === EjesStep.REVIEW && landing !== EjesStep.REVIEW;
  return { ...state, step: landing, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

const stepAfter = (step: EjesStep, delta: number): EjesStep => STEP_ORDER[indexOfStep(step) + delta] ?? step;

const withoutDependents = (state: EjesWizardState): EjesWizardState => ({
  ...state,
  slots: mapSlots((role) => ({ ...state.slots[role], valid: false })),
  confirmation: emptyConfirmation(),
});

function connectionReducer(state: EjesWizardState, field: ConnectionField, value: string): EjesWizardState {
  const connection = { ...state.connection, [field]: value };
  if (field === "password") return { ...state, connection, confirmation: emptyConfirmation() };
  return withoutDependents({ ...state, connection });
}

export function ejesWizardReducer(state: EjesWizardState, action: EjesWizardAction): EjesWizardState {
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
      return { ...state, step: EjesStep.RESULT, confirmation: emptyConfirmation() };
    case "reset":
      return initialEjesWizardState();
  }
}
