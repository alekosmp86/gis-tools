import { describe, expect, it } from "vitest";
import { PAIR_STATUS, PAIR_TIER, REMOVAL_SKIP_REASON, REPLACEMENT_CLASS } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarTargetReport, MissingPadron, PadronPair } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { missingReviewViewOf, refsTextOf } from "@/modules/routine-jobs/ui/missingPadronView";

const missingPadronOf = (overrides: Partial<MissingPadron> = {}): MissingPadron => ({
  oldId: 500,
  typePadron: "URBANO",
  provinceId: 6,
  department: "Dpto Norte",
  locality: "Localidad Uno",
  number: "90",
  oldAreaM2: 10000,
  centroidLat: -34.9,
  centroidLon: -56.2,
  class: REPLACEMENT_CLASS.ORPHAN,
  coveredPct: 0,
  parts: [],
  refs: { total: 0, byTable: {} },
  removalReason: null,
  ...overrides,
});

const targetOf = (missingReview: MissingPadron[], pairs: PadronPair[] = []): ActualizarTargetReport => ({
  table: "carto.padron_tmp_actualizacion",
  schema: "carto",
  inserted: 0,
  insertedList: [],
  updated: 0,
  updateApplied: false,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed: 0,
  missing: missingReview.length,
  missingSamples: [],
  missingByClass: { REPLACED_ONE: 0, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: missingReview.length },
  missingReview,
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
  geometryPending: 0,
  pairs,
  pairsTotal: pairs.length,
  pairsApplied: 0,
  pairsLoose: 0,
  pairsPending: 0,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
});

const statusOf = (padron: MissingPadron): string => {
  const view = missingReviewViewOf(targetOf([padron]));
  return view?.rows[0].removalStatus ?? "";
};

describe("missing padron removal status (AP-101)", () => {
  it("should read Se eliminará for a padron with no removal reason, and flag it as removable", () => {
    const view = missingReviewViewOf(targetOf([missingPadronOf({ removalReason: null })]));

    expect(view?.rows[0].removalStatus).toBe("Se eliminará");
    expect(view?.rows[0].willBeRemoved).toBe(true);
  });

  it("should name the count and the tables for a padron that is still referenced", () => {
    const padron = missingPadronOf({
      removalReason: REMOVAL_SKIP_REASON.NOW_REFERENCED,
      refs: { total: 5, byTable: { "carto.access_point": 3, "carto.internal_address_point": 2 } },
    });

    expect(statusOf(padron)).toBe("No se elimina: tiene 5 direcciones asociadas (carto.access_point: 3; carto.internal_address_point: 2)");
  });

  it("should use the singular noun when exactly one reference holds the padron", () => {
    const padron = missingPadronOf({
      removalReason: REMOVAL_SKIP_REASON.NOW_REFERENCED,
      refs: { total: 1, byTable: { "carto.access_point": 1 } },
    });

    expect(statusOf(padron)).toBe("No se elimina: tiene 1 dirección asociada (carto.access_point: 1)");
  });

  it("should read an unresolved pair for a padron that is the old side of an open pair", () => {
    expect(statusOf(missingPadronOf({ removalReason: REMOVAL_SKIP_REASON.STILL_PAIRABLE }))).toBe("No se elimina: tiene un par sin resolver");
  });

  it("should read that the references could not be verified when the scan was blocked", () => {
    expect(statusOf(missingPadronOf({ removalReason: REMOVAL_SKIP_REASON.UNVERIFIED }))).toBe(
      "No se elimina: no se pudieron verificar sus referencias"
    );
  });

  it("should flag every padron with a reason as not removable", () => {
    for (const reason of Object.values(REMOVAL_SKIP_REASON)) {
      const view = missingReviewViewOf(targetOf([missingPadronOf({ removalReason: reason })]));

      expect(view?.rows[0].willBeRemoved, reason).toBe(false);
    }
  });

  it("should take the status from the server reason alone, not from the references, when the reason is STILL_PAIRABLE", () => {
    const padron = missingPadronOf({ removalReason: REMOVAL_SKIP_REASON.STILL_PAIRABLE, refs: { total: 4, byTable: { "carto.access_point": 4 } } });

    expect(statusOf(padron)).toBe("No se elimina: tiene un par sin resolver");
  });

  it("should return no section when the target has no missing padron", () => {
    expect(missingReviewViewOf(targetOf([]))).toBeNull();
  });

  it("should not list the old side of a pending pair, counting it in the awaiting note instead", () => {
    const pending: PadronPair = {
      status: PAIR_STATUS.NOT_APPLIED_PENDING,
      tier: PAIR_TIER.LOOSE,
      changes: [],
      oldId: 500,
      old: { typePadron: "URBANO", provinceId: 6, localityId: 1, number: "90", department: "D", locality: "L" },
      new: { typePadron: "URBANO", provinceId: 6, localityId: 1, number: "91", department: "D", locality: "L" },
      overlap: 0.9,
      areaRatio: 1,
      oldAreaM2: 100,
      newAreaM2: 100,
      areaChangePct: 0,
      centroidLat: -34.9,
      centroidLon: -56.2,
    };

    const view = missingReviewViewOf(targetOf([missingPadronOf({ oldId: 500 }), missingPadronOf({ oldId: 501 })], [pending]));

    expect(view?.rows.map((row) => row.oldId)).toEqual([501]);
    expect(view?.awaitingPairNote).toContain("1 faltante espera una decisión de par");
  });
});

