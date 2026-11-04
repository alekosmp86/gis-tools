import type {
  ActualizarPlanRecord,
  PadronClassification,
  PadronDataFingerprint,
  PadronGeometryChange,
  PlanExpectedCounts,
  PlanSnapshot,
} from "../types";

export { paramsFingerprintOf } from "./planFingerprint";
export { isPlanId, isPlanRecord } from "./planRecordGuard";

export const PLAN_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const PLAN_MISSING_MESSAGE = "Para guardar la carga primero analice la actualización: falta el plan del análisis.";
export const PLAN_UNKNOWN_MESSAGE = "El plan del análisis no existe: vuelva a analizar.";
export const PLAN_EXPIRED_MESSAGE = "El plan del análisis caducó: vuelva a analizar.";
const PLAN_PARAMS_MESSAGE = "El plan del análisis corresponde a otros parámetros: vuelva a analizar.";
const PLAN_CHANGED_MESSAGE = "El plan cambió desde el análisis; vuelva a analizar.";

export const snapshotOf = (classification: PadronClassification): PlanSnapshot => ({
  dataFingerprint: classification.fingerprint,
  expected: {
    inserted: classification.counts.inserted,
    updates: classification.counts.updates,
    pairs: classification.counts.pairs,
  },
});

const sameFingerprint = (left: PadronDataFingerprint, right: PadronDataFingerprint): boolean =>
  left.targetRows === right.targetRows &&
  left.targetMaxId === right.targetMaxId &&
  left.stagingCandidates === right.stagingCandidates &&
  left.digest === right.digest;

const sameExpected = (left: PlanExpectedCounts, right: PlanExpectedCounts): boolean =>
  left.inserted === right.inserted && left.updates === right.updates && left.pairs === right.pairs;

export function assertPlanStillValid(plan: PlanSnapshot, current: PlanSnapshot): void {
  if (!sameFingerprint(plan.dataFingerprint, current.dataFingerprint) || !sameExpected(plan.expected, current.expected)) {
    throw new Error(PLAN_CHANGED_MESSAGE);
  }
}

/** Returns the record when it may authorise a real run; otherwise throws the Spanish refusal for its cause. */
export function usablePlanOf(
  record: ActualizarPlanRecord | undefined,
  paramsFingerprint: string,
  nowMs: number
): ActualizarPlanRecord {
  if (record === undefined) throw new Error(PLAN_UNKNOWN_MESSAGE);
  if (Date.parse(record.expiresAt) <= nowMs) throw new Error(PLAN_EXPIRED_MESSAGE);
  if (record.paramsFingerprint !== paramsFingerprint) throw new Error(PLAN_PARAMS_MESSAGE);
  return record;
}

export function buildPlanRecord(
  planId: string,
  paramsFingerprint: string,
  snapshot: PlanSnapshot,
  pendingGeometryChanges: readonly PadronGeometryChange[],
  nowMs: number
): ActualizarPlanRecord {
  return {
    planId,
    paramsFingerprint,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + PLAN_TTL_MS).toISOString(),
    dataFingerprint: snapshot.dataFingerprint,
    expected: snapshot.expected,
    pendingGeometryChanges: [...pendingGeometryChanges],
  };
}
