// fallow-ignore-file duplicate-export
import { MONTHLY_TABLES, type MonthlyTable } from "../config/monthlyTables";
import { DEFAULT_LOCALITY_TYPE_NAME } from "../jobs/unidad-territorial/constants";
import type { ClientConnection, UnidadStartRequest } from "./clientTypes";
import { DEFAULT_TOLERANCE_TEXT, DEFAULT_UPDATE_GEOMETRIES, isToleranceValid, toleranceOf } from "./geometryOptions";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";
import type { UnidadRunSnapshot } from "./unidadTerritorialRunStore";

export const UnidadStep = {
  TABLES: "tables",
  OPTIONS: "options",
  REVIEW: "review",
  RUN: "run",
  REPORT: "report",
} as const;

export type UnidadStep = (typeof UnidadStep)[keyof typeof UnidadStep];

export const UnitSlot = {
  LOCALITY: "locality",
  TYPE: "type",
  TARGET: "target",
  ADDRESS_MASTER: "addressMaster",
} as const;

export type UnitSlot = (typeof UnitSlot)[keyof typeof UnitSlot];

export interface UnitSlotDraft {
  schema: string;
  table: string;
  valid: boolean;
}

export interface UnidadOptionsDraft {
  localityTypeName: string;
  tolerance: string;
  updateGeometries: boolean;
  linkAddressMaster: boolean;
}

export interface UnidadConfirmation {
  password: string;
  typedTable: string;
}

export interface UnidadTerritorialWizardState {
  step: UnidadStep;
  connection: ClientConnection;
  slots: Record<UnitSlot, UnitSlotDraft>;
  options: UnidadOptionsDraft;
  confirmation: UnidadConfirmation;
}

/** Hub-validated connection; the locality table prefills from the last stage 2 run when there is one. */
export interface UnidadWizardSeed {
  connection: ClientConnection;
  locality?: { schema: string; table: string };
}

export type UnidadWizardAction =
  | { type: "slotSchemaChanged"; key: UnitSlot; schema: string }
  | { type: "slotTableChosen"; key: UnitSlot; table: string; valid: boolean }
  | { type: "optionsChanged"; patch: Partial<UnidadOptionsDraft> }
  | { type: "confirmationChanged"; patch: Partial<UnidadConfirmation> }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: UnidadStep }
  | { type: "runStarted" }
  | { type: "reset"; seed: UnidadWizardSeed };

const STEP_ORDER: readonly UnidadStep[] = [
  UnidadStep.TABLES,
  UnidadStep.OPTIONS,
  UnidadStep.REVIEW,
  UnidadStep.RUN,
  UnidadStep.REPORT,
];

const REQUIRED_SLOT_ORDER: readonly UnitSlot[] = [UnitSlot.LOCALITY, UnitSlot.TYPE, UnitSlot.TARGET];
const SLOT_ORDER: readonly UnitSlot[] = [...REQUIRED_SLOT_ORDER, UnitSlot.ADDRESS_MASTER];

const DEFAULT_LINK_ADDRESS_MASTER = true;

const MESSAGES = {
  schema: "Indique el esquema de la tabla de localidades, la de tipos y la de unidades territoriales.",
  addressMasterSchema: "Indique el esquema de la tabla de direcciones maestras.",
  table: "Elija la tabla de localidades, la de tipos y la de unidades territoriales.",
  addressMasterTable: "Elija la tabla de direcciones maestras o desactive el enlace de direcciones maestras.",
  distinct: "Las tablas elegidas deben ser distintas: no repita el mismo esquema y nombre.",
  invalid: "Alguna tabla tiene columnas faltantes o ambiguas.",
  localityTypeName: "Indique el nombre del tipo de localidad.",
  tolerance: "La tolerancia debe ser un número mayor o igual que 0.",
} as const;

export const UNIT_GEOMETRY_OVERWRITE_WARNING =
  "Actualizar geometrías reemplaza la geometría de las unidades territoriales cuya localidad cambió. Si corregiste geometrías a mano en esta tabla, esas correcciones se perderán. El análisis lista cada geometría que cambiaría: revísala antes de cargar, o desactiva la opción.";

const isBlank = (value: string): boolean => value.trim() === "";

const defaultSlot = (defaultTable: MonthlyTable): UnitSlotDraft => ({ schema: defaultTable.schema, table: defaultTable.table, valid: false });

const emptyConfirmation = (): UnidadConfirmation => ({ password: "", typedTable: "" });

const clearedTypedTable = (state: UnidadTerritorialWizardState): UnidadTerritorialWizardState => ({
  ...state,
  confirmation: { ...state.confirmation, typedTable: "" },
});

