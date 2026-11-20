import { EJES_DEFAULT_TABLES, EJES_ROLES, EJES_TABLE_ROLE, type EjesTableRole } from "../../jobs/ejes-calles/constants";
import { summaryOf } from "../../jobs/ejes-calles/domain/loadMapping";
import type { EjesManualSplit, EjesTwinPick } from "../../jobs/ejes-calles/types";
import { connectionBlockingReason, type ConnectionField } from "../shared/wizardConnection";
import type {
  ClientConnection,
  EjesGeometryMapBase,
  EjesLoadRequest,
  EjesSplitPointsBase,
  EjesStartRequest,
} from "../shared/clientTypes";
import { trimConnection } from "../shared/connectionProfiles";
import {
  acceptanceAfter,
  acceptedRequestOf,
  acceptKeysOf,
  manualSplitRequestsOf,
  manualSplitsAfter,
  pointChoicesAfter,
  pointChoicesOf,
  twinPicksAfter,
  type EjesAcceptance,
  type EjesAcceptChange,
  type EjesAcceptKeys,
  type EjesManualSplitChange,
  type EjesPointChoiceKey,
  type EjesPointChoicesChange,
  type EjesTwinPickChange,
} from "./ejesAccept";
import { ejesAnalysisKeyOf } from "../shared/ejesCallesAnalysisKey";
import type { EjesRunSnapshot } from "../shared/ejesCallesRunStore";
import { RunPhase } from "../shared/jobRunStore";

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
  /** The rows accepted on the review lists; cleared when the connection or a table changes. */
  acceptance: EjesAcceptance | null;
  /** The copies the user keeps for `reftramo`s with several copies: inputs of every analysis, so they survive a re-analysis. */
  twinPicks: readonly EjesTwinPick[];
  /** The new sections the user chose on the map for old sections no rule resolved: inputs of every analysis, as the twin picks are. */
  manualSplits: readonly EjesManualSplit[];
}

export type EjesWizardAction =
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "slotSchemaChanged"; key: EjesTableRole; schema: string }
  | { type: "slotTableChosen"; key: EjesTableRole; table: string; valid: boolean }
  | { type: "confirmationChanged"; patch: Partial<EjesConfirmation> }
  | { type: "acceptChanged"; analysisKey: string; change: EjesAcceptChange }
  | { type: "pointChoicesChanged"; analysisKey: string; change: EjesPointChoicesChange }
  | { type: "twinPickChanged"; change: EjesTwinPickChange }
  | { type: "manualSplitChanged"; change: EjesManualSplitChange }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: EjesStep }
  | { type: "runStarted"; dryRun: boolean }
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
    acceptance: null,
    twinPicks: [],
    manualSplits: [],
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

/** The dry run (Analizar) with the twin picks and manual splits: the analysis sees the choices the load will. */
export const ejesAnalysisRequestOf = (state: EjesWizardState): EjesStartRequest => ({
  ...toEjesStartRequest(state, { dryRun: true }),
  accepted: {
    twinPicks: state.twinPicks.map(({ ref, department, locality }) => ({ ref, department, locality })),
    manualSplits: manualSplitRequestsOf(state.manualSplits),
  },
});

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

/** The connection and the tables the map reads; null while the wizard holds no password. */
export function ejesGeometryMapBaseOf(state: EjesWizardState): EjesGeometryMapBase | null {
  if (state.connection.password === "") return null;
  const { tables } = toEjesStartRequest(state, { dryRun: true });
  return {
    connection: trimConnection(state.connection),
    tables: {
      [EJES_TABLE_ROLE.STAGING]: tables[EJES_TABLE_ROLE.STAGING],
      [EJES_TABLE_ROLE.ROAD_SECTION]: tables[EJES_TABLE_ROLE.ROAD_SECTION],
      [EJES_TABLE_ROLE.PADRONES]: tables[EJES_TABLE_ROLE.PADRONES],
      [EJES_TABLE_ROLE.LOCALITIES]: tables[EJES_TABLE_ROLE.LOCALITIES],
      [EJES_TABLE_ROLE.DEPARTMENTS]: tables[EJES_TABLE_ROLE.DEPARTMENTS],
    },
  };
}

