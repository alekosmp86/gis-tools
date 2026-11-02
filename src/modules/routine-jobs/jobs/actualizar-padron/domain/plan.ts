import { createHash } from "node:crypto";
import type {
  AcceptedGeometry,
  ActualizarPadronParams,
  ActualizarPlanRecord,
  PadronClassification,
  PadronDataFingerprint,
  PadronGeometryChange,
  PairChoice,
  PlanExpectedCounts,
  PlanSnapshot,
} from "../types";

export const PLAN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;

export const PLAN_MISSING_MESSAGE = "Para guardar la carga primero analice la actualización: falta el plan del análisis.";
export const PLAN_UNKNOWN_MESSAGE = "El plan del análisis no existe: vuelva a analizar.";
export const PLAN_EXPIRED_MESSAGE = "El plan del análisis caducó: vuelva a analizar.";
const PLAN_PARAMS_MESSAGE = "El plan del análisis corresponde a otros parámetros: vuelva a analizar.";
const PLAN_CHANGED_MESSAGE = "El plan cambió desde el análisis; vuelva a analizar.";

export const isPlanId = (value: unknown): value is string => typeof value === "string" && PLAN_ID_PATTERN.test(value);

const canonicalChoiceOf = (choice: PairChoice): PairChoice => ({
  typePadron: choice.typePadron,
  provinceId: choice.provinceId,
  localityId: choice.localityId,
  number: choice.number,
  oldId: choice.oldId,
});

/** Sorted, so the order of the choices in the request never changes the fingerprint. */
const canonicalChoicesOf = (choices: readonly PairChoice[]): string[] =>
  choices.map((choice) => JSON.stringify(canonicalChoiceOf(choice))).sort();

const canonicalAcceptsOf = (accepts: readonly AcceptedGeometry[]): string[] =>
  accepts
    .map((accept) => JSON.stringify([accept.typePadron, accept.provinceId, accept.localityId, accept.number]))
    .sort();

/** The request parameters that define the analysis result. The password and the flags that gate the write are not among them. */
export function paramsFingerprintOf(params: ActualizarPadronParams): string {
  const canonical = {
    host: params.config.host.trim().toLowerCase(),
    port: String(params.config.port),
    dbName: params.config.db_name,
    user: params.config.user,
    stagingSchema: params.stagingSchema,
    stagingTable: params.stagingTable,
    cartoSchema: params.cartoSchema,
    targetTable: params.targetTable,
    provinceTable: params.provinceTable,
    localityTable: params.localityTable,
    typeTable: params.typeTable ?? null,
    addressMasterTable: params.addressMasterTable ?? null,
    localityType: params.options.localityType ?? null,
    tolerance: params.options.tolerance,
    geometryAreaThreshold: params.options.geometryAreaThreshold,
    updateGeometries: params.options.updateGeometries,
    linkAddressMaster: params.options.linkAddressMaster,
    pairChoices: canonicalChoicesOf(params.options.pairChoices),
    acceptedGeometries: canonicalAcceptsOf(params.options.acceptedGeometries ?? []),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

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

const isNumberField = (record: Record<string, unknown>, key: string): boolean => typeof record[key] === "number";

const isFiniteDateText = (value: unknown): boolean => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Guards a parsed plan file: a file that does not have the plan's shape cannot authorise a write. */
export function isPlanRecord(value: unknown): value is ActualizarPlanRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const fingerprint = record.dataFingerprint as Record<string, unknown> | undefined;
  const expected = record.expected as Record<string, unknown> | undefined;
  return (
    isPlanId(record.planId) &&
    typeof record.paramsFingerprint === "string" &&
    isFiniteDateText(record.createdAt) &&
    isFiniteDateText(record.expiresAt) &&
    typeof fingerprint === "object" &&
    fingerprint !== null &&
    typeof fingerprint.digest === "string" &&
    ["targetRows", "targetMaxId", "stagingCandidates"].every((key) => isNumberField(fingerprint, key)) &&
    typeof expected === "object" &&
    expected !== null &&
    ["inserted", "updates", "pairs"].every((key) => isNumberField(expected, key)) &&
    Array.isArray(record.pendingGeometryChanges)
  );
}
