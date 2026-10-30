// fallow-ignore-file duplicate-export
import { MONTHLY_TABLES, type MonthlyTable } from "../config/monthlyTables";
import type { ClientConnection, LocalidadesStartRequest, StagingSelection } from "./clientTypes";
import type { CargarLocalidadesRunSnapshot, LocalidadesRunRequest } from "./cargarLocalidadesRunStore";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";
import { LocalidadesDestination } from "./localidadesDestination";

export type { LocalidadesDestination };

export const LocalidadesStep = {
  TABLES: "tables",
  OPTIONS: "options",
  REVIEW: "review",
  RUN: "run",
  REPORT: "report",
} as const;

export type LocalidadesStep = (typeof LocalidadesStep)[keyof typeof LocalidadesStep];

export const FixedTable = {
  PADRON: "padron",
  LOCALITY: "locality",
  PROVINCE: "province",
} as const;

export type FixedTable = (typeof FixedTable)[keyof typeof FixedTable];

export const DESTINATION_ORDER: readonly LocalidadesDestination[] = [LocalidadesDestination.BDJ_CARTO, LocalidadesDestination.CARTO];

export const DESTINATION_TITLE: Record<LocalidadesDestination, string> = {
  [LocalidadesDestination.BDJ_CARTO]: "Localidades en bdj_carto",
  [LocalidadesDestination.CARTO]: "Localidades en carto",
};

type LocalidadesSlotKey = FixedTable | LocalidadesDestination;

const DEFAULT_TOLERANCE_M = "1.0";

const FIXED_ORDER: readonly FixedTable[] = [FixedTable.PADRON, FixedTable.LOCALITY, FixedTable.PROVINCE];

export interface LocalidadesTargetDraft {
  schema: string;
  table: string;
  valid: boolean;
  included: boolean;
}

export interface LocalidadesIncludedTarget {
  destination: LocalidadesDestination;
  schema: string;
  table: string;
}

export interface LocalidadesOptionsDraft {
  tolerance: string;
  updateGeometries: boolean;
}

/** Typed table names are keyed by destination; only the included destinations ask for one. */
export interface LocalidadesConfirmation {
  password: string;
  typedTables: Record<LocalidadesDestination, string>;
}

export interface LocalidadesWizardState {
  step: LocalidadesStep;
  connection: ClientConnection;
  stagingSchema: string;
  provinceSchema: string;
  tables: Record<FixedTable, string>;
  validity: Record<FixedTable, boolean>;
  targets: Record<LocalidadesDestination, LocalidadesTargetDraft>;
  options: LocalidadesOptionsDraft;
  confirmation: LocalidadesConfirmation;
}

/** Hub-validated connection and the stage-1 staging table, fixed when the wizard opens or resets. */
export interface LocalidadesWizardSeed {
  connection: ClientConnection;
  staging?: StagingSelection;
}

export type LocalidadesWizardAction =
  | { type: "stagingSchemaChanged"; schema: string }
  | { type: "provinceSchemaChanged"; schema: string }
  | { type: "tableChosen"; key: FixedTable; table: string; valid: boolean }
  | { type: "targetSchemaChanged"; destination: LocalidadesDestination; schema: string }
  | { type: "targetChosen"; destination: LocalidadesDestination; table: string; valid: boolean }
  | { type: "targetIncludedChanged"; destination: LocalidadesDestination; included: boolean }
  | { type: "optionsChanged"; patch: Partial<LocalidadesOptionsDraft> }
  | { type: "confirmationChanged"; patch: Partial<LocalidadesConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: LocalidadesStep }
  | { type: "runStarted" }
  | { type: "reset"; seed: LocalidadesWizardSeed };

const STEP_ORDER: readonly LocalidadesStep[] = [
  LocalidadesStep.TABLES,
  LocalidadesStep.OPTIONS,
  LocalidadesStep.REVIEW,
  LocalidadesStep.RUN,
  LocalidadesStep.REPORT,
];

const MESSAGES = {
  stagingSchema: "Indique el esquema de la tabla de padrones y de la tabla de localidades de origen.",
  provinceSchema: "Indique el esquema de la tabla de provincias.",
  sourceTables: "Elija la tabla de padrones, la de localidades de origen y la de provincias.",
  noDestination: "Incluya al menos un destino: Localidades en bdj_carto o Localidades en carto.",
  targetSchema: "Indique el esquema de cada destino incluido.",
  targetTable: "Elija la tabla de cada destino incluido.",
  tablesDistinct: "Las tablas elegidas deben ser distintas: no repita el mismo esquema y nombre.",
  tablesInvalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
  tolerance: "La tolerancia debe ser un número mayor o igual que 0.",
} as const;

