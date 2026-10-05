import {
  FINGERPRINT_PATTERN,
  OPERATION_ID_PATTERN,
  RemovalBlockReason,
} from "../removalConstants";
import type {
  RemovalBlocker,
  RemovalBlockerReason,
  RemovalConfirmation,
  RemovalPlan,
} from "../removalTypes";
import type { DuplicateAnalysisParameters } from "../types";

/** A deliberate refusal (not a malfunction): the removal declined to run, and wrote nothing. */
export class RemovalRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemovalRefusedError";
  }
}

/** One resolved target as the plan query reports it, before the master scan adds its findings. */
export interface TargetVerdict {
  readonly urn: string;
  readonly masterIds: ReadonlyArray<string>;
  readonly reasonCodes: ReadonlyArray<RemovalBlockReason>;
}

/** A table that still holds a row pointing at one of the target masters. */
export interface MasterReference {
  readonly masterId: string;
  readonly tableLabel: string;
}

/** The `referencia` an operation id is bound to: a deterministic scope string, never free text. */
export function buildRemovalReference(parameters: DuplicateAnalysisParameters): string {
  return `address-dedup:province=${parameters.provinceId};protectedSiblingRemovesLone=${parameters.protectedSiblingRemovesLone}`;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function assertConfirmation(confirmation: RemovalConfirmation): void {
  if (!OPERATION_ID_PATTERN.test(confirmation.operationId)) {
    throw new RemovalRefusedError("El identificador de la operación no es un UUID válido.");
  }
  if (isBlank(confirmation.responsable) || isBlank(confirmation.motivo)) {
    throw new RemovalRefusedError("El responsable y el motivo son obligatorios.");
  }
  if (!FINGERPRINT_PATTERN.test(confirmation.expectedFingerprint)) {
    throw new RemovalRefusedError("Falta la huella de la simulación que se confirma.");
  }
}

/** The one gate between a freshly recomputed plan and the first DELETE. */
export function assertExecutable(plan: RemovalPlan, expectedFingerprint: string): void {
  if (plan.blockers.length > 0) {
    throw new RemovalRefusedError(
      `Baja detenida: ${plan.blockers.length} dirección(es) no pueden eliminarse. Revise la simulación.`
    );
  }
  if (plan.counts.total === 0) {
    throw new RemovalRefusedError("No hay direcciones para eliminar.");
  }
  if (plan.fingerprint !== expectedFingerprint) {
    throw new RemovalRefusedError(
      "Cambió el alcance o los datos de la baja. Simular y confirmar nuevamente."
    );
  }
}

export function assertTargetsInScope(outOfScopeCount: number): void {
  if (outOfScopeCount > 0) {
    throw new RemovalRefusedError(
      `Baja detenida: ${outOfScopeCount} dirección(es) del alcance no tienen un motivo de eliminación.`
    );
  }
}

export function assertDeletedMatchesPlan(table: string, deleted: number, planned: number): void {
  if (deleted !== planned) {
    throw new RemovalRefusedError(
      `Baja detenida: ${table} eliminó ${deleted} filas y la simulación preveía ${planned}.`
    );
  }
}

function indexReferencesByMaster(references: ReadonlyArray<MasterReference>): Map<string, Set<string>> {
  const tablesByMaster = new Map<string, Set<string>>();
  for (const reference of references) {
    const tables = tablesByMaster.get(reference.masterId) ?? new Set<string>();
    tables.add(reference.tableLabel);
    tablesByMaster.set(reference.masterId, tables);
  }
  return tablesByMaster;
}

function toBlocker(verdict: TargetVerdict, tablesByMaster: Map<string, Set<string>>): RemovalBlocker | null {
  const reasons: RemovalBlockerReason[] = verdict.reasonCodes.map((code) => ({ code, detail: null }));
  const referencingTables = new Set<string>();
  for (const masterId of verdict.masterIds) {
    for (const tableLabel of tablesByMaster.get(masterId) ?? []) referencingTables.add(tableLabel);
  }
  for (const tableLabel of referencingTables) {
    reasons.push({ code: RemovalBlockReason.MASTER_REFERENCED, detail: tableLabel });
  }
  return reasons.length > 0 ? { urn: verdict.urn, reasons } : null;
}

export function buildBlockers(
  verdicts: ReadonlyArray<TargetVerdict>,
  references: ReadonlyArray<MasterReference>
): RemovalBlocker[] {
  const tablesByMaster = indexReferencesByMaster(references);
  const blockers: RemovalBlocker[] = [];
  for (const verdict of verdicts) {
    const blocker = toBlocker(verdict, tablesByMaster);
    if (blocker) blockers.push(blocker);
  }
  return blockers;
}
