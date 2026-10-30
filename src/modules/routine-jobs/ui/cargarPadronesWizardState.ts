// fallow-ignore-file duplicate-export
import { MONTHLY_TABLES } from "../config/monthlyTables";
import type { TableRole } from "../jobs/cargar-padrones/constants";
import { TABLE_ROLE } from "../jobs/cargar-padrones/constants";
import type { ClientConnection, JobOptions, StagingSelection, StartRequest } from "./clientTypes";
import type { CargarPadronesRunSnapshot } from "./cargarPadronesRunStore";

export const WizardStep = {
  CONNECTION: "connection",
  TABLES: "tables",
  OPTIONS: "options",
  REVIEW: "review",
  RESULT: "result",
} as const;

export type WizardStep = (typeof WizardStep)[keyof typeof WizardStep];

const STEP_ORDER: readonly WizardStep[] = [
  WizardStep.CONNECTION,
  WizardStep.TABLES,
  WizardStep.OPTIONS,
  WizardStep.REVIEW,
  WizardStep.RESULT,
];

export interface WizardConfirmation {
  password: string;
  targetLabel: string;
}

/** A connection validated by the hub: the wizard then starts on the tables step and never shows its own connection step. */
export interface WizardSeed {
  connection?: ClientConnection;
}

export interface WizardState {
  step: WizardStep;
  connection: ClientConnection;
  schema: string;
  tables: Record<TableRole, string>;
  tableValidity: Record<TableRole, boolean>;
  options: JobOptions;
  confirmation: WizardConfirmation;
}

export type ConnectionField = keyof ClientConnection;

export type WizardAction =
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "schemaChanged"; schema: string }
  | { type: "tableChosen"; role: TableRole; table: string; valid: boolean }
  | { type: "optionsChanged"; patch: Partial<JobOptions> }
  | { type: "confirmationChanged"; patch: Partial<WizardConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: WizardStep }
  | { type: "runStarted" }
  | { type: "reset"; seed?: WizardSeed };

const PORT_MIN = 1;
const PORT_MAX = 65535;
const DEFAULT_PORT = "5432";
const DIGITS_PATTERN = /^\d+$/;
const RUN_START_STEP = WizardStep.RESULT;
const RUN_GATE_STEP = WizardStep.REVIEW;

const MESSAGES = {
  host: "Indique el servidor (host).",
  port: `El puerto debe ser un número entre ${PORT_MIN} y ${PORT_MAX}.`,
  database: "Indique la base de datos.",
  user: "Indique el usuario.",
  schema: "Indique el esquema de las tablas.",
  tablesMissing: "Elija las tres tablas: rural, urbana y destino.",
  tablesDistinct: "Las tablas rural, urbana y destino deben ser distintas.",
  tablesInvalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
} as const;

const ROLES: readonly TableRole[] = [TABLE_ROLE.RURAL, TABLE_ROLE.URBANO, TABLE_ROLE.TARGET];

const emptyTables = (): Record<TableRole, string> => ({ rural: "", urbano: "", target: "" });
const defaultTables = (): Record<TableRole, string> => ({
  rural: MONTHLY_TABLES.cargarPadrones.rural,
  urbano: MONTHLY_TABLES.cargarPadrones.urbano,
  target: MONTHLY_TABLES.cargarPadrones.target,
});
const noTableValidity = (): Record<TableRole, boolean> => ({ rural: false, urbano: false, target: false });
const emptyConfirmation = (): WizardConfirmation => ({ password: "", targetLabel: "" });

const seedFieldsOf = (seed: WizardSeed): Partial<WizardState> =>
  seed.connection === undefined ? {} : { connection: seed.connection, step: WizardStep.TABLES };

export function initialWizardState(seed: WizardSeed = {}): WizardState {
  return {
    step: WizardStep.CONNECTION,
    connection: { host: "", port: DEFAULT_PORT, db_name: "", user: "", password: "" },
    schema: MONTHLY_TABLES.cargarPadrones.schema,
    tables: defaultTables(),
    tableValidity: noTableValidity(),
    options: { repair: true, clearMode: "delete", resetSequences: true },
    confirmation: { password: "", targetLabel: "" },
    ...seedFieldsOf(seed),
  };
}

/** The wizard opens on the connection step when no run exists, otherwise on the result step. */
export const initialStepFor = (snapshot: CargarPadronesRunSnapshot): WizardStep =>
  snapshot.phase === "idle" ? WizardStep.CONNECTION : WizardStep.RESULT;

export function initialWizardStateFor(snapshot: CargarPadronesRunSnapshot, seed: WizardSeed = {}): WizardState {
  const step = initialStepFor(snapshot);
  const seeded = initialWizardState(seed);
  return step === WizardStep.CONNECTION ? seeded : { ...seeded, step };
}

