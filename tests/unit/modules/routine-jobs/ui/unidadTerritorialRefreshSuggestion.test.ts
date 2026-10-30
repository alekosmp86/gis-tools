import { describe, expect, it } from "vitest";
import type { AddressMasterReport } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkReport";
import { TERRITORIAL_UNIT_VIEW_NAME, UNIT_SKIP_REASON, type UnitSkipReason } from "@/modules/routine-jobs/jobs/unidad-territorial/constants";
import type { UnitResult, UnitTargetReport } from "@/modules/routine-jobs/jobs/unidad-territorial/types";
import { buildUnitReportView } from "@/modules/routine-jobs/ui/unidadTerritorialReportView";

const TARGET_SCHEMA = "carto";
const EXPECTED_STATEMENT = `REFRESH MATERIALIZED VIEW "carto"."${TERRITORIAL_UNIT_VIEW_NAME}";`;
const ZERO_SKIPS = Object.fromEntries(Object.values(UNIT_SKIP_REASON).map((reason) => [reason, 0])) as Record<UnitSkipReason, number>;

const TARGET: UnitTargetReport = {
  table: "carto.territorial_unit",
  inserted: 0,
  insertedList: [],
  updated: 0,
  updateApplied: true,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed: 0,
  fontDiffers: 0,
  missing: 0,
  missingSamples: [],
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
};

const resultOf = (overrides: Partial<UnitResult> = {}): UnitResult => ({
  dryRun: false,
  targetModified: false,
  outcomeUnknown: false,
  totals: { rowsRead: 0, candidates: 0, skipped: 0 },
  skipped: { ...ZERO_SKIPS, samples: [] },
  target: TARGET,
  warnings: [],
  stepTimings: [],
  ...overrides,
});

const addressMasterOf = (created: number, linked: number): AddressMasterReport => ({
  table: "carto.addresses_master",
  counts: { withoutAddressMaster: created + linked, created, linked, alreadyHadRecord: 0, ambiguous: 0, toCreate: created, remaining: 0 },
  linkedList: [],
  ambiguousSamples: [],
});

const CASES: ReadonlyArray<{ name: string; result: UnitResult; shown: boolean }> = [
  { name: "a real run that inserted units", result: resultOf({ targetModified: true, target: { ...TARGET, inserted: 2 } }), shown: true },
  { name: "a real run that updated units", result: resultOf({ targetModified: true, target: { ...TARGET, updated: 1 } }), shown: true },
  { name: "a real run that only created address masters", result: resultOf({ targetModified: true, addressMaster: addressMasterOf(1, 0) }), shown: true },
  { name: "a dry run that would insert units", result: resultOf({ dryRun: true, target: { ...TARGET, inserted: 2 } }), shown: false },
  { name: "a real run that changed nothing", result: resultOf({ targetModified: true }), shown: false },
  { name: "a run that wrote nothing and changed nothing", result: resultOf(), shown: false },
  { name: "an unknown commit outcome with inserted units", result: resultOf({ outcomeUnknown: true, target: { ...TARGET, inserted: 1 } }), shown: true },
];

describe("buildUnitReportView refresh suggestion (UT-18)", () => {
  it("should show the refresh statement only after a real or unknown-outcome run that changed units or address masters, never after a dry run or when nothing changed", () => {
    for (const { name, result, shown } of CASES) {
      const suggestion = buildUnitReportView(result, TARGET_SCHEMA).suggestion;

      expect(suggestion !== null, name).toBe(shown);
      if (shown) expect(suggestion?.statement, name).toBe(EXPECTED_STATEMENT);
    }
  });
});
