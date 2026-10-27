import { MAX_TARGETS } from "../jobs/cargar-localidades/constants";
import type { ClientConnection, LocalidadesStartRequest, StagingSelection } from "./clientTypes";
import type { CargarLocalidadesRunSnapshot } from "./cargarLocalidadesRunStore";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";

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

const DEFAULT_TOLERANCE_M = "1.0";

const FIXED_ORDER: readonly FixedTable[] = [FixedTable.PADRON, FixedTable.LOCALITY, FixedTable.PROVINCE];

export interface LocalidadesTargetDraft {
  key: number;
  schema: string;
  table: string;
  valid: boolean;
}

export interface LocalidadesOptionsDraft {
  tolerance: string;
  updateGeometries: boolean;
}

/** Typed table names are aligned with the targets by index: one typed name per target. */
export interface LocalidadesConfirmation {
  password: string;
  typedTables: string[];
}

export interface LocalidadesWizardState {
  step: LocalidadesStep;
  connection: ClientConnection;
  stagingSchema: string;
  provinceSchema: string;
  tables: Record<FixedTable, string>;
  validity: Record<FixedTable, boolean>;
  targets: LocalidadesTargetDraft[];
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
  | { type: "targetSchemaChanged"; index: number; schema: string }
  | { type: "targetChosen"; index: number; table: string; valid: boolean }
  | { type: "targetAdded" }
  | { type: "targetRemoved"; index: number }
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
  targetsMissing: "Añada al menos una tabla de localidades destino.",
  targetSchema: "Indique el esquema de cada tabla de localidades destino.",
  targetTable: "Elija la tabla de cada destino.",
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

const FIRST_TARGET_KEY = 1;

const emptyTarget = (key: number): LocalidadesTargetDraft => ({ key, schema: "", table: "", valid: false });

/** Keys stay stable while a target is kept, so the rows of the list never inherit another row's draft. */
const nextTargetKeyOf = (targets: readonly LocalidadesTargetDraft[]): number =>
  targets.reduce((highest, target) => Math.max(highest, target.key), 0) + 1;

const emptyConfirmation = (): LocalidadesConfirmation => ({ password: "", typedTables: [] });

function initialWizardState(seed: LocalidadesWizardSeed): LocalidadesWizardState {
  return {
    step: LocalidadesStep.TABLES,
    connection: seed.connection,
    stagingSchema: seed.staging?.schema ?? "",
    provinceSchema: "",
    tables: { padron: seed.staging?.table ?? "", locality: "", province: "" },
    validity: { padron: false, locality: false, province: false },
    targets: [emptyTarget(FIRST_TARGET_KEY)],
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

interface TableSlot {
  schema: string;
  table: string;
  valid: boolean;
}

/** Fixed tables first (padron, locality, province), then the targets, in the order the wizard shows them. */
const slotsOf = (state: LocalidadesWizardState): TableSlot[] => [
  { schema: state.stagingSchema, table: state.tables.padron, valid: state.validity.padron },
  { schema: state.stagingSchema, table: state.tables.locality, valid: state.validity.locality },
  { schema: state.provinceSchema, table: state.tables.province, valid: state.validity.province },
  ...state.targets,
];

export interface LocalidadesExcludedTables {
  fixed: Record<FixedTable, string[]>;
  targets: string[][];
}

/** Names already chosen in the same schema by another slot: a table cannot repeat them. */
export function excludedTablesOf(state: LocalidadesWizardState): LocalidadesExcludedTables {
  const slots = slotsOf(state);
  const excludedAt = (ownIndex: number): string[] => {
    const own = slots[ownIndex];
    const names = slots
      .filter((slot, index) => index !== ownIndex && slot.schema.trim() === own.schema.trim())
      .map((slot) => slot.table.trim())
      .filter((name) => name !== "");
    return [...new Set(names)];
  };
  return {
    fixed: Object.fromEntries(FIXED_ORDER.map((key, index) => [key, excludedAt(index)])) as Record<FixedTable, string[]>,
    targets: state.targets.map((_target, index) => excludedAt(FIXED_ORDER.length + index)),
  };
}

const sourceTablesBlockingReason = (state: LocalidadesWizardState): string | null => {
  if (isBlank(state.stagingSchema)) return MESSAGES.stagingSchema;
  if (isBlank(state.provinceSchema)) return MESSAGES.provinceSchema;
  if (FIXED_ORDER.some((key) => isBlank(state.tables[key]))) return MESSAGES.sourceTables;
  return null;
};

function tablesBlockingReason(state: LocalidadesWizardState): string | null {
  const sourceReason = sourceTablesBlockingReason(state);
  if (sourceReason !== null) return sourceReason;
  if (state.targets.length === 0) return MESSAGES.targetsMissing;
  if (state.targets.some((target) => isBlank(target.schema))) return MESSAGES.targetSchema;
  if (state.targets.some((target) => isBlank(target.table))) return MESSAGES.targetTable;
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
    state.targets.every((target, index) => !isBlank(target.table) && state.confirmation.typedTables[index].trim() === target.table.trim())
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
    targets: state.targets.map((target) => ({ schema: target.schema.trim(), table: target.table.trim() })),
    options: { tolerance: Number(state.options.tolerance.trim()), updateGeometries: state.options.updateGeometries },
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
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

const clearTypedAt = (typedTables: readonly string[], index: number): string[] =>
  typedTables.map((typed, typedIndex) => (typedIndex === index ? "" : typed));

function updateTarget(state: LocalidadesWizardState, index: number, patch: Partial<LocalidadesTargetDraft>): LocalidadesWizardState {
  return {
    ...state,
    targets: state.targets.map((target, targetIndex) => (targetIndex === index ? { ...target, ...patch } : target)),
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

function targetSchemaReducer(state: LocalidadesWizardState, index: number, schema: string): LocalidadesWizardState {
  const next = updateTarget(state, index, { schema, table: "", valid: false });
  return { ...next, confirmation: { ...next.confirmation, typedTables: clearTypedAt(next.confirmation.typedTables, index) } };
}

function targetChosenReducer(state: LocalidadesWizardState, index: number, table: string, valid: boolean): LocalidadesWizardState {
  const changed = table !== state.targets[index]?.table;
  const next = updateTarget(state, index, { table, valid });
  if (!changed) return next;
  return { ...next, confirmation: { ...next.confirmation, typedTables: clearTypedAt(next.confirmation.typedTables, index) } };
}

function targetAddedReducer(state: LocalidadesWizardState): LocalidadesWizardState {
  if (state.targets.length >= MAX_TARGETS) return state;
  return {
    ...state,
    targets: [...state.targets, emptyTarget(nextTargetKeyOf(state.targets))],
    confirmation: { ...state.confirmation, typedTables: [...state.confirmation.typedTables, ""] },
  };
}

function targetRemovedReducer(state: LocalidadesWizardState, index: number): LocalidadesWizardState {
  if (state.targets.length <= 1) return state;
  return {
    ...state,
    targets: state.targets.filter((_target, targetIndex) => targetIndex !== index),
    confirmation: {
      ...state.confirmation,
      typedTables: state.confirmation.typedTables.filter((_typed, typedIndex) => typedIndex !== index),
    },
  };
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
      return targetSchemaReducer(state, action.index, action.schema);
    case "targetChosen":
      return targetChosenReducer(state, action.index, action.table, action.valid);
    case "targetAdded":
      return targetAddedReducer(state);
    case "targetRemoved":
      return targetRemovedReducer(state, action.index);
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
