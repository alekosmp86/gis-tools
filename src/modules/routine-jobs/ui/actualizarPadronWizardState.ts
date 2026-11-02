// Same wizard API names as cargarPadronesWizardState: both jobs expose the reducer contract the tests fix.
// fallow-ignore-file duplicate-export
import { MONTHLY_TABLES } from "../config/monthlyTables";
import { DEFAULT_LOCALITY_TYPE } from "../jobs/actualizar-padron/constants";
import type { AcceptedGeometry, PairChoice } from "../jobs/actualizar-padron/types";
import type { ActualizarStartRequest, ClientConnection, StagingSelection } from "./clientTypes";
import { sameChoices, withChoice, withChoices, withoutChoice, withoutChoices } from "./pairChoices";
import { sameAccepts } from "./geometryAccepts";
import type { GeometryMapBase } from "./clientTypes";
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
  geometryAreaThresholdPercent: string;
}

const DEFAULT_GEOMETRY_AREA_THRESHOLD_PERCENT_TEXT = "5";
const PERCENT_SCALE = 100;
const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

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
  pairChoices: readonly PairChoice[];
  /** The choices of the last analysis that completed; null when none did. A persist needs them to match the current choices. */
  simulatedChoices: readonly PairChoice[] | null;
  /** The pending geometry changes the user accepted (AP-100); sent like the pair choices. */
  acceptedGeometries: readonly AcceptedGeometry[];
  /** The acceptances of the last analysis that completed; null when none did. A persist needs them to match. */
  simulatedAcceptedGeometries: readonly AcceptedGeometry[] | null;
  /** Old ids of the missing padrones marked for a later removal (AP-101): record only, never sent. */
  removalMarks: readonly number[];
}

type DecisionAction =
  | { type: "geometriesAccepted"; accepts: readonly AcceptedGeometry[] }
  | { type: "geometriesRejected"; accepts: readonly AcceptedGeometry[] }
  | { type: "removalMarked"; oldIds: readonly number[] }
  | { type: "removalUnmarked"; oldIds: readonly number[] };

export type ActualizarWizardAction =
  | DecisionAction
  | { type: "connectionChanged"; field: ConnectionField; value: string }
  | { type: "schemaChanged"; field: SchemaField; value: string }
  | { type: "tableChosen"; key: ActualizarTableKey; table: string; valid: boolean }
  | { type: "optionsChanged"; patch: Partial<ActualizarOptionsDraft> }
  | { type: "confirmationChanged"; patch: Partial<ActualizarWizardConfirmation> }
  | { type: "pairChoiceChosen"; choice: PairChoice }
  | { type: "pairChoiceRemoved"; choice: PairChoice }
  | { type: "pairChoicesChosen"; choices: readonly PairChoice[] }
  | { type: "pairChoicesRemoved"; choices: readonly PairChoice[] }
  | { type: "dryRunCompleted"; choices: readonly PairChoice[]; acceptedGeometries?: readonly AcceptedGeometry[] }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: WizardStep }
  | { type: "runStarted"; dryRun: boolean }
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
  geometryAreaThreshold: "El umbral de cambio de área debe ser un número entre 0 y 100.",
  planMissing: "El análisis no dejó un plan para guardar: vuelva a analizar.",
  confirmationTableMissing: "Escriba de nuevo el nombre de la tabla de destino para persistir.",
  confirmationPasswordMissing: "Escriba de nuevo la contraseña para persistir.",
  confirmationBothMissing: "Escriba de nuevo la contraseña y el nombre de la tabla de destino para persistir.",
  simulationStale: "Analice de nuevo con la selección de pares actual antes de persistir.",
  acceptsStale: "Analice de nuevo con las geometrías aceptadas actuales antes de persistir.",
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

/** Only the password outlives the review: an analysis runs with it, the typed table name never survives a change. */
const keepPasswordOnly = (state: ActualizarWizardState): ActualizarWizardConfirmation => ({
  password: state.confirmation.password,
  typedTable: "",
});

