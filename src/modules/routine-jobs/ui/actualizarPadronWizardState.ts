// Same wizard API names as cargarPadronesWizardState: both jobs expose the reducer contract the tests fix.
// fallow-ignore-file duplicate-export
import { DEFAULT_LOCALITY_TYPE } from "../jobs/actualizar-padron/constants";
import { DEFAULT_ADDRESS_MASTER_TABLE } from "../jobs/shared/addressMasterLinkSpec";
import type { ActualizarStartRequest, ClientConnection, StagingSelection } from "./clientTypes";
import type { ActualizarPadronRunSnapshot } from "./actualizarPadronRunStore";
import {
  connectionBlockingReason,
  WizardStep,
  type ConnectionField,
} from "./cargarPadronesWizardState";
import { trimConnection } from "./connectionProfiles";
import { DEFAULT_TOLERANCE_TEXT, DEFAULT_UPDATE_GEOMETRIES, isToleranceValid, toleranceOf, type GeometryOptionsDraft } from "./geometryOptions";
import { RunPhase } from "./jobRunStore";
import {
  ActualizarTableKey,
  REQUIRED_TABLE_KEYS,
  schemaFieldOf,
  TABLE_KEYS,
  type ActualizarTableSelection,
  type SchemaField,
} from "./actualizarPadronTables";

export { WizardStep } from "./cargarPadronesWizardState";
export { actualizarExcludedFor, ActualizarTableKey, roleOfTableKey, schemaFieldOf } from "./actualizarPadronTables";

export interface ActualizarOptionsDraft extends GeometryOptionsDraft {
  localityType: string;
  linkAddressMaster: boolean;
}

export interface ActualizarWizardConfirmation {
  password: string;
  typedTable: string;
}

export const GEOMETRY_OVERWRITE_WARNING =
  "Actualizar geometrías reemplaza la geometría de los padrones existentes por la del catastro cuando cambió. Si corregiste geometrías a mano en la tabla de destino, esas correcciones se perderán. El análisis lista cada geometría que cambiaría: revísala antes de cargar, o desactiva la opción.";

/** Hub-validated connection and the staging table chosen in stage 1: both are fixed when the wizard opens or resets. */
export interface ActualizarWizardSeed {
  connection?: ClientConnection;
  staging?: StagingSelection;
}

export interface ActualizarWizardState extends ActualizarTableSelection {
  step: WizardStep;
  connection: ClientConnection;
  tableValidity: Record<ActualizarTableKey, boolean>;
  options: ActualizarOptionsDraft;
  confirmation: ActualizarWizardConfirmation;
}

export type ActualizarWizardAction =
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "schemaChanged"; field: SchemaField; value: string }
  | { type: "tableChosen"; key: ActualizarTableKey; table: string; valid: boolean }
  | { type: "optionsChanged"; patch: Partial<ActualizarOptionsDraft> }
  | { type: "confirmationChanged"; patch: Partial<ActualizarWizardConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: WizardStep }
  | { type: "runStarted" }
  | { type: "reset"; seed?: ActualizarWizardSeed };

const STEP_ORDER: readonly WizardStep[] = [
  WizardStep.CONNECTION,
  WizardStep.TABLES,
  WizardStep.OPTIONS,
  WizardStep.REVIEW,
  WizardStep.RESULT,
];
const RUN_START_STEP = WizardStep.RESULT;
const RUN_GATE_STEP = WizardStep.REVIEW;
const SCHEMA_FIELDS: readonly SchemaField[] = ["stagingSchema", "cartoSchema"];

const MESSAGES = {
  stagingSchema: "Indique el esquema de la tabla de origen.",
  cartoSchema: "Indique el esquema de carto: destino, provincias, localidades y tipos.",
  tablesMissing: "Elija las tablas obligatorias: origen, destino, provincias y localidades.",
  tablesDistinct: "Las tablas elegidas deben ser distintas dentro de su esquema.",
  tablesInvalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
  localityType: "Indique el tipo de localidad o quite la tabla de tipos de unidad.",
  addressMaster: "Elija la tabla de direcciones maestras o desactive el enlace de padrones.",
  tolerance: "La tolerancia debe ser un número mayor o igual que 0.",
} as const;

