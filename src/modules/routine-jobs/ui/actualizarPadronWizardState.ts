// Same wizard API names as cargarPadronesWizardState: both jobs expose the reducer contract the tests fix.
// fallow-ignore-file duplicate-export
import { ACTUALIZAR_TABLE_ROLE, type ActualizarTableRole } from "../jobs/actualizar-padron/constants";
import { CLEAR_MODE } from "../jobs/cargar-padrones/constants";
import type { ActualizarJobOptions, ActualizarStartRequest, ClientConnection } from "./clientTypes";
import type { ActualizarPadronRunSnapshot } from "./actualizarPadronRunStore";
import {
  connectionBlockingReason,
  WizardStep,
  type ConnectionField,
} from "./cargarPadronesWizardState";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";

export { WizardStep } from "./cargarPadronesWizardState";

export const ActualizarTableKey = {
  STAGING: "staging",
  WORK: "work",
  PADRON: "padron",
  PROVINCE: "province",
  LOCALITY: "locality",
} as const;

export type ActualizarTableKey = (typeof ActualizarTableKey)[keyof typeof ActualizarTableKey];

export type SchemaField = "stagingSchema" | "workSchema";

export interface ActualizarWizardConfirmation {
  password: string;
  workTableLabel: string;
}

export interface ActualizarWizardState {
  step: WizardStep;
  connection: ClientConnection;
  stagingSchema: string;
  workSchema: string;
  tables: Record<ActualizarTableKey, string>;
  tableValidity: Record<ActualizarTableKey, boolean>;
  options: ActualizarJobOptions;
  confirmation: ActualizarWizardConfirmation;
}

export type ActualizarWizardAction =
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "schemaChanged"; field: SchemaField; value: string }
  | { type: "tableChosen"; key: ActualizarTableKey; table: string; valid: boolean }
  | { type: "optionsChanged"; patch: Partial<ActualizarJobOptions> }
  | { type: "confirmationChanged"; patch: Partial<ActualizarWizardConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: WizardStep }
  | { type: "runStarted" }
  | { type: "reset" };

const STEP_ORDER: readonly WizardStep[] = [
  WizardStep.CONNECTION,
  WizardStep.TABLES,
  WizardStep.OPTIONS,
  WizardStep.REVIEW,
  WizardStep.RESULT,
];
const RUN_START_STEP = WizardStep.RESULT;
const RUN_GATE_STEP = WizardStep.REVIEW;
const TABLE_KEYS: readonly ActualizarTableKey[] = Object.values(ActualizarTableKey);

const MESSAGES = {
  stagingSchema: "Indique el esquema de la tabla de origen.",
  workSchema: "Indique el esquema de la tabla de trabajo.",
  tablesMissing: "Elija las cinco tablas del trabajo.",
  tablesDistinct: "Las cinco tablas deben ser distintas dentro de su esquema.",
  tablesInvalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
} as const;

const ROLE_OF_KEY: Record<ActualizarTableKey, ActualizarTableRole> = {
  [ActualizarTableKey.STAGING]: ACTUALIZAR_TABLE_ROLE.STAGING,
  [ActualizarTableKey.WORK]: ACTUALIZAR_TABLE_ROLE.TEMP,
  [ActualizarTableKey.PADRON]: ACTUALIZAR_TABLE_ROLE.PADRON,
  [ActualizarTableKey.PROVINCE]: ACTUALIZAR_TABLE_ROLE.PROVINCE,
  [ActualizarTableKey.LOCALITY]: ACTUALIZAR_TABLE_ROLE.LOCALITY,
};

const emptyTables = (): Record<ActualizarTableKey, string> => ({ staging: "", work: "", padron: "", province: "", locality: "" });
const noTableValidity = (): Record<ActualizarTableKey, boolean> => ({
  staging: false,
  work: false,
  padron: false,
  province: false,
  locality: false,
});
const emptyConfirmation = (): ActualizarWizardConfirmation => ({ password: "", workTableLabel: "" });

export function roleOfTableKey(key: ActualizarTableKey): ActualizarTableRole {
  return ROLE_OF_KEY[key];
}

export function schemaFieldOf(key: ActualizarTableKey): SchemaField {
  return key === ActualizarTableKey.STAGING ? "stagingSchema" : "workSchema";
}

export function initialWizardState(): ActualizarWizardState {
  return {
    step: WizardStep.CONNECTION,
    connection: { host: "", port: "5432", db_name: "", user: "", password: "" },
    stagingSchema: "",
    workSchema: "",
    tables: emptyTables(),
    tableValidity: noTableValidity(),
    options: { clearMode: CLEAR_MODE.DELETE },
    confirmation: emptyConfirmation(),
  };
}

export function initialWizardStateFor(snapshot: ActualizarPadronRunSnapshot): ActualizarWizardState {
  return { ...initialWizardState(), step: snapshot.phase === RunPhase.IDLE ? WizardStep.CONNECTION : WizardStep.RESULT };
}

const isBlank = (value: string): boolean => value.trim() === "";

const schemaBlockingReason = (state: ActualizarWizardState): string | null => {
  if (isBlank(state.stagingSchema)) return MESSAGES.stagingSchema;
  if (isBlank(state.workSchema)) return MESSAGES.workSchema;
  return null;
};

const qualifiedNameOf = (state: ActualizarWizardState, key: ActualizarTableKey): string =>
  `${state[schemaFieldOf(key)].trim()}.${state.tables[key].trim()}`;

function tablesBlockingReason(state: ActualizarWizardState): string | null {
  const schemaReason = schemaBlockingReason(state);
  if (schemaReason !== null) return schemaReason;
  if (TABLE_KEYS.some((key) => isBlank(state.tables[key]))) return MESSAGES.tablesMissing;
  const names = TABLE_KEYS.map((key) => qualifiedNameOf(state, key));
  if (new Set(names).size !== names.length) return MESSAGES.tablesDistinct;
  if (TABLE_KEYS.some((key) => !state.tableValidity[key])) return MESSAGES.tablesInvalid;
  return null;
}

