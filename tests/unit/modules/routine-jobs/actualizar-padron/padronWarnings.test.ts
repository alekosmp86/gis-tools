import { describe, expect, it } from "vitest";
import { buildRunWarnings, type WarningInput } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/warnings";
import type { ActualizarTargetReport } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

const TABLE = "carto.padron_tmp_actualizacion";
const LOOSE_ONE_WARNING = "1 padrón se actualiza por coincidencia parcial (superposición 85-98%); revisarlo en el listado de pares.";
const LOOSE_TWO_WARNING = "2 padrones se actualizan por coincidencia parcial (superposición 85-98%); revisarlos en el listado de pares.";

const targetOf = (pairsLoose: number): ActualizarTargetReport => ({
  table: TABLE,
  schema: "carto",
  inserted: 0,
  insertedList: [],
  updated: pairsLoose,
  updateApplied: true,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed: 0,
  missing: 0,
  missingSamples: [],
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
  pairs: [],
  pairsTotal: pairsLoose,
  pairsApplied: pairsLoose,
  pairsLoose,
  pairsNotApplied: 0,
});

const inputOf = (pairsLoose: number): WarningInput => ({
  dryRun: false,
  options: { tolerance: 1, updateGeometries: true, linkAddressMaster: false },
  totals: { rowsRead: 0, candidates: 0, repaired: 0, skipped: 0 },
  target: targetOf(pairsLoose),
  collidingKeyCount: 0,
  localityWarnings: [],
  commitError: undefined,
});

const warningsOf = (pairsLoose: number): string[] => buildRunWarnings(inputOf(pairsLoose));

describe("buildRunWarnings loose pair warning", () => {
  it("should warn in Spanish with the singular form when exactly one padron was applied by partial match", () => {
    expect(warningsOf(1)).toContain(LOOSE_ONE_WARNING);
  });

  it("should warn in Spanish with the plural form when several padrones were applied by partial match", () => {
    expect(warningsOf(2)).toContain(LOOSE_TWO_WARNING);
  });

  it("should produce no partial-match warning when no pair was applied loosely", () => {
    expect(warningsOf(0).some((warning) => warning.includes("coincidencia parcial"))).toBe(false);
  });

  it("should produce no warnings at all when the target has no pairs, ambiguous, missing or changed padrones", () => {
    expect(warningsOf(0)).toEqual([]);
  });
});