const DEPENDENT_KEYS: Record<SchemaField, readonly ActualizarTableKey[]> = {
  stagingSchema: [ActualizarTableKey.STAGING],
  cartoSchema: [
    ActualizarTableKey.TARGET,
    ActualizarTableKey.PROVINCE,
    ActualizarTableKey.LOCALITY,
    ActualizarTableKey.TYPE,
    ActualizarTableKey.ADDRESS_MASTER,
  ],
};

const recordOfEveryKey = <Value>(value: Value): Record<ActualizarTableKey, Value> =>
  Object.fromEntries(TABLE_KEYS.map((key) => [key, value])) as Record<ActualizarTableKey, Value>;

const clearedFor = <Value>(
  keys: readonly ActualizarTableKey[],
  cleared: Value,
  record: Record<ActualizarTableKey, Value>,
): Record<ActualizarTableKey, Value> =>
  Object.fromEntries(TABLE_KEYS.map((key) => [key, keys.includes(key) ? cleared : record[key]])) as Record<ActualizarTableKey, Value>;

const emptyConfirmation = (): ActualizarWizardConfirmation => ({ password: "", typedTable: "" });

const defaultOptions = (): ActualizarOptionsDraft => ({
  localityType: DEFAULT_LOCALITY_TYPE,
  tolerance: DEFAULT_TOLERANCE_TEXT,
  updateGeometries: DEFAULT_UPDATE_GEOMETRIES,
  linkAddressMaster: false,
});

const seedFieldsOf = (seed: ActualizarWizardSeed): Partial<ActualizarWizardState> => ({
  ...(seed.connection === undefined ? {} : { connection: seed.connection, step: WizardStep.TABLES }),
  ...(seed.staging === undefined
    ? {}
    : { stagingSchema: seed.staging.schema, tables: { ...recordOfEveryKey<string>(""), [ActualizarTableKey.STAGING]: seed.staging.table } }),
});

export function initialWizardState(seed: ActualizarWizardSeed = {}): ActualizarWizardState {
  return {
    step: WizardStep.CONNECTION,
    connection: { host: "", port: "5432", db_name: "", user: "", password: "" },
    stagingSchema: "",
    cartoSchema: "",
    tables: recordOfEveryKey<string>(""),
    tableValidity: recordOfEveryKey(false),
    options: defaultOptions(),
    confirmation: emptyConfirmation(),
    ...seedFieldsOf(seed),
  };
}

export function initialWizardStateFor(snapshot: ActualizarPadronRunSnapshot, seed: ActualizarWizardSeed = {}): ActualizarWizardState {
  const seeded = initialWizardState(seed);
  return snapshot.phase === RunPhase.IDLE ? seeded : { ...seeded, step: WizardStep.RESULT };
}

const isBlank = (value: string): boolean => value.trim() === "";

export const isTypeTableChosen = (state: ActualizarWizardState): boolean => !isBlank(state.tables[ActualizarTableKey.TYPE]);

const schemaBlockingReason = (state: ActualizarWizardState): string | null => {
  const blankField = SCHEMA_FIELDS.find((field) => isBlank(state[field]));
  return blankField === undefined ? null : MESSAGES[blankField];
};

const qualifiedNameOf = (state: ActualizarWizardState, key: ActualizarTableKey): string =>
  `${state[schemaFieldOf(key)].trim()}.${state.tables[key].trim()}`;

const chosenKeysOf = (state: ActualizarWizardState): ActualizarTableKey[] =>
  TABLE_KEYS.filter((key) => !isBlank(state.tables[key]));