describe("refsTextOf (AP-96)", () => {
  it("should read sin dato when the padron has no references or the refs are absent", () => {
    expect(refsTextOf({ total: 0, byTable: {} })).toBe("sin dato");
    expect(refsTextOf(undefined)).toBe("sin dato");
  });

  it("should name the referencing table with its count", () => {
    expect(refsTextOf({ total: 2, byTable: { "carto.a": 2 } })).toBe("carto.a: 2");
  });

  it("should name every referencing table, in order, with its count", () => {
    const text = refsTextOf({ total: 3, byTable: { "carto.a": 2, "carto.b": 1 } });

    expect(text.startsWith("carto.a: 2")).toBe(true);
    expect(text.endsWith("carto.b: 1")).toBe(true);
  });
});

describe("missing padron reassignment status (AP-115)", () => {
  it("should say how many addresses move to the parts for a subdivided padron that will be removed while still referenced", () => {
    const padron = missingPadronOf({
      class: REPLACEMENT_CLASS.SUBDIVIDED,
      removalReason: null,
      refs: { total: 7, byTable: { "carto.access_point": 7 } },
    });

    expect(statusOf(padron)).toBe("Se eliminará (7 direcciones pasan a sus partes)");
  });

  it("should use the singular form for exactly one address", () => {
    const padron = missingPadronOf({
      class: REPLACEMENT_CLASS.SUBDIVIDED,
      removalReason: null,
      refs: { total: 1, byTable: { "carto.access_point": 1 } },
    });

    expect(statusOf(padron)).toBe("Se eliminará (1 dirección pasa a sus partes)");
  });

  it("should keep the plain Se eliminará text when the padron has no references or the refs are absent", () => {
    expect(statusOf(missingPadronOf({ removalReason: null, refs: { total: 0, byTable: {} } }))).toBe("Se eliminará");
    expect(statusOf(missingPadronOf({ removalReason: null, refs: undefined as unknown as MissingPadron["refs"] }))).toBe("Se eliminará");
  });

  it("should still flag a reassigned subdivided padron as removable", () => {
    const padron = missingPadronOf({ class: REPLACEMENT_CLASS.SUBDIVIDED, removalReason: null, refs: { total: 2, byTable: { "carto.a": 2 } } });

    expect(missingReviewViewOf(targetOf([padron]))?.rows[0].willBeRemoved).toBe(true);
  });

  it("should name each table and its reason for a padron that is not reassignable", () => {
    const padron = missingPadronOf({
      class: REPLACEMENT_CLASS.SUBDIVIDED,
      removalReason: REMOVAL_SKIP_REASON.NOT_REASSIGNABLE,
      reassignBlockers: { "carto.a": "sin clave primaria de una sola columna", "carto.b": "tiene filas sin geometría" },
    });

    expect(statusOf(padron)).toBe(
      "No se elimina: no se pueden reasignar sus direcciones (carto.a: sin clave primaria de una sola columna; carto.b: tiene filas sin geometría)"
    );
    expect(missingReviewViewOf(targetOf([padron]))?.rows[0].willBeRemoved).toBe(false);
  });

  it("should read the generic not-reassignable text when no blocker is listed (an older result)", () => {
    expect(statusOf(missingPadronOf({ removalReason: REMOVAL_SKIP_REASON.NOT_REASSIGNABLE }))).toBe(
      "No se elimina: no se pueden reasignar sus direcciones"
    );
    expect(statusOf(missingPadronOf({ removalReason: REMOVAL_SKIP_REASON.NOT_REASSIGNABLE, reassignBlockers: {} }))).toBe(
      "No se elimina: no se pueden reasignar sus direcciones"
    );
  });
});