export const GEOMETRY_OVERWRITE_WARNING =
  "Actualizar geometrías reemplaza la geometría de las localidades que cambiaron. Si corregiste geometrías a mano (por ejemplo solapes) directamente en estas tablas, esas correcciones se perderán. El análisis lista cada geometría que cambiaría: revísala antes de cargar, o desactiva la opción.";

const isBlank = (value: string): boolean => value.trim() === "";

const isToleranceValid = (text: string): boolean => {
  if (isBlank(text)) return false;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0;
};

const targetDraftOf = (defaultTable: MonthlyTable, included: boolean): LocalidadesTargetDraft => ({
  schema: defaultTable.schema,
  table: defaultTable.table,
  valid: false,
  included,
});

const emptyTypedTables = (): Record<LocalidadesDestination, string> => ({
  [LocalidadesDestination.BDJ_CARTO]: "",
  [LocalidadesDestination.CARTO]: "",
});

const emptyConfirmation = (): LocalidadesConfirmation => ({ password: "", typedTables: emptyTypedTables() });

function initialWizardState(seed: LocalidadesWizardSeed): LocalidadesWizardState {
  return {
    step: LocalidadesStep.TABLES,
    connection: seed.connection,
    stagingSchema: seed.staging?.schema ?? MONTHLY_TABLES.cargarLocalidades.padron.schema,
    provinceSchema: MONTHLY_TABLES.cargarLocalidades.province.schema,
    tables: {
      padron: seed.staging?.table ?? MONTHLY_TABLES.cargarLocalidades.padron.table,
      locality: MONTHLY_TABLES.cargarLocalidades.locality.table,
      province: MONTHLY_TABLES.cargarLocalidades.province.table,
    },
    validity: { padron: false, locality: false, province: false },
    targets: {
      [LocalidadesDestination.BDJ_CARTO]: targetDraftOf(MONTHLY_TABLES.cargarLocalidades.targetBdjCarto, true),
      [LocalidadesDestination.CARTO]: targetDraftOf(MONTHLY_TABLES.cargarLocalidades.targetCarto, false),
    },
    options: { tolerance: DEFAULT_TOLERANCE_M, updateGeometries: true },
    confirmation: emptyConfirmation(),
  };
}

/** The wizard opens on the tables step when no run exists, otherwise on the run step. */
export function initialWizardStateFor(
  snapshot: CargarLocalidadesRunSnapshot,
  seed: LocalidadesWizardSeed,
): LocalidadesWizardState {
  const seeded = initialWizardState(seed);
  return snapshot.phase === RunPhase.IDLE ? seeded : { ...seeded, step: LocalidadesStep.RUN };
}

const includedDestinationsOf = (state: LocalidadesWizardState): LocalidadesDestination[] =>
  DESTINATION_ORDER.filter((destination) => state.targets[destination].included);

export function includedTargetsOf(state: LocalidadesWizardState): LocalidadesIncludedTarget[] {
  return includedDestinationsOf(state).map((destination) => ({
    destination,
    schema: state.targets[destination].schema.trim(),
    table: state.targets[destination].table.trim(),
  }));
}

interface TableSlot {
  key: LocalidadesSlotKey;
  schema: string;
  table: string;
  valid: boolean;
}

/** Fixed tables first (padron, locality, province), then the included destinations, in the order the wizard shows them. */
const slotsOf = (state: LocalidadesWizardState): TableSlot[] => [
  { key: FixedTable.PADRON, schema: state.stagingSchema, table: state.tables.padron, valid: state.validity.padron },
  { key: FixedTable.LOCALITY, schema: state.stagingSchema, table: state.tables.locality, valid: state.validity.locality },
  { key: FixedTable.PROVINCE, schema: state.provinceSchema, table: state.tables.province, valid: state.validity.province },
  ...includedDestinationsOf(state).map((destination) => ({
    key: destination,
    schema: state.targets[destination].schema,
    table: state.targets[destination].table,
    valid: state.targets[destination].valid,
  })),
];

export type LocalidadesExcludedTables = Record<LocalidadesSlotKey, string[]>;