function tablesBlockingReason(state: ActualizarWizardState): string | null {
  const schemaReason = schemaBlockingReason(state);
  if (schemaReason !== null) return schemaReason;
  if (REQUIRED_TABLE_KEYS.some((key) => isBlank(state.tables[key]))) return MESSAGES.tablesMissing;
  if (state.options.linkAddressMaster && isBlank(state.tables.addressMaster)) return MESSAGES.addressMaster;
  const chosen = chosenKeysOf(state);
  const names = chosen.map((key) => qualifiedNameOf(state, key));
  if (new Set(names).size !== names.length) return MESSAGES.tablesDistinct;
  if (chosen.some((key) => !state.tableValidity[key])) return MESSAGES.tablesInvalid;
  return null;
}

function optionsBlockingReason(state: ActualizarWizardState): string | null {
  if (isTypeTableChosen(state) && isBlank(state.options.localityType)) return MESSAGES.localityType;
  return isToleranceValid(state.options.tolerance) ? null : MESSAGES.tolerance;
}

export function blockingReason(state: ActualizarWizardState): string | null {
  switch (state.step) {
    case WizardStep.CONNECTION:
      return connectionBlockingReason(state.connection);
    case WizardStep.TABLES:
      return tablesBlockingReason(state);
    case WizardStep.OPTIONS:
      return optionsBlockingReason(state);
    default:
      return null;
  }
}

/** The run cannot start whatever the step: the connection reason wins, then the tables, then the options. */
export function runBlockedReason(state: ActualizarWizardState): string | null {
  return connectionBlockingReason(state.connection) ?? tablesBlockingReason(state) ?? optionsBlockingReason(state);
}

export function canContinue(state: ActualizarWizardState): boolean {
  switch (state.step) {
    case WizardStep.CONNECTION:
    case WizardStep.TABLES:
    case WizardStep.OPTIONS:
      return blockingReason(state) === null;
    default:
      return false;
  }
}

