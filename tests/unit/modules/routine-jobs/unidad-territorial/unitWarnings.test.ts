import { describe, expect, it } from "vitest";
import { buildUnitWarnings } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/warnings";
import type { UnitTargetReport } from "@/modules/routine-jobs/jobs/unidad-territorial/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";

const TABLE = "unidades_destino";
const TOTALS = { rowsRead: 0, candidates: 0, skipped: 0 };
const OPTIONS = { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true };
const TRUNCATION_WARNING = `Se listan las primeras ${DETAIL_LIST_LIMIT} geometrías que cambian en ${TABLE}.`;

const targetWithChanges = (changed: number): UnitTargetReport => ({
  table: TABLE,
  inserted: 0,
  insertedList: [],
  updated: changed,
  updateApplied: true,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed,
  fontDiffers: 0,
  missing: 0,
  missingSamples: [],
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
});

const warningsOf = (changed: number): string[] =>
  buildUnitWarnings({ dryRun: false, options: OPTIONS, totals: TOTALS, target: targetWithChanges(changed) });

describe("buildUnitWarnings geometry change truncation", () => {
  it("should not warn when the geometry changes fit the list limit", () => {
    expect(warningsOf(DETAIL_LIST_LIMIT)).not.toContain(TRUNCATION_WARNING);
  });

  it("should warn with the list limit when the geometry changes exceed it", () => {
    expect(warningsOf(DETAIL_LIST_LIMIT + 1)).toContain(TRUNCATION_WARNING);
  });
});