function initialState(seed: UnidadWizardSeed): UnidadTerritorialWizardState {
  return {
    step: UnidadStep.TABLES,
    connection: seed.connection,
    slots: {
      [UnitSlot.LOCALITY]:
        seed.locality === undefined
          ? defaultSlot(MONTHLY_TABLES.actualizarUnidades.locality)
          : { schema: seed.locality.schema, table: seed.locality.table, valid: false },
      [UnitSlot.TYPE]: defaultSlot(MONTHLY_TABLES.actualizarUnidades.type),
      [UnitSlot.TARGET]: defaultSlot(MONTHLY_TABLES.actualizarUnidades.target),
      [UnitSlot.ADDRESS_MASTER]: defaultSlot(MONTHLY_TABLES.actualizarUnidades.addressMaster),
    },
    options: {
      localityTypeName: DEFAULT_LOCALITY_TYPE_NAME,
      tolerance: DEFAULT_TOLERANCE_TEXT,
      updateGeometries: DEFAULT_UPDATE_GEOMETRIES,
      linkAddressMaster: DEFAULT_LINK_ADDRESS_MASTER,
    },
    confirmation: emptyConfirmation(),
  };
}

/** The wizard opens on the tables step when no run exists, otherwise on the run step. */
export function initialUnidadWizardStateFor(snapshot: UnidadRunSnapshot, seed: UnidadWizardSeed): UnidadTerritorialWizardState {
  const seeded = initialState(seed);
  return snapshot.phase === RunPhase.IDLE ? seeded : { ...seeded, step: UnidadStep.RUN };
}

/** The slots in play: the address master slot only while its link option is on. */
export const activeSlotsOf = (state: UnidadTerritorialWizardState): readonly UnitSlot[] =>
  state.options.linkAddressMaster ? SLOT_ORDER : REQUIRED_SLOT_ORDER;

/** Names already chosen in the same schema by another slot: a table cannot repeat them. */
export function excludedUnitTablesOf(state: UnidadTerritorialWizardState): Record<UnitSlot, string[]> {
  const excludedAt = (ownKey: UnitSlot): string[] => {
    const own = state.slots[ownKey];
    const names = SLOT_ORDER.filter((key) => key !== ownKey && state.slots[key].schema.trim() === own.schema.trim())
      .map((key) => state.slots[key].table.trim())
      .filter((name) => name !== "");
    return [...new Set(names)];
  };
  return Object.fromEntries(SLOT_ORDER.map((key) => [key, excludedAt(key)])) as Record<UnitSlot, string[]>;
}

function tablesBlockingReason(state: UnidadTerritorialWizardState): string | null {
  const required = REQUIRED_SLOT_ORDER.map((key) => state.slots[key]);
  const addressMaster = state.slots[UnitSlot.ADDRESS_MASTER];
  const linked = state.options.linkAddressMaster;
  if (required.some((slot) => isBlank(slot.schema))) return MESSAGES.schema;
  if (linked && isBlank(addressMaster.schema)) return MESSAGES.addressMasterSchema;
  if (required.some((slot) => isBlank(slot.table))) return MESSAGES.table;
  if (linked && isBlank(addressMaster.table)) return MESSAGES.addressMasterTable;
  const slots = activeSlotsOf(state).map((key) => state.slots[key]);
  const names = slots.map((slot) => `${slot.schema.trim()}.${slot.table.trim()}`);
  if (new Set(names).size !== names.length) return MESSAGES.distinct;
  if (slots.some((slot) => !slot.valid)) return MESSAGES.invalid;
  return null;
}

function optionsBlockingReason(state: UnidadTerritorialWizardState): string | null {
  if (isBlank(state.options.localityTypeName)) return MESSAGES.localityTypeName;
  return isToleranceValid(state.options.tolerance) ? null : MESSAGES.tolerance;
}

export function blockingReason(state: UnidadTerritorialWizardState): string | null {
  switch (state.step) {
    case UnidadStep.TABLES:
      return tablesBlockingReason(state);
    case UnidadStep.OPTIONS:
      return optionsBlockingReason(state);
    default:
      return null;
  }
}

/** The run cannot start whatever the step: the tables reason wins, then the options. */
export function runBlockedReason(state: UnidadTerritorialWizardState): string | null {
  return tablesBlockingReason(state) ?? optionsBlockingReason(state);
}

export function canContinue(state: UnidadTerritorialWizardState): boolean {
  return (state.step === UnidadStep.TABLES || state.step === UnidadStep.OPTIONS) && blockingReason(state) === null;
}

const isPasswordTyped = (state: UnidadTerritorialWizardState): boolean =>
  state.confirmation.password !== "" && state.confirmation.password === state.connection.password;

const isRealRunConfirmed = (state: UnidadTerritorialWizardState): boolean => {
  const targetTable = state.slots[UnitSlot.TARGET].table.trim();
  return targetTable !== "" && state.confirmation.typedTable === targetTable && isPasswordTyped(state);
};

export function canRunNow(state: UnidadTerritorialWizardState, flags: { dryRun: boolean }): boolean {
  if (runBlockedReason(state) !== null) return false;
  return flags.dryRun ? isPasswordTyped(state) : isRealRunConfirmed(state);
}

function withAddressMasterOf(request: UnidadStartRequest, state: UnidadTerritorialWizardState): UnidadStartRequest {
  if (!state.options.linkAddressMaster) return request;
  const addressMaster = state.slots[UnitSlot.ADDRESS_MASTER];
  return { ...request, addressMasterTable: { schema: addressMaster.schema.trim(), table: addressMaster.table.trim() } };
}

