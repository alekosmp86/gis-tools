import { describe, expect, it } from "vitest";
import { buildWarnings } from "@/modules/routine-jobs/jobs/cargar-localidades/domain/warnings";
import type { TargetReport } from "@/modules/routine-jobs/jobs/cargar-localidades/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";

const TABLE = "localidades_norte";
const TOTALS = { rowsRead: 0, groups: 0, repaired: 0, candidates: 0, skipped: 0 };
const TRUNCATION_WARNING = `Se listan las primeras ${DETAIL_LIST_LIMIT} geometrías que cambian en ${TABLE}.`;

const targetWithChanges = (changed: number): TargetReport => ({
  table: TABLE,
  inserted: 0,
  insertedList: [],
  updated: changed,
  updateApplied: true,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed,
  missing: 0,
  missingSamples: [],
  ambiguous: 0,
  ambiguousSamples: [],
  codeDiffers: 0,
  codeDiffersSamples: [],
  geometryChanges: [],
});

const warningsOf = (changed: number): string[] =>
  buildWarnings({ dryRun: false, updateGeometries: true, totals: TOTALS, targets: [targetWithChanges(changed)] });

describe("buildWarnings geometry change truncation", () => {
  it("should not warn when the geometry changes fit the list limit", () => {
    expect(warningsOf(DETAIL_LIST_LIMIT)).not.toContain(TRUNCATION_WARNING);
  });

  it("should warn with the list limit when the geometry changes exceed it", () => {
    expect(warningsOf(DETAIL_LIST_LIMIT + 1)).toContain(TRUNCATION_WARNING);
  });
});
