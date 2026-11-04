import type { ActualizarPlanRecord } from "../types";

const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;

export const isPlanId = (value: unknown): value is string => typeof value === "string" && PLAN_ID_PATTERN.test(value);

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
