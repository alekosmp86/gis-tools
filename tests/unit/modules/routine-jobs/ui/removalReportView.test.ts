import { describe, expect, it } from "vitest";
import type { ActualizarTargetReport, PadronRemoved, RemovalSkippedReport } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { removalViewOf } from "@/modules/routine-jobs/ui/removalReportView";

const TABLE = "carto.padron_tmp_actualizacion";

const targetOf = (overrides: Partial<ActualizarTargetReport> = {}): ActualizarTargetReport => ({
  table: TABLE,
  schema: "carto",
  inserted: 0,
  insertedList: [],
  updated: 0,
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
  pairsTotal: 0,
  pairsApplied: 0,
  pairsLoose: 0,
  pairsPending: 0,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
  ...overrides,
});

const skippedOf = (stillPairable: number, nowReferenced: number, unverified: number): RemovalSkippedReport => ({
  total: stillPairable + nowReferenced + unverified,
  byReason: { STILL_PAIRABLE: stillPairable, NOW_REFERENCED: nowReferenced, UNVERIFIED: unverified },
});

const removedOf = (id: number): PadronRemoved => ({
  id,
  typePadron: "URBANO",
  provinceId: 1,
  department: "MONTEVIDEO",
  localityId: 10,
  locality: "CENTRO",
  number: String(id),
});

describe("removalViewOf (AP-108)", () => {
  describe("visibility", () => {
    it("should return null when nothing is removed, nothing is held back and the scan was not blocked", () => {
      const view = removalViewOf(targetOf({ removed: 0, removalsSkipped: skippedOf(0, 0, 0) }), true);

      expect(view).toBeNull();
    });

    it("should return null for an older result that lacks every removal field", () => {
      expect(removalViewOf(targetOf(), false)).toBeNull();
    });

    it("should show the section when only padrones are held back", () => {
      const view = removalViewOf(targetOf({ removed: 0, removalsSkipped: skippedOf(1, 0, 0) }), true);

      expect(view).not.toBeNull();
    });

    it("should show the section when only the scan was blocked, with the reason", () => {
      const reason = "No se encontraron tablas que referencien padrones: no se eliminan padrones faltantes.";

      const view = removalViewOf(targetOf({ removed: 0, removalBlockedReason: reason }), true);

      expect(view?.blockedReason).toBe(reason);
    });
  });

  describe("an analysis", () => {
    it("should headline the planned count with the no-references suffix and label the rows Se eliminará", () => {
      const view = removalViewOf(targetOf({ removed: 3, removedList: [removedOf(1), removedOf(2), removedOf(3)] }), true);

      expect(view?.headline).toBe("Padrones que se eliminarán: 3 (sin direcciones asociadas)");
      expect(view?.statusLabel).toBe("Se eliminará");
      expect(view?.rows).toHaveLength(3);
    });

    it("should word the held-back padrones with No se elimina, one row per reason that applies, in a fixed order", () => {
      const view = removalViewOf(targetOf({ removed: 1, removalsSkipped: skippedOf(2, 4, 3) }), true);

      expect(view?.notRemoved).toEqual([
        { label: "No se elimina: tiene direcciones asociadas", value: 4 },
        { label: "No se elimina: tiene un par sin resolver", value: 2 },
        { label: "No se elimina: no se pudieron verificar sus referencias", value: 3 },
      ]);
    });

    it("should leave out the reasons with a zero count", () => {
      const view = removalViewOf(targetOf({ removed: 1, removalsSkipped: skippedOf(0, 2, 0) }), true);

      expect(view?.notRemoved).toEqual([{ label: "No se elimina: tiene direcciones asociadas", value: 2 }]);
    });
  });

  describe("a real run", () => {
    it("should headline the deleted count and label the rows Eliminada", () => {
      const view = removalViewOf(targetOf({ removed: 2, removedList: [removedOf(1), removedOf(2)] }), false);

      expect(view?.headline).toBe("Padrones eliminados: 2 (sin direcciones asociadas)");
      expect(view?.statusLabel).toBe("Eliminada");
    });

    it("should word the held-back padrones with No eliminada", () => {
      const view = removalViewOf(targetOf({ removed: 0, removalsSkipped: skippedOf(1, 1, 1) }), false);

      expect(view?.notRemoved.map((row) => row.label)).toEqual([
        "No eliminada: tiene direcciones asociadas",
        "No eliminada: tiene un par sin resolver",
        "No eliminada: no se pudieron verificar sus referencias",
      ]);
    });

    it("should still show the held-back list when every padron was kept, with a zero headline", () => {
      const view = removalViewOf(targetOf({ removed: 0, removalsSkipped: skippedOf(0, 3, 0) }), false);

      expect(view?.headline).toBe("Padrones eliminados: 0 (sin direcciones asociadas)");
      expect(view?.rows).toEqual([]);
    });
  });

  describe("the list summary", () => {
    it("should read the plain count when the list shows every removed padron", () => {
      const view = removalViewOf(targetOf({ removed: 2, removedList: [removedOf(1), removedOf(2)] }), false);

      expect(view?.listSummary).toBe("Padrones eliminados (2)");
    });

    it("should read primeras N de M when the list was cut at DETAIL_LIST_LIMIT", () => {
      const list = Array.from({ length: DETAIL_LIST_LIMIT }, (_unused, index) => removedOf(index + 1));

      const view = removalViewOf(targetOf({ removed: DETAIL_LIST_LIMIT + 10, removedList: list }), false);

      expect(view?.listSummary).toBe(`Padrones eliminados (primeras ${DETAIL_LIST_LIMIT} de ${DETAIL_LIST_LIMIT + 10})`);
    });

    it("should read the plain count when the list holds exactly DETAIL_LIST_LIMIT padrones and no more were removed", () => {
      const list = Array.from({ length: DETAIL_LIST_LIMIT }, (_unused, index) => removedOf(index + 1));

      const view = removalViewOf(targetOf({ removed: DETAIL_LIST_LIMIT, removedList: list }), true);

      expect(view?.listSummary).toBe(`Padrones que se eliminarán (${DETAIL_LIST_LIMIT})`);
    });
  });
});