export function toUnidadStartRequest(state: UnidadTerritorialWizardState, flags: { dryRun: boolean }): UnidadStartRequest {
  const locality = state.slots[UnitSlot.LOCALITY];
  const type = state.slots[UnitSlot.TYPE];
  const target = state.slots[UnitSlot.TARGET];
  const request: UnidadStartRequest = {
    connection: trimConnection(state.connection),
    localitySchema: locality.schema.trim(),
    localityTable: locality.table.trim(),
    typeSchema: type.schema.trim(),
    typeTable: type.table.trim(),
    targetSchema: target.schema.trim(),
    targetTable: target.table.trim(),
    options: {
      localityTypeName: state.options.localityTypeName.trim(),
      tolerance: toleranceOf(state.options.tolerance),
      updateGeometries: state.options.updateGeometries,
      linkAddressMaster: state.options.linkAddressMaster,
    },
    dryRun: flags.dryRun,
    confirm: !flags.dryRun,
  };
  return withAddressMasterOf(request, state);
}

const indexOfStep = (step: UnidadStep): number => STEP_ORDER.indexOf(step);

/** A forward jump stops at the first tables or options step that is not valid. */
function landingStepOf(state: UnidadTerritorialWizardState, target: UnidadStep): UnidadStep {
  const from = indexOfStep(state.step);
  const to = indexOfStep(target);
  if (to <= from) return target;
  const limit = Math.min(to, indexOfStep(UnidadStep.REVIEW));
  for (let index = from; index < limit; index++) {
    const step = STEP_ORDER[index];
    if (!canContinue({ ...state, step })) return step;
  }
  return target;
}

/** The typed confirmation lives only while the review is on screen, so it never outlives that step. */
function moveTo(state: UnidadTerritorialWizardState, step: UnidadStep): UnidadTerritorialWizardState {
  const landing = landingStepOf(state, step);
  const leavesReview = state.step === UnidadStep.REVIEW && landing !== UnidadStep.REVIEW;
  return { ...state, step: landing, confirmation: leavesReview ? emptyConfirmation() : state.confirmation };
}

const stepAfter = (step: UnidadStep, delta: number): UnidadStep => STEP_ORDER[indexOfStep(step) + delta] ?? step;

/** Only the target's typed name is confirmed: changing the target's schema or table asks for it again. */
function slotSchemaReducer(state: UnidadTerritorialWizardState, key: UnitSlot, schema: string): UnidadTerritorialWizardState {
  const next = { ...state, slots: { ...state.slots, [key]: { schema, table: "", valid: false } } };
  return key === UnitSlot.TARGET ? clearedTypedTable(next) : next;
}

function slotTableReducer(
  state: UnidadTerritorialWizardState,
  key: UnitSlot,
  table: string,
  valid: boolean
): UnidadTerritorialWizardState {
  const changed = table !== state.slots[key].table;
  const next = { ...state, slots: { ...state.slots, [key]: { ...state.slots[key], table, valid } } };
  return changed && key === UnitSlot.TARGET ? clearedTypedTable(next) : next;
}

/** Turning the link on suggests the default address master table; turning it off drops that table, so a table nobody reads is never sent. */
function withAddressMasterSlotFor(state: UnidadTerritorialWizardState, linkAddressMaster: boolean): UnidadTerritorialWizardState {
  const slot = state.slots[UnitSlot.ADDRESS_MASTER];
  const table = linkAddressMaster
    ? (isBlank(slot.table) ? MONTHLY_TABLES.actualizarUnidades.addressMaster.table : slot.table)
    : "";
  return { ...state, slots: { ...state.slots, [UnitSlot.ADDRESS_MASTER]: { ...slot, table, valid: false } } };
}

/** The target's role depends on the link, so its validity is re-checked against the new role. */
function withTargetRevalidationPending(state: UnidadTerritorialWizardState): UnidadTerritorialWizardState {
  const target = state.slots[UnitSlot.TARGET];
  return { ...state, slots: { ...state.slots, [UnitSlot.TARGET]: { ...target, valid: false } } };
}

function optionsReducer(state: UnidadTerritorialWizardState, patch: Partial<UnidadOptionsDraft>): UnidadTerritorialWizardState {
  const next = { ...state, options: { ...state.options, ...patch } };
  const linkChanged = patch.linkAddressMaster !== undefined && patch.linkAddressMaster !== state.options.linkAddressMaster;
  return linkChanged ? withAddressMasterSlotFor(withTargetRevalidationPending(next), patch.linkAddressMaster === true) : next;
}

export function unidadWizardReducer(
  state: UnidadTerritorialWizardState,
  action: UnidadWizardAction
): UnidadTerritorialWizardState {
  switch (action.type) {
    case "slotSchemaChanged":
      return slotSchemaReducer(state, action.key, action.schema);
    case "slotTableChosen":
      return slotTableReducer(state, action.key, action.table, action.valid);
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
      return { ...state, step: UnidadStep.RUN, confirmation: emptyConfirmation() };
    case "reset":
      return initialState(action.seed);
  }
}