/** Every connection field changes the server or the credentials, so it invalidates the catalog failures. */
const CATALOG_FIELDS: readonly ConnectionField[] = ["host", "port", "db_name", "user", "password"];

export function connectionFieldInvalidatesCatalog(field: ConnectionField): boolean {
  return CATALOG_FIELDS.includes(field);
}

const isBlank = (value: string): boolean => value.trim() === "";

const isValidPort = (value: string): boolean => {
  const trimmed = value.trim();
  if (!DIGITS_PATTERN.test(trimmed)) return false;
  const port = Number(trimmed);
  return port >= PORT_MIN && port <= PORT_MAX;
};

export function connectionBlockingReason(connection: ClientConnection): string | null {
  if (isBlank(connection.host)) return MESSAGES.host;
  if (!isValidPort(connection.port)) return MESSAGES.port;
  if (isBlank(connection.db_name)) return MESSAGES.database;
  if (isBlank(connection.user)) return MESSAGES.user;
  return null;
}

function tablesBlockingReason(state: WizardState): string | null {
  if (isBlank(state.schema)) return MESSAGES.schema;
  if (ROLES.some((role) => isBlank(state.tables[role]))) return MESSAGES.tablesMissing;
  const names = ROLES.map((role) => state.tables[role].trim());
  if (new Set(names).size !== names.length) return MESSAGES.tablesDistinct;
  if (ROLES.some((role) => !state.tableValidity[role])) return MESSAGES.tablesInvalid;
  return null;
}

export function blockingReason(state: WizardState): string | null {
  switch (state.step) {
    case WizardStep.CONNECTION:
      return connectionBlockingReason(state.connection);
    case WizardStep.TABLES:
      return tablesBlockingReason(state);
    default:
      return null;
  }
}

/** The reason the run cannot start, regardless of the step: the connection reason wins over the tables reason. */
export function runBlockedReason(state: WizardState): string | null {
  return connectionBlockingReason(state.connection) ?? tablesBlockingReason(state);
}

export function canRunNow(state: WizardState): boolean {
  return runBlockedReason(state) === null;
}

export function canContinue(state: WizardState): boolean {
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

const indexOfStep = (step: WizardStep): number => STEP_ORDER.indexOf(step);

function canReach(state: WizardState, target: WizardStep): boolean {
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

const withoutDependents = (state: WizardState): WizardState => ({
  ...state,
  tables: emptyTables(),
  tableValidity: noTableValidity(),
  confirmation: emptyConfirmation(),
});

function moveTo(state: WizardState, step: WizardStep): WizardState {
  return canReach(state, step) ? { ...state, step } : state;
}

function stepAfter(step: WizardStep, delta: number): WizardStep {
  const next = STEP_ORDER[indexOfStep(step) + delta];
  return next ?? step;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "connectionChanged":
      if (action.field === "password") {
        return {
          ...state,
          connection: { ...state.connection, password: action.value },
          confirmation: emptyConfirmation(),
        };
      }
      return withoutDependents({
        ...state,
        connection: { ...state.connection, [action.field]: action.value },
      });
    case "schemaChanged":
      return { ...withoutDependents(state), schema: action.schema };
    case "tableChosen": {
      const targetChanged = action.role === TABLE_ROLE.TARGET && action.table !== state.tables.target;
      const next: WizardState = {
        ...state,
        tables: { ...state.tables, [action.role]: action.table },
        tableValidity: { ...state.tableValidity, [action.role]: action.valid },
      };
      return targetChanged ? { ...next, confirmation: { password: "", targetLabel: "" } } : next;
    }
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
      return initialWizardState(action.seed);
  }
}

export function stagingSelectionOf(state: WizardState): StagingSelection | null {
  const schema = state.schema.trim();
  const table = state.tables.target.trim();
  return schema === "" || table === "" ? null : { schema, table };
}

export function isRealRunConfirmed(state: WizardState): boolean {
  const target = state.tables.target.trim();
  return (
    target !== "" &&
    state.confirmation.targetLabel === target &&
    state.confirmation.password === state.connection.password
  );
}

export function toStartRequest(state: WizardState, flags: { dryRun: boolean }): StartRequest {
  const { connection } = state;
  return {
    connection: {
      host: connection.host.trim(),
      port: connection.port.trim(),
      db_name: connection.db_name.trim(),
      user: connection.user.trim(),
      password: connection.password,
    },
    schema: state.schema.trim(),
    ruralTable: state.tables.rural.trim(),
    urbanoTable: state.tables.urbano.trim(),
    targetTable: state.tables.target.trim(),
    options: { ...state.options },
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
}