/** Names already chosen in the same schema by another slot: a table cannot repeat them. */
const namesInSameSchemaOf = (slots: readonly TableSlot[], key: LocalidadesSlotKey): string[] => {
  const own = slots.find((slot) => slot.key === key);
  if (own === undefined) return [];
  const names = slots
    .filter((slot) => slot.key !== key && slot.schema.trim() === own.schema.trim())
    .map((slot) => slot.table.trim())
    .filter((name) => name !== "");
  return [...new Set(names)];
};

export function excludedTablesOf(state: LocalidadesWizardState): LocalidadesExcludedTables {
  const slots = slotsOf(state);
  const keys: LocalidadesSlotKey[] = [...FIXED_ORDER, ...DESTINATION_ORDER];
  return Object.fromEntries(keys.map((key) => [key, namesInSameSchemaOf(slots, key)])) as LocalidadesExcludedTables;
}

const sourceTablesBlockingReason = (state: LocalidadesWizardState): string | null => {
  if (isBlank(state.stagingSchema)) return MESSAGES.stagingSchema;
  if (isBlank(state.provinceSchema)) return MESSAGES.provinceSchema;
  if (FIXED_ORDER.some((key) => isBlank(state.tables[key]))) return MESSAGES.sourceTables;
  return null;
};

function destinationsBlockingReason(state: LocalidadesWizardState): string | null {
  const included = includedDestinationsOf(state);
  if (included.length === 0) return MESSAGES.noDestination;
  if (included.some((destination) => isBlank(state.targets[destination].schema))) return MESSAGES.targetSchema;
  if (included.some((destination) => isBlank(state.targets[destination].table))) return MESSAGES.targetTable;
  return null;
}

function tablesBlockingReason(state: LocalidadesWizardState): string | null {
  const sourceReason = sourceTablesBlockingReason(state);
  if (sourceReason !== null) return sourceReason;
  const destinationReason = destinationsBlockingReason(state);
  if (destinationReason !== null) return destinationReason;
  const slots = slotsOf(state);
  const names = slots.map((slot) => `${slot.schema.trim()}.${slot.table.trim()}`);
  if (new Set(names).size !== names.length) return MESSAGES.tablesDistinct;
  if (slots.some((slot) => !slot.valid)) return MESSAGES.tablesInvalid;
  return null;
}

const optionsBlockingReason = (state: LocalidadesWizardState): string | null =>
  isToleranceValid(state.options.tolerance) ? null : MESSAGES.tolerance;

export function blockingReason(state: LocalidadesWizardState): string | null {
  switch (state.step) {
    case LocalidadesStep.TABLES:
      return tablesBlockingReason(state);
    case LocalidadesStep.OPTIONS:
      return optionsBlockingReason(state);
    default:
      return null;
  }
}

/** The run cannot start whatever the step: the tables reason wins, then the options. */
export function runBlockedReason(state: LocalidadesWizardState): string | null {
  return tablesBlockingReason(state) ?? optionsBlockingReason(state);
}

export function canContinue(state: LocalidadesWizardState): boolean {
  return (state.step === LocalidadesStep.TABLES || state.step === LocalidadesStep.OPTIONS) && blockingReason(state) === null;
}