const defaultTables = (): Record<ActualizarTableKey, string> => ({
  [ActualizarTableKey.STAGING]: MONTHLY_TABLES.actualizarPadrones.staging.table,
  [ActualizarTableKey.TARGET]: MONTHLY_TABLES.actualizarPadrones.target.table,
  [ActualizarTableKey.PROVINCE]: MONTHLY_TABLES.actualizarPadrones.province.table,
  [ActualizarTableKey.LOCALITY]: MONTHLY_TABLES.actualizarPadrones.locality.table,
  [ActualizarTableKey.TYPE]: MONTHLY_TABLES.actualizarPadrones.type.table,
  [ActualizarTableKey.ADDRESS_MASTER]: "",
});

const defaultOptions = (): ActualizarOptionsDraft => ({
  localityType: DEFAULT_LOCALITY_TYPE,
  tolerance: DEFAULT_TOLERANCE_TEXT,
  updateGeometries: DEFAULT_UPDATE_GEOMETRIES,
  linkAddressMaster: false,
  geometryAreaThresholdPercent: DEFAULT_GEOMETRY_AREA_THRESHOLD_PERCENT_TEXT,
});

/** The threshold is typed in percent; the request carries the fraction. */
const isGeometryAreaThresholdValid = (text: string): boolean => {
  if (text.trim() === "") return false;
  const value = Number(text);
  return Number.isFinite(value) && value >= MIN_PERCENT && value <= MAX_PERCENT;
};

const geometryAreaThresholdOf = (text: string): number => Number(text.trim()) / PERCENT_SCALE;

const seedFieldsOf = (seed: ActualizarWizardSeed): Partial<ActualizarWizardState> => ({
  ...(seed.connection === undefined ? {} : { connection: seed.connection, step: WizardStep.TABLES }),
  ...(seed.staging === undefined
    ? {}
    : { stagingSchema: seed.staging.schema, tables: { ...defaultTables(), [ActualizarTableKey.STAGING]: seed.staging.table } }),
});

export function initialWizardState(seed: ActualizarWizardSeed = {}): ActualizarWizardState {
  return {
    step: WizardStep.CONNECTION,
    connection: { host: "", port: "5432", db_name: "", user: "", password: "" },
    stagingSchema: MONTHLY_TABLES.actualizarPadrones.staging.schema,
    cartoSchema: MONTHLY_TABLES.actualizarPadrones.target.schema,
    tables: defaultTables(),
    tableValidity: recordOfEveryKey(false),
    options: defaultOptions(),
    confirmation: emptyConfirmation(),
    pairChoices: [],
    simulatedChoices: null,
    acceptedGeometries: [],
    simulatedAcceptedGeometries: null,
    removalMarks: [],
    ...seedFieldsOf(seed),
  };
}

/** The choices of the run when it is a dry run that completed, null otherwise. */
export function completedDryRunChoicesOf(snapshot: ActualizarPadronRunSnapshot): readonly PairChoice[] | null {
  return snapshot.phase === RunPhase.DONE && snapshot.plan?.dryRun === true ? snapshot.plan.pairChoices : null;
}

/* One shared empty list, so a plan without acceptances yields the same reference on every render (an effect depends on it). */
const NO_ACCEPTS: readonly AcceptedGeometry[] = [];

/** The accepted geometries of the run when it is a dry run that completed, null otherwise. */
export function completedDryRunAcceptsOf(snapshot: ActualizarPadronRunSnapshot): readonly AcceptedGeometry[] | null {
  return snapshot.phase === RunPhase.DONE && snapshot.plan?.dryRun === true ? (snapshot.plan.acceptedGeometries ?? NO_ACCEPTS) : null;
}

/** The plan id of the completed analysis on screen, null when there is none (no analysis, or the result carries no plan). */
export function completedAnalysisPlanIdOf(snapshot: ActualizarPadronRunSnapshot): string | null {
  if (completedDryRunChoicesOf(snapshot) === null) return null;
  return snapshot.job?.result?.planId ?? null;
}

