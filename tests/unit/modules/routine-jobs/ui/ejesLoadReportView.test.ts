import { describe, expect, it } from "vitest";
import { EJES_SKIP_REASON, RENUMBER_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesBackup, EjesLoadReport, EjesResult, EjesSkippedRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { buildEjesLoadView } from "@/modules/routine-jobs/ui/ejes-calles/ejesLoadReportView";
import {
  EJES_LOAD_COUNT_TEXT,
  EJES_LOAD_DONE_BANNER,
  EJES_LOAD_UNKNOWN_BANNER,
  EJES_SKIP_KIND_TEXT,
  RENUMBER_SKIP_TEXT,
  SKIP_REASON_TEXT,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesLoadTexts";

const loadOf = (overrides: Partial<EjesLoadReport> = {}): EjesLoadReport => ({
  counts: {
    inserted: 3,
    updated: 2,
    renumbered: 1,
    renumberSkipped: 0,
    removed: 0,
    merged: 0,
    deleted: 0,
    waysCreated: 4,
    pointsMoved: 9,
    topologyAssigned: 0,
    verticesCreated: 0,
    verticesDeleted: 0,
    splitsApplied: 0,
    twinsRemoved: 0,
  },
  surplus: [],
  surplusTotal: 0,
  renumbered: [],
  skipped: [],
  skippedTotal: 0,
  skippedByReason: [],
  ...overrides,
});

const resultOf = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({ dryRun: false, targetModified: true, outcomeUnknown: false, ...overrides }) as unknown as EjesResult;

const BACKUP: EjesBackup = {
  token: "tok-1",
  fileName: "ejes-revert-carto-road_section-20260101-100000-000.sql.gz",
  bytes: 2048,
  counts: { updated: 2, inserted: 3, ways: 4, masters: 3, pointsMoved: 9, deleted: 2 },
};

const skipped = (overrides: Partial<EjesSkippedRow>): EjesSkippedRow => ({
  kind: "split",
  refs: ["1"],
  newRefs: [],
  idcalle: "9",
  points: 0,
  ...overrides,
});

const countOf = (view: ReturnType<typeof buildEjesLoadView>, label: string): number | undefined =>
  view.counts.find((row) => row.label === label)?.value;

describe("buildEjesLoadView (EJL-13, EJ-24)", () => {
  describe("outcome banner", () => {
    it("should show the confirmed banner when the tables were modified and COMMIT succeeded", () => {
      const view = buildEjesLoadView(resultOf({ targetModified: true, outcomeUnknown: false }), loadOf());

      expect(view.banners).toEqual([{ kind: "done", text: EJES_LOAD_DONE_BANNER }]);
    });

    it("should show the COMMIT-not-confirmed banner when the outcome is unknown, and never the confirmed one", () => {
      const view = buildEjesLoadView(resultOf({ targetModified: false, outcomeUnknown: true, commitError: "fallo" }), loadOf());

      expect(view.banners).toEqual([{ kind: "unknown", text: EJES_LOAD_UNKNOWN_BANNER }]);
      expect(EJES_LOAD_UNKNOWN_BANNER).toContain("COMMIT");
    });

    it("should show the unknown banner, not the confirmed one, when both flags are set", () => {
      const view = buildEjesLoadView(resultOf({ targetModified: true, outcomeUnknown: true }), loadOf());

      expect(view.banners.map((banner) => banner.kind)).toEqual(["unknown"]);
    });

    it("should show no banner when the run was rolled back and nothing was modified", () => {
      const view = buildEjesLoadView(resultOf({ targetModified: false, outcomeUnknown: false }), loadOf());

      expect(view.banners).toEqual([]);
    });
  });

  describe("commit error", () => {
    it("should carry the commit error text when there is one", () => {
      const view = buildEjesLoadView(resultOf({ commitError: "terminó la conexión ***" }), loadOf());

      expect(view.commitError).toBe("terminó la conexión ***");
    });

    it("should be null when COMMIT did not fail", () => {
      expect(buildEjesLoadView(resultOf(), loadOf()).commitError).toBeNull();
    });
  });

  describe("applied counts", () => {
    it("should list inserted, updated, renumbered, renumbers held back, splits applied, merges applied, sections removed, sections deleted, ways created, points moved and the topology counts, in this order", () => {
      const view = buildEjesLoadView(
        resultOf(),
        loadOf({ counts: { ...loadOf().counts, merged: 2, removed: 5, deleted: 7, topologyAssigned: 4, verticesCreated: 6, verticesDeleted: 1 } })
      );

      expect(view.counts).toEqual([
        { label: "Tramos insertados", value: 3 },
        { label: "Tramos actualizados", value: 2 },
        { label: "Tramos renumerados", value: 1 },
        { label: "Renumerados retenidos", value: 0 },
        { label: "Divisiones y reemplazos aplicados", value: 0 },
        { label: "Uniones aplicadas", value: 2 },
        { label: "Tramos quitados", value: 5 },
        { label: "Gemelos quitados", value: 0 },
        { label: "Tramos borrados (divididos o reemplazados, unidos, gemelos y quitados)", value: 7 },
        { label: "Vías de circulación creadas", value: 4 },
        { label: "Puntos de acceso movidos", value: 9 },
        { label: EJES_LOAD_COUNT_TEXT.TOPOLOGY_ASSIGNED, value: 4 },
        { label: EJES_LOAD_COUNT_TEXT.VERTICES_CREATED, value: 6 },
        { label: EJES_LOAD_COUNT_TEXT.VERTICES_DELETED, value: 1 },
      ]);
    });

    it("should show the renumbers held back as the load's own renumberSkipped count", () => {
      const view = buildEjesLoadView(
        resultOf(),
        loadOf({
          counts: {
            inserted: 0,
            updated: 0,
            renumbered: 0,
            renumberSkipped: 7,
            removed: 0,
            merged: 0,
            deleted: 0,
            waysCreated: 0,
            pointsMoved: 0,
            topologyAssigned: 0,
            verticesCreated: 0,
            verticesDeleted: 0,
            splitsApplied: 0,
            twinsRemoved: 0,
          },
        })
      );

      expect(countOf(view, "Renumerados retenidos")).toBe(7);
    });

    it("should show zeros for a run that changed nothing", () => {
      const view = buildEjesLoadView(
        resultOf(),
        loadOf({
          counts: {
            inserted: 0,
            updated: 0,
            renumbered: 0,
            renumberSkipped: 0,
            removed: 0,
            merged: 0,
            deleted: 0,
            waysCreated: 0,
            pointsMoved: 0,
            topologyAssigned: 0,
            verticesCreated: 0,
            verticesDeleted: 0,
            splitsApplied: 0,
            twinsRemoved: 0,
          },
        })
      );

      expect(view.counts.map((row) => row.value)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("should show the sections deleted by the load (removed and merged) from counts.deleted", () => {
      const view = buildEjesLoadView(resultOf(), loadOf({ counts: { ...loadOf().counts, removed: 1, merged: 1, deleted: 3 } }));

      expect(countOf(view, "Tramos borrados (divididos o reemplazados, unidos, gemelos y quitados)")).toBe(3);
    });

    it("should show the applied merges and removed sections from the load counts", () => {
      const view = buildEjesLoadView(resultOf(), loadOf({ counts: { ...loadOf().counts, merged: 1, removed: 3 } }));

      expect(countOf(view, "Uniones aplicadas")).toBe(1);
      expect(countOf(view, "Tramos quitados")).toBe(3);
    });
  });

  describe("skipped list", () => {
    it.each([
      ["split", "Tramo dividido o reemplazado"],
      ["merge", "Tramos unidos"],
      ["removal", "Sin reemplazo"],
      ["renumber", "Renumeración no aplicada"],
    ] as const)("should label a %s row as %j", (kind, label) => {
      const [row] = buildEjesLoadView(resultOf(), loadOf({ skipped: [skipped({ kind })] })).skipped;

      expect(row.kind).toBe(label);
      expect(EJES_SKIP_KIND_TEXT[kind]).toBe(label);
    });

    it("should join every ref with a slash, so a renumber shows both refs", () => {
      const [row] = buildEjesLoadView(
        resultOf(),
        loadOf({ skipped: [skipped({ kind: "renumber", refs: ["3001", "3002"], reason: RENUMBER_SKIP_REASON.NOT_SINGLE_COPY })] })
      ).skipped;

      expect(row.refs).toBe("3001 / 3002");
    });

    it("should join the new refs of a split or merge with a slash, and leave them empty for a removal", () => {
      const view = buildEjesLoadView(
        resultOf(),
        loadOf({
          skipped: [
            skipped({ kind: "split", refs: ["6001"], newRefs: ["6002", "6003"], reason: EJES_SKIP_REASON.REVIEW_REQUIRED }),
            skipped({ kind: "removal", refs: ["7001"], newRefs: [], reason: EJES_SKIP_REASON.NOT_ACCEPTED }),
          ],
        })
      );

      expect(view.skipped.map((row) => row.newRefs)).toEqual(["6002 / 6003", ""]);
    });

    it("should show the street, or sin dato when the street is unknown, and the points as text", () => {
      const view = buildEjesLoadView(
        resultOf(),
        loadOf({ skipped: [skipped({ idcalle: "77", points: 4 }), skipped({ idcalle: null, points: 0 })] })
      );

      expect(view.skipped.map((row) => [row.idcalle, row.points])).toEqual([
        ["77", "4"],
        ["sin dato", "0"],
      ]);
    });

    it.each([
      [RENUMBER_SKIP_REASON.REPEATED_OLD_REF, "El reftramo actual aparece en más de un tramo"],
      [RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF, "El tramo actual tiene más de un candidato"],
      [RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF, "El reftramo nuevo tiene más de un candidato"],
      [RENUMBER_SKIP_REASON.NOT_SINGLE_COPY, "El reftramo nuevo no tiene exactamente una copia"],
    ])("should give the reason %s the text %j", (reason, text) => {
      const [row] = buildEjesLoadView(resultOf(), loadOf({ skipped: [skipped({ kind: "renumber", reason })] })).skipped;

      expect(row.reason).toBe(text);
      expect(RENUMBER_SKIP_TEXT[reason]).toBe(text);
    });

    it.each([
      [EJES_SKIP_REASON.NOT_ACCEPTED, "No aceptado en el análisis"],
      [EJES_SKIP_REASON.REVIEW_REQUIRED, "Puntos de acceso sin destino automático: requiere revisión"],
      [EJES_SKIP_REASON.HAS_POINTS, "Tiene puntos de acceso: no se quita"],
      [EJES_SKIP_REASON.NO_REFTRAMO, "Sin reftramo: no se puede verificar"],
      [EJES_SKIP_REASON.SHARED_OLD_REF, "Un tramo actual pertenece a otra unión aceptada"],
    ])("should give the split, merge or removal reason %s the text %j", (reason, text) => {
      const [row] = buildEjesLoadView(resultOf(), loadOf({ skipped: [skipped({ kind: "merge", reason })] })).skipped;

      expect(row.reason).toBe(text);
      expect(SKIP_REASON_TEXT[reason]).toBe(text);
    });

    it("should leave the reason empty for a row that carries none", () => {
      const view = buildEjesLoadView(resultOf(), loadOf({ skipped: [skipped({ kind: "split" }), skipped({ kind: "removal" })] }));

      expect(view.skipped.map((row) => row.reason)).toEqual(["", ""]);
    });

    it("should keep one row per skipped entry, keyed by its position and kind", () => {
      const view = buildEjesLoadView(resultOf(), loadOf({ skipped: [skipped({ kind: "split" }), skipped({ kind: "split" })] }));

      expect(view.skipped.map((row) => row.key)).toEqual(["0-split", "1-split"]);
    });

    it("should be empty when nothing was held back", () => {
      expect(buildEjesLoadView(resultOf(), loadOf()).skipped).toEqual([]);
    });

    it("should carry the total and the exact count per reason, with their Spanish labels", () => {
      const view = buildEjesLoadView(
        resultOf(),
        loadOf({
          skipped: [skipped({ kind: "split", reason: EJES_SKIP_REASON.REVIEW_REQUIRED })],
          skippedTotal: 1250,
          skippedByReason: [
            { reason: EJES_SKIP_REASON.REVIEW_REQUIRED, count: 900 },
            { reason: EJES_SKIP_REASON.NOT_ACCEPTED, count: 350 },
          ],
        })
      );

      expect(view.skippedTotal).toBe(1250);
      expect(view.skippedByReason).toEqual([
        { label: SKIP_REASON_TEXT[EJES_SKIP_REASON.REVIEW_REQUIRED], value: 900 },
        { label: SKIP_REASON_TEXT[EJES_SKIP_REASON.NOT_ACCEPTED], value: 350 },
      ]);
    });

    it("should list fewer rows than the total when the detail list is capped, and keep the total", () => {
      const listed = Array.from({ length: 3 }, () => skipped({ kind: "merge", reason: EJES_SKIP_REASON.NOT_ACCEPTED }));
      const view = buildEjesLoadView(resultOf(), loadOf({ skipped: listed, skippedTotal: 8, skippedByReason: [] }));

      expect(view.skipped).toHaveLength(3);
      expect(view.skippedTotal).toBe(8);
    });
  });

  describe("surplus", () => {
    it("should pass the surplus rows and their total through", () => {
      const view = buildEjesLoadView(resultOf(), loadOf({ surplus: [{ ref: "4001", id: "12", points: 4 }], surplusTotal: 700 }));

      expect(view.surplus).toEqual([{ ref: "4001", id: "12", points: 4 }]);
      expect(view.surplusTotal).toBe(700);
    });

    it("should carry a zero total when no section is surplus", () => {
      const view = buildEjesLoadView(resultOf(), loadOf());

      expect(view.surplus).toEqual([]);
      expect(view.surplusTotal).toBe(0);
    });
  });

  describe("revert backup", () => {
    it("should be null when the load wrote no backup", () => {
      expect(buildEjesLoadView(resultOf(), loadOf({ backup: undefined })).backup).toBeNull();
    });

    it("should pass the backup file through when the load wrote one, with the deleted count", () => {
      expect(buildEjesLoadView(resultOf(), loadOf({ backup: BACKUP })).backup).toEqual(BACKUP);
      expect(BACKUP.counts.deleted).toBe(2);
    });
  });

  describe("next step", () => {
    it("should be null when the result has no next step", () => {
      expect(buildEjesLoadView(resultOf(), loadOf()).nextStep).toBeNull();
    });

    it("should pass the suggested statement through when the result has one", () => {
      const nextStep = { text: "Las vistas materializadas de ejes no se actualizan solas.", statement: 'REFRESH MATERIALIZED VIEW "carto"."mv_road_section";' };

      expect(buildEjesLoadView(resultOf({ nextStep }), loadOf()).nextStep).toEqual(nextStep);
    });
  });
});