export function blockingReason(state: ActualizarWizardState): string | null {
  switch (state.step) {
    case WizardStep.CONNECTION:
      return connectionBlockingReason(state.connection);
    case WizardStep.TABLES:
      return tablesBlockingReason(state);
    default:
      return null;
  }
}

/** The run cannot start whatever the step: the connection reason wins over the tables reason. */
export function runBlockedReason(state: ActualizarWizardState): string | null {
  return connectionBlockingReason(state.connection) ?? tablesBlockingReason(state);
}

export function canContinue(state: ActualizarWizardState): boolean {
  switch (state.step) {
    case WizardStep.CONNECTION:
    case WizardStep.TABLES:
      return blockingReason(state) === null;
    case WizardStep.OPTIONS:
      return true;
    default:
      return false;
  }
}

const isPasswordTyped = (state: ActualizarWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

export function isRealRunConfirmed(state: ActualizarWizardState): boolean {
  const workTable = state.tables.work.trim();
  return workTable !== "" && state.confirmation.workTableLabel === workTable && isPasswordTyped(state);
}

export function canRunNow(state: ActualizarWizardState, flags: { dryRun: boolean }): boolean {
  if (runBlockedReason(state) !== null) return false;
  return flags.dryRun ? isPasswordTyped(state) : isRealRunConfirmed(state);
}

export function toStartRequest(state: ActualizarWizardState, flags: { dryRun: boolean }): ActualizarStartRequest {
  return {
    connection: trimConnection(state.connection),
    stagingSchema: state.stagingSchema.trim(),
    stagingTable: state.tables.staging.trim(),
    workSchema: state.workSchema.trim(),
    workTable: state.tables.work.trim(),
    padronTable: state.tables.padron.trim(),
    provinceTable: state.tables.province.trim(),
    localityTable: state.tables.locality.trim(),
    options: { ...state.options },
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
}

const indexOfStep = (step: WizardStep): number => STEP_ORDER.indexOf(step);

function canReach(state: ActualizarWizardState, target: WizardStep): boolean {
  const from = indexOfStep(state.step);
  const to = indexOfStep(target);
  if (to <= from) return true;
  for (let index = from; index < to; index++) {
    const step = STEP_ORDER[index];
    if (step === RUN_GATE_STEP && target === RUN_START_STEP) continue;
    if (!canContinue({ ...state, step })) return false;
  }
  return true;
}

const withoutDependents = (state: ActualizarWizardState): ActualizarWizardState => ({
  ...state,
  tables: emptyTables(),
  tableValidity: noTableValidity(),
  confirmation: emptyConfirmation(),
});

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: ActualizarWizardState, step: WizardStep): ActualizarWizardState {
  if (!canReach(state, step)) return state;
  const leavesReview = state.step === RUN_GATE_STEP && step !== RUN_GATE_STEP;
  return { ...state, step, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

function stepAfter(step: WizardStep, delta: number): WizardStep {
  return STEP_ORDER[indexOfStep(step) + delta] ?? step;
}

export function actualizarExcludedFor(state: ActualizarWizardState): Record<ActualizarTableKey, string[]> {
  const excludedFor = (key: ActualizarTableKey): string[] => {
    const others = TABLE_KEYS.filter((other) => other !== key && schemaFieldOf(other) === schemaFieldOf(key));
    const names = others.map((other) => state.tables[other].trim()).filter((name) => name !== "");
    return [...new Set(names)];
  };
  return Object.fromEntries(TABLE_KEYS.map((key) => [key, excludedFor(key)])) as Record<ActualizarTableKey, string[]>;
}

function connectionReducer(state: ActualizarWizardState, field: ConnectionField, value: string): ActualizarWizardState {
  if (field === "password") {
    return { ...state, connection: { ...state.connection, password: value }, confirmation: emptyConfirmation() };
  }
  return withoutDependents({ ...state, connection: { ...state.connection, [field]: value } });
}

function tableReducer(state: ActualizarWizardState, key: ActualizarTableKey, table: string, valid: boolean): ActualizarWizardState {
  const workChanged = key === ActualizarTableKey.WORK && table !== state.tables.work;
  const next: ActualizarWizardState = {
    ...state,
    tables: { ...state.tables, [key]: table },
    tableValidity: { ...state.tableValidity, [key]: valid },
  };
  return workChanged ? { ...next, confirmation: { ...next.confirmation, workTableLabel: "" } } : next;
}

export function wizardReducer(state: ActualizarWizardState, action: ActualizarWizardAction): ActualizarWizardState {
  switch (action.type) {
    case "connectionChanged":
      return connectionReducer(state, action.field, action.value);
    case "schemaChanged":
      return action.field === "stagingSchema"
        ? { ...withoutDependents(state), stagingSchema: action.value }
        : { ...withoutDependents(state), workSchema: action.value };
    case "tableChosen":
      return tableReducer(state, action.key, action.table, action.valid);
    case "optionsChanged":
      return { ...state, options: { ...state.options, ...action.patch } };
    case "confirmationChanged":
      return { ...state, confirmation: { ...state.confirmation, ...action.patch } };
    case "next":
      return canContinue(state) ? moveTo(state, stepAfter(state.step, 1)) : state;
    case "back":
      return moveTo(state, stepAfter(state.step, -1));
    case "goTo":
      return moveTo(state, action.step);
    case "runStarted":
      return { ...state, step: WizardStep.RESULT, confirmation: emptyConfirmation() };
    case "reset":
      return initialWizardState();
  }
}
