import { describe, expect, it } from "vitest";
import { buildRunWarnings, type WarningInput } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/warnings";
import type { ActualizarTargetReport } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

const TABLE = "carto.padron_tmp_actualizacion";
const LOOSE_ONE_WARNING = "1 padrón se actualiza por coincidencia parcial (superposición 85-98%); revisarlo en el listado de pares.";
const LOOSE_TWO_WARNING = "2 padrones se actualizan por coincidencia parcial (superposición 85-98%); revisarlos en el listado de pares.";
const CHOICE_ONE_WARNING = "1 elección de par no se aplicó (el padrón elegido ya no es candidato o sigue siendo ambiguo).";
const CHOICE_TWO_WARNING = "2 elecciones de par no se aplicaron (el padrón elegido ya no es candidato o sigue siendo ambiguo).";

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
  missingByClass: { REPLACED_ONE: 0, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: 0 },
  missingReview: [],
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
  geometryPending: 0,
  pairs: [],
  pairsTotal: pairsLoose,
  pairsApplied: pairsLoose,
  pairsLoose,
  pairsPending: 0,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
});

const inputOf = (pairsLoose: number): WarningInput => ({
  dryRun: false,
  options: { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, linkAddressMaster: false, pairChoices: [] },
  totals: { rowsRead: 0, candidates: 0, repaired: 0, skipped: 0 },
  target: targetOf(pairsLoose),
  collidingKeyCount: 0,
  localityWarnings: [],
  commitError: undefined,
});

const warningsOf = (pairsLoose: number): string[] => buildRunWarnings(inputOf(pairsLoose));

const choicesInputOf = (choicesUnapplied: number): WarningInput => {
  const input = inputOf(0);
  return { ...input, target: { ...input.target, choicesUnapplied } };
};

const GEOMETRY_ACCEPT_ONE_WARNING =
  "1 geometría aceptada no se aplicó (el padrón ya no tiene un cambio de geometría o Actualizar geometrías está desactivado).";
const GEOMETRY_ACCEPT_TWO_WARNING =
  "2 geometrías aceptadas no se aplicaron (el padrón ya no tiene un cambio de geometría o Actualizar geometrías está desactivado).";

const acceptsInputOf = (geometryAcceptsUnapplied: number | undefined): WarningInput => {
  const input = inputOf(0);
  return { ...input, target: { ...input.target, geometryAcceptsUnapplied } };
};

describe("buildRunWarnings accepted geometry warning (AP-100)", () => {
  it("should warn in Spanish with the singular form when one accepted geometry was not applied", () => {
    expect(buildRunWarnings(acceptsInputOf(1))).toEqual([GEOMETRY_ACCEPT_ONE_WARNING]);
  });

  it("should warn in Spanish with the plural form when several accepted geometries were not applied", () => {
    expect(buildRunWarnings(acceptsInputOf(2))).toEqual([GEOMETRY_ACCEPT_TWO_WARNING]);
  });

  it("should produce no accepted geometry warning when the count is zero or the result is older and lacks it", () => {
    expect(buildRunWarnings(acceptsInputOf(0))).toEqual([]);
    expect(buildRunWarnings(acceptsInputOf(undefined))).toEqual([]);
  });
});

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

  it("should warn in Spanish with the singular or plural form when pair choices were not applied and none when zero", () => {
    expect(buildRunWarnings(choicesInputOf(1))).toContain(CHOICE_ONE_WARNING);
    expect(buildRunWarnings(choicesInputOf(2))).toContain(CHOICE_TWO_WARNING);
    expect(buildRunWarnings(choicesInputOf(0))).toEqual([]);
  });
});