const isInFlight = (snapshot: ActualizarPadronRunSnapshot): boolean =>
  snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING;

/** A run still in flight keeps the decisions it was sent with, so a remount does not drop them; only a completed dry run counts as simulated. */
export function initialWizardStateFor(snapshot: ActualizarPadronRunSnapshot, seed: ActualizarWizardSeed = {}): ActualizarWizardState {
  const seeded = initialWizardState(seed);
  if (snapshot.phase === RunPhase.IDLE) return seeded;
  const simulated = completedDryRunChoicesOf(snapshot);
  const simulatedAccepts = completedDryRunAcceptsOf(snapshot);
  const inFlightPlan = isInFlight(snapshot) ? snapshot.plan : undefined;
  return {
    ...seeded,
    step: WizardStep.RESULT,
    pairChoices: simulated ?? inFlightPlan?.pairChoices ?? [],
    simulatedChoices: simulated,
    acceptedGeometries: simulatedAccepts ?? inFlightPlan?.acceptedGeometries ?? [],
    simulatedAcceptedGeometries: simulatedAccepts,
  };
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
  if (!isToleranceValid(state.options.tolerance)) return MESSAGES.tolerance;
  return isGeometryAreaThresholdValid(state.options.geometryAreaThresholdPercent) ? null : MESSAGES.geometryAreaThreshold;
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

const isTableTyped = (state: ActualizarWizardState): boolean => {
  const targetTable = state.tables.target.trim();
  return targetTable !== "" && state.confirmation.typedTable === targetTable;
};

export function isRealRunConfirmed(state: ActualizarWizardState): boolean {
  return isTableTyped(state) && isPasswordTyped(state);
}

/** The dry run keeps the password filled, so a persist usually only asks for the table name again. */
const confirmationMissingOf = (state: ActualizarWizardState): string => {
  if (isPasswordTyped(state)) return MESSAGES.confirmationTableMissing;
  return isTableTyped(state) ? MESSAGES.confirmationPasswordMissing : MESSAGES.confirmationBothMissing;
};

/** Pair choices and accepted geometries change the planned writes, so a persist needs the ones its completed analysis simulated (none when both are empty). */
export function simulationBlockingReason(state: ActualizarWizardState): string | null {
  if (!sameChoices(state.pairChoices, state.simulatedChoices ?? [])) return MESSAGES.simulationStale;
  return sameAccepts(state.acceptedGeometries, state.simulatedAcceptedGeometries ?? []) ? null : MESSAGES.acceptsStale;
}

/** Why the analysis on screen cannot be persisted, in the order the user can fix it; null when it can. */
export function persistBlockedReason(state: ActualizarWizardState, planId: string | null): string | null {
  const inputReason = runBlockedReason(state);
  if (inputReason !== null) return inputReason;
  if (planId === null) return MESSAGES.planMissing;
  if (!isRealRunConfirmed(state)) return confirmationMissingOf(state);
  return simulationBlockingReason(state);
}

export function canRunNow(state: ActualizarWizardState, flags: { dryRun: boolean }): boolean {
  if (runBlockedReason(state) !== null) return false;
  if (flags.dryRun) return isPasswordTyped(state);
  return isRealRunConfirmed(state) && simulationBlockingReason(state) === null;
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
      geometryAreaThreshold: geometryAreaThresholdOf(state.options.geometryAreaThresholdPercent),
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

function withPairChoices(request: ActualizarStartRequest, state: ActualizarWizardState): ActualizarStartRequest {
  if (state.pairChoices.length === 0) return request;
  return { ...request, options: { ...request.options, pairChoices: [...state.pairChoices] } };
}

/** The removal marks are never sent: only the accepted geometries join the request. */
function withAcceptedGeometries(request: ActualizarStartRequest, state: ActualizarWizardState): ActualizarStartRequest {
  const accepts = state.acceptedGeometries;
  if (accepts.length === 0) return request;
  return { ...request, options: { ...request.options, acceptedGeometries: [...accepts] } };
}

/** The connection and tables the map of the result reads. Null without a password: the map then asks for one. */
export function geometryMapBaseOf(state: ActualizarWizardState): GeometryMapBase | null {
  if (state.connection.password === "") return null;
  return {
    connection: trimConnection(state.connection),
    stagingSchema: state.stagingSchema.trim(),
    stagingTable: state.tables.staging.trim(),
    cartoSchema: state.cartoSchema.trim(),
    targetTable: state.tables.target.trim(),
  };
}

export function toStartRequest(state: ActualizarWizardState, flags: { dryRun: boolean }): ActualizarStartRequest {
  const request = withAcceptedGeometries(withPairChoices(withTypeTable(baseStartRequest(state, flags), state), state), state);
  if (!state.options.linkAddressMaster) return request;
  return { ...request, addressMasterTable: state.tables.addressMaster.trim() };
}

/** The real run that persists the analysis `planId`: the same request the analysis sent, plus the plan. */
export function toPersistRequest(state: ActualizarWizardState, planId: string): ActualizarStartRequest {
  return { ...toStartRequest(state, { dryRun: false }), planId };
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

/** The typed confirmation lives only while the review is on screen: leaving the review or its result clears the table name. */
function moveTo(state: ActualizarWizardState, step: WizardStep): ActualizarWizardState {
  const landing = landingStepOf(state, step);
  const leavesGate = (state.step === RUN_GATE_STEP || state.step === RUN_START_STEP) && landing !== RUN_GATE_STEP;
  return { ...state, step: landing, confirmation: leavesGate ? keepPasswordOnly(state) : state.confirmation };
}

function stepAfter(step: WizardStep, delta: number): WizardStep {
  return STEP_ORDER[indexOfStep(step) + delta] ?? step;
}

/** The review decisions (pair choices, accepted geometries, removal marks) name padrones of the tables and the matching options: they stop meaning anything once those change. */
const CLEARED_DECISIONS: Pick<ActualizarWizardState, "pairChoices" | "acceptedGeometries" | "removalMarks"> = {
  pairChoices: [],
  acceptedGeometries: [],
  removalMarks: [],
};

const withoutPairChoices = (state: ActualizarWizardState): ActualizarWizardState => ({ ...state, ...CLEARED_DECISIONS });

const decisionsKeptUnless = (state: ActualizarWizardState, changed: boolean): ActualizarWizardState =>
  changed ? withoutPairChoices(state) : state;

const withMarks = (marks: readonly number[], oldIds: readonly number[]): number[] => [...new Set([...marks, ...oldIds])];

const withoutMarks = (marks: readonly number[], oldIds: readonly number[]): number[] => {
  const removed = new Set(oldIds);
  return marks.filter((oldId) => !removed.has(oldId));
};

function decisionReducer(state: ActualizarWizardState, action: DecisionAction): ActualizarWizardState {
  switch (action.type) {
    case "geometriesAccepted":
      return { ...state, acceptedGeometries: withChoices(state.acceptedGeometries, action.accepts) };
    case "geometriesRejected":
      return { ...state, acceptedGeometries: withoutChoices(state.acceptedGeometries, action.accepts) };
    case "removalMarked":
      return { ...state, removalMarks: withMarks(state.removalMarks, action.oldIds) };
    case "removalUnmarked":
      return { ...state, removalMarks: withoutMarks(state.removalMarks, action.oldIds) };
  }
}

function connectionReducer(state: ActualizarWizardState, field: ConnectionField, value: string): ActualizarWizardState {
  if (field === "password") {
    return { ...state, connection: { ...state.connection, password: value }, confirmation: emptyConfirmation() };
  }
  return withoutPairChoices({
    ...state,
    connection: { ...state.connection, [field]: value },
    stagingSchema: "",
    cartoSchema: "",
    tables: recordOfEveryKey<string>(""),
    tableValidity: recordOfEveryKey(false),
    confirmation: emptyConfirmation(),
  });
}

function schemaReducer(state: ActualizarWizardState, field: SchemaField, value: string): ActualizarWizardState {
  const keys = DEPENDENT_KEYS[field];
  return withoutPairChoices({
    ...state,
    [field]: value,
    tables: clearedFor(keys, "", state.tables),
    tableValidity: clearedFor(keys, false, state.tableValidity),
    confirmation: keepPasswordOnly(state),
  });
}

function tableReducer(state: ActualizarWizardState, key: ActualizarTableKey, table: string, valid: boolean): ActualizarWizardState {
  const changed = table !== state.tables[key];
  const next: ActualizarWizardState = decisionsKeptUnless(
    {
      ...state,
      tables: { ...state.tables, [key]: table },
      tableValidity: { ...state.tableValidity, [key]: valid },
      confirmation: changed ? keepPasswordOnly(state) : state.confirmation,
    },
    changed,
  );
  if (key === ActualizarTableKey.TYPE && changed) {
    return { ...next, tableValidity: { ...next.tableValidity, [ActualizarTableKey.LOCALITY]: false } };
  }
  return next;
}

/** Turning the link on suggests the default address master table; turning it off drops that table, so a table nobody reads is never sent. */
/** The target's role depends on the link, so its validity is re-checked against the new role. */
function optionsReducer(state: ActualizarWizardState, patch: Partial<ActualizarOptionsDraft>): ActualizarWizardState {
  const linkChanged = patch.linkAddressMaster !== undefined && patch.linkAddressMaster !== state.options.linkAddressMaster;
  const optionChanged = (Object.keys(patch) as (keyof ActualizarOptionsDraft)[]).some((key) => patch[key] !== state.options[key]);
  const next: ActualizarWizardState = decisionsKeptUnless(
    {
      ...state,
      options: { ...state.options, ...patch },
      tableValidity: linkChanged ? { ...state.tableValidity, [ActualizarTableKey.TARGET]: false } : state.tableValidity,
      confirmation: keepPasswordOnly(state),
    },
    optionChanged,
  );
  return withAddressMasterTableFor(next, patch.linkAddressMaster);
}

function withAddressMasterTableFor(state: ActualizarWizardState, linkAddressMaster: boolean | undefined): ActualizarWizardState {
  if (linkAddressMaster === true && isBlank(state.tables.addressMaster)) {
    return { ...state, tables: { ...state.tables, [ActualizarTableKey.ADDRESS_MASTER]: MONTHLY_TABLES.actualizarPadrones.addressMaster.table } };
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
    case "pairChoiceChosen":
      return { ...state, pairChoices: withChoice(state.pairChoices, action.choice) };
    case "pairChoiceRemoved":
      return { ...state, pairChoices: withoutChoice(state.pairChoices, action.choice) };
    case "pairChoicesChosen":
      return { ...state, pairChoices: withChoices(state.pairChoices, action.choices) };
    case "pairChoicesRemoved":
      return { ...state, pairChoices: withoutChoices(state.pairChoices, action.choices) };
    case "geometriesAccepted":
    case "geometriesRejected":
    case "removalMarked":
    case "removalUnmarked":
      return decisionReducer(state, action);
    case "dryRunCompleted":
      return { ...state, simulatedChoices: action.choices, simulatedAcceptedGeometries: action.acceptedGeometries ?? [] };
    case "next":
      return canContinue(state) ? moveTo(state, stepAfter(state.step, 1)) : state;
    case "back":
      return moveTo(state, stepAfter(state.step, -1));
    case "goTo":
      return moveTo(state, action.step);
    case "runStarted":
      return { ...state, step: WizardStep.RESULT, confirmation: action.dryRun ? keepPasswordOnly(state) : emptyConfirmation() };
    case "reset":
      return initialWizardState(action.seed);
  }
}