const isPasswordTyped = (state: ActualizarWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

export function isRealRunConfirmed(state: ActualizarWizardState): boolean {
  const targetTable = state.tables.target.trim();
  return targetTable !== "" && state.confirmation.typedTable === targetTable && isPasswordTyped(state);
}

export function canRunNow(state: ActualizarWizardState, flags: { dryRun: boolean }): boolean {
  if (runBlockedReason(state) !== null) return false;
  return flags.dryRun ? isPasswordTyped(state) : isRealRunConfirmed(state);
}

function baseStartRequest(state: ActualizarWizardState, flags: { dryRun: boolean }): ActualizarStartRequest {
  return {
    connection: trimConnection(state.connection),
    stagingSchema: state.stagingSchema.trim(),
    stagingTable: state.tables.staging.trim(),
    cartoSchema: state.cartoSchema.trim(),
    targetTable: state.tables.target.trim(),
    provinceTable: state.tables.province.trim(),
    localityTable: state.tables.locality.trim(),
    options: {
      tolerance: toleranceOf(state.options.tolerance),
      updateGeometries: state.options.updateGeometries,
      linkAddressMaster: state.options.linkAddressMaster,
    },
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
}

function withTypeTable(request: ActualizarStartRequest, state: ActualizarWizardState): ActualizarStartRequest {
  if (!isTypeTableChosen(state)) return request;
  return {
    ...request,
    typeTable: state.tables.type.trim(),
    options: { ...request.options, localityType: state.options.localityType.trim() },
  };
}

export function toStartRequest(state: ActualizarWizardState, flags: { dryRun: boolean }): ActualizarStartRequest {
  const request = withTypeTable(baseStartRequest(state, flags), state);
  if (!state.options.linkAddressMaster) return request;
  return { ...request, addressMasterTable: state.tables.addressMaster.trim() };
}

const indexOfStep = (step: WizardStep): number => STEP_ORDER.indexOf(step);

/** A forward jump stops at the first step that cannot be left; a backward jump always lands on its target. */
function landingStepOf(state: ActualizarWizardState, target: WizardStep): WizardStep {
  const from = indexOfStep(state.step);
  const to = indexOfStep(target);
  for (let index = from; index < to; index++) {
    const step = STEP_ORDER[index];
    if (step === RUN_GATE_STEP && target === RUN_START_STEP) continue;
    if (!canContinue({ ...state, step })) return step;
  }
  return target;
}

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: ActualizarWizardState, step: WizardStep): ActualizarWizardState {
  const landing = landingStepOf(state, step);
  const leavesReview = state.step === RUN_GATE_STEP && landing !== RUN_GATE_STEP;
  return { ...state, step: landing, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

function stepAfter(step: WizardStep, delta: number): WizardStep {
  return STEP_ORDER[indexOfStep(step) + delta] ?? step;
}

function connectionReducer(state: ActualizarWizardState, field: ConnectionField, value: string): ActualizarWizardState {
  if (field === "password") {
    return { ...state, connection: { ...state.connection, password: value }, confirmation: emptyConfirmation() };
  }
  return {
    ...state,
    connection: { ...state.connection, [field]: value },
    stagingSchema: "",
    cartoSchema: "",
    tables: recordOfEveryKey<string>(""),
    tableValidity: recordOfEveryKey(false),
    confirmation: emptyConfirmation(),
  };
}

function schemaReducer(state: ActualizarWizardState, field: SchemaField, value: string): ActualizarWizardState {
  const keys = DEPENDENT_KEYS[field];
  return {
    ...state,
    [field]: value,
    tables: clearedFor(keys, "", state.tables),
    tableValidity: clearedFor(keys, false, state.tableValidity),
    confirmation: field === "cartoSchema" ? { ...state.confirmation, typedTable: "" } : state.confirmation,
  };
}

function tableReducer(state: ActualizarWizardState, key: ActualizarTableKey, table: string, valid: boolean): ActualizarWizardState {
  const changed = table !== state.tables[key];
  const next: ActualizarWizardState = {
    ...state,
    tables: { ...state.tables, [key]: table },
    tableValidity: { ...state.tableValidity, [key]: valid },
  };
  if (key === ActualizarTableKey.TARGET && changed) {
    return { ...next, confirmation: { ...next.confirmation, typedTable: "" } };
  }
  if (key === ActualizarTableKey.TYPE && changed) {
    return { ...next, tableValidity: { ...next.tableValidity, [ActualizarTableKey.LOCALITY]: false } };
  }
  return next;
}

/** Turning the link on suggests the default address master table; turning it off drops that table, so a table nobody reads is never sent. */
/** The target's role depends on the link, so its validity is re-checked against the new role. */
function optionsReducer(state: ActualizarWizardState, patch: Partial<ActualizarOptionsDraft>): ActualizarWizardState {
  const linkChanged = patch.linkAddressMaster !== undefined && patch.linkAddressMaster !== state.options.linkAddressMaster;
  const next: ActualizarWizardState = {
    ...state,
    options: { ...state.options, ...patch },
    tableValidity: linkChanged ? { ...state.tableValidity, [ActualizarTableKey.TARGET]: false } : state.tableValidity,
  };
  return withAddressMasterTableFor(next, patch.linkAddressMaster);
}

function withAddressMasterTableFor(state: ActualizarWizardState, linkAddressMaster: boolean | undefined): ActualizarWizardState {
  if (linkAddressMaster === true && isBlank(state.tables.addressMaster)) {
    return { ...state, tables: { ...state.tables, [ActualizarTableKey.ADDRESS_MASTER]: DEFAULT_ADDRESS_MASTER_TABLE } };
  }
  if (linkAddressMaster !== false) return state;
  return {
    ...state,
    tables: { ...state.tables, [ActualizarTableKey.ADDRESS_MASTER]: "" },
    tableValidity: { ...state.tableValidity, [ActualizarTableKey.ADDRESS_MASTER]: false },
  };
}

export function wizardReducer(state: ActualizarWizardState, action: ActualizarWizardAction): ActualizarWizardState {
  switch (action.type) {
    case "connectionChanged":
      return connectionReducer(state, action.field, action.value);
    case "schemaChanged":
      return schemaReducer(state, action.field, action.value);
    case "tableChosen":
      return tableReducer(state, action.key, action.table, action.valid);
    case "optionsChanged":
      return optionsReducer(state, action.patch);
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