const isPasswordTyped = (state: LocalidadesWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

function isRealRunConfirmed(state: LocalidadesWizardState): boolean {
  return (
    isPasswordTyped(state) &&
    includedTargetsOf(state).every(
      (target) => target.table !== "" && state.confirmation.typedTables[target.destination].trim() === target.table,
    )
  );
}

export function canRunNow(state: LocalidadesWizardState, flags: { dryRun: boolean }): boolean {
  if (runBlockedReason(state) !== null) return false;
  return flags.dryRun ? isPasswordTyped(state) : isRealRunConfirmed(state);
}

export function toStartRequest(state: LocalidadesWizardState, flags: { dryRun: boolean }): LocalidadesStartRequest {
  return {
    connection: trimConnection(state.connection),
    stagingSchema: state.stagingSchema.trim(),
    padronTable: state.tables.padron.trim(),
    localityStagingTable: state.tables.locality.trim(),
    provinceSchema: state.provinceSchema.trim(),
    provinceTable: state.tables.province.trim(),
    targets: includedTargetsOf(state).map(({ schema, table }) => ({ schema, table })),
    options: { tolerance: Number(state.options.tolerance.trim()), updateGeometries: state.options.updateGeometries },
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
}

export function toRunRequest(state: LocalidadesWizardState, flags: { dryRun: boolean }): LocalidadesRunRequest {
  return { request: toStartRequest(state, flags), targets: includedTargetsOf(state) };
}

const indexOfStep = (step: LocalidadesStep): number => STEP_ORDER.indexOf(step);

/** A forward jump stops at the first tables or options step that is not valid; the run and report are reachable from the review onwards. */
function landingStepOf(state: LocalidadesWizardState, target: LocalidadesStep): LocalidadesStep {
  const from = indexOfStep(state.step);
  const to = indexOfStep(target);
  if (to <= from) return target;
  const limit = Math.min(to, indexOfStep(LocalidadesStep.REVIEW));
  for (let index = from; index < limit; index++) {
    const step = STEP_ORDER[index];
    if (!canContinue({ ...state, step })) return step;
  }
  return target;
}

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: LocalidadesWizardState, step: LocalidadesStep): LocalidadesWizardState {
  const landing = landingStepOf(state, step);
  const leavesReview = state.step === LocalidadesStep.REVIEW && landing !== LocalidadesStep.REVIEW;
  return { ...state, step: landing, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

const stepAfter = (step: LocalidadesStep, delta: number): LocalidadesStep => STEP_ORDER[indexOfStep(step) + delta] ?? step;

const clearTypedFor = (confirmation: LocalidadesConfirmation, destination: LocalidadesDestination): LocalidadesConfirmation => ({
  ...confirmation,
  typedTables: { ...confirmation.typedTables, [destination]: "" },
});

function updateTarget(
  state: LocalidadesWizardState,
  destination: LocalidadesDestination,
  patch: Partial<LocalidadesTargetDraft>,
): LocalidadesWizardState {
  return {
    ...state,
    targets: { ...state.targets, [destination]: { ...state.targets[destination], ...patch } },
  };
}

function stagingSchemaReducer(state: LocalidadesWizardState, schema: string): LocalidadesWizardState {
  return {
    ...state,
    stagingSchema: schema,
    tables: { ...state.tables, padron: "", locality: "" },
    validity: { ...state.validity, padron: false, locality: false },
  };
}

function provinceSchemaReducer(state: LocalidadesWizardState, schema: string): LocalidadesWizardState {
  return { ...state, provinceSchema: schema, tables: { ...state.tables, province: "" }, validity: { ...state.validity, province: false } };
}

function targetSchemaReducer(state: LocalidadesWizardState, destination: LocalidadesDestination, schema: string): LocalidadesWizardState {
  const next = updateTarget(state, destination, { schema, table: "", valid: false });
  return { ...next, confirmation: clearTypedFor(next.confirmation, destination) };
}

function targetChosenReducer(
  state: LocalidadesWizardState,
  destination: LocalidadesDestination,
  table: string,
  valid: boolean,
): LocalidadesWizardState {
  const changed = table !== state.targets[destination].table;
  const next = updateTarget(state, destination, { table, valid });
  if (!changed) return next;
  return { ...next, confirmation: clearTypedFor(next.confirmation, destination) };
}

function targetIncludedReducer(
  state: LocalidadesWizardState,
  destination: LocalidadesDestination,
  included: boolean,
): LocalidadesWizardState {
  const next = updateTarget(state, destination, { included });
  return { ...next, confirmation: clearTypedFor(next.confirmation, destination) };
}

export function localidadesWizardReducer(state: LocalidadesWizardState, action: LocalidadesWizardAction): LocalidadesWizardState {
  switch (action.type) {
    case "stagingSchemaChanged":
      return stagingSchemaReducer(state, action.schema);
    case "provinceSchemaChanged":
      return provinceSchemaReducer(state, action.schema);
    case "tableChosen":
      return {
        ...state,
        tables: { ...state.tables, [action.key]: action.table },
        validity: { ...state.validity, [action.key]: action.valid },
      };
    case "targetSchemaChanged":
      return targetSchemaReducer(state, action.destination, action.schema);
    case "targetChosen":
      return targetChosenReducer(state, action.destination, action.table, action.valid);
    case "targetIncludedChanged":
      return targetIncludedReducer(state, action.destination, action.included);
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
      return { ...state, step: LocalidadesStep.RUN, confirmation: emptyConfirmation() };
    case "reset":
      return initialWizardState(action.seed);
  }
}