/** The connection, the tables and the dry run (`jobId`) the review points of a split read; null while there is no password or no run. */
export function ejesSplitPointsBaseOf(state: EjesWizardState, jobId: string | undefined): EjesSplitPointsBase | null {
  if (state.connection.password === "" || jobId === undefined) return null;
  const { tables } = toEjesStartRequest(state, { dryRun: true });
  return {
    connection: trimConnection(state.connection),
    tables: {
      [EJES_TABLE_ROLE.STAGING]: tables[EJES_TABLE_ROLE.STAGING],
      [EJES_TABLE_ROLE.ROAD_SECTION]: tables[EJES_TABLE_ROLE.ROAD_SECTION],
      [EJES_TABLE_ROLE.ACCESS_POINT]: tables[EJES_TABLE_ROLE.ACCESS_POINT],
      [EJES_TABLE_ROLE.ADDRESS]: tables[EJES_TABLE_ROLE.ADDRESS],
      [EJES_TABLE_ROLE.CIRCULATION_WAY]: tables[EJES_TABLE_ROLE.CIRCULATION_WAY],
    },
    jobId,
  };
}

/** "Cargar ahora" needs an analysis of this same connection and tables that finished with no blocker. */
export function canLoadNow(state: EjesWizardState, snapshot: EjesRunSnapshot): boolean {
  const result = snapshot.job?.result;
  if (snapshot.phase !== RunPhase.DONE || result === undefined || snapshot.plan?.dryRun !== true) return false;
  if (result.blockers.length > 0 || result.counts.manualSplitsIgnored > 0 || !isPasswordTyped(state)) return false;
  return snapshot.plan.analysisKey === ejesAnalysisKeyOf(toEjesStartRequest(state, { dryRun: true }));
}

/** The accepted keys of the analysis on screen: none when the acceptance was made for another analysis. */
/** The finished result the accepted keys were made on: its analysis key and its job id. A new analysis is a new job, so it never matches. */
export const resultKeyOf = (snapshot: EjesRunSnapshot): string => JSON.stringify([snapshot.plan?.analysisKey ?? null, snapshot.jobId ?? null]);

export const acceptKeysOfState = (state: EjesWizardState, snapshot: EjesRunSnapshot): EjesAcceptKeys =>
  acceptKeysOf(state.acceptance, resultKeyOf(snapshot));

export const pointChoicesOfState = (state: EjesWizardState, snapshot: EjesRunSnapshot): readonly EjesPointChoiceKey[] =>
  pointChoicesOf(state.acceptance, resultKeyOf(snapshot));

/** The real-run request, its summary taken from the finished dry-run and its accepted rows; null while "Cargar ahora" is not allowed. */
export function ejesLoadRequestOf(state: EjesWizardState, snapshot: EjesRunSnapshot): EjesLoadRequest | null {
  const result = snapshot.job?.result;
  if (result === undefined || !canLoadNow(state, snapshot)) return null;
  return {
    ...toEjesStartRequest(state, { dryRun: false }),
    dryRun: false,
    accepted: acceptedRequestOf(
      acceptKeysOfState(state, snapshot),
      pointChoicesOfState(state, snapshot),
      state.twinPicks,
      state.manualSplits
    ),
    summary: summaryOf(result),
  };
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

/** The typed confirmation lives while the review, or the result of a dry-run, is on screen; leaving the review clears it, and so does starting a real run. */
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
  acceptance: null,
  twinPicks: [],
  manualSplits: [],
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
      return {
        ...state,
        slots: { ...state.slots, [action.key]: { schema: action.schema, table: "", valid: false } },
        acceptance: null,
        twinPicks: [],
        manualSplits: [],
      };
    case "slotTableChosen":
      return {
        ...state,
        slots: { ...state.slots, [action.key]: { ...state.slots[action.key], table: action.table, valid: action.valid } },
        acceptance: null,
        twinPicks: [],
        manualSplits: [],
      };
    case "confirmationChanged":
      return { ...state, confirmation: { ...state.confirmation, ...action.patch } };
    case "acceptChanged":
      return { ...state, acceptance: acceptanceAfter(state.acceptance, action.analysisKey, action.change) };
    case "pointChoicesChanged":
      return { ...state, acceptance: pointChoicesAfter(state.acceptance, action.analysisKey, action.change) };
    case "twinPickChanged":
      return { ...state, twinPicks: twinPicksAfter(state.twinPicks, action.change) };
    case "manualSplitChanged":
      return { ...state, manualSplits: manualSplitsAfter(state.manualSplits, action.change) };
    case "next":
      return canContinue(state) ? moveTo(state, stepAfter(state.step, 1)) : state;
    case "back":
      return moveTo(state, stepAfter(state.step, -1));
    case "goTo":
      return moveTo(state, action.step);
    case "runStarted":
      return {
        ...state,
        step: EjesStep.RESULT,
        confirmation: action.dryRun ? state.confirmation : emptyConfirmation(),
        acceptance: action.dryRun ? null : state.acceptance,
      };
    case "reset":
      return initialEjesWizardState();
  }
}
