import { describe, expect, it } from "vitest";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { SKIP_REASON, type SkipReason } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronResult, PadronPair } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

const TABLE = "carto.padron_tmp_actualizacion";
const ALL_REASONS = Object.values(SKIP_REASON) as SkipReason[];

const zeroReasons = (): Record<SkipReason, number> =>
  Object.fromEntries(ALL_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;

const resultOf = (overrides: Partial<ActualizarPadronResult> = {}): ActualizarPadronResult => ({
  dryRun: false,
  targetModified: true,
  outcomeUnknown: false,
  totals: { rowsRead: 1000, candidates: 940, repaired: 4, skipped: 60 },
  skipped: {
    byReason: {
      ...zeroReasons(),
      [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: 20,
      [SKIP_REASON.CLAVE_DUPLICADA]: 15,
      [SKIP_REASON.SIN_GEOMETRIA]: 10,
      [SKIP_REASON.CLAVE_NULA]: 5,
    },
    byDepartment: [],
    byLocality: [],
    byLocalityAndReason: [],
    samples: [],
    skippedRows: [],
    collidingKeys: [],
    collidingKeyCount: 0,
  },
  target: {
    table: TABLE,
    schema: "carto",
    inserted: 25,
    insertedList: [],
    updated: 24,
    updateApplied: true,
    unchanged: 6,
    unchangedWithinTolerance: 2,
    changed: 25,
    missing: 1,
    missingSamples: [],
    missingByClass: { REPLACED_ONE: 0, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: 0 },
    missingReview: [],
    ambiguous: 1,
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
  },
  warnings: [],
  stepTimings: [{ label: "Clasificar padrones", ms: 1234 }],
  ...overrides,
});

const bannerKindsOf = (result: ActualizarPadronResult): string[] =>
  buildActualizarReportView(result).banners.map((banner) => banner.kind);

describe("actualizarPadronReportView", () => {
  describe("KPI cards", () => {
    it("should map the six cards in order to the rows read, candidates, skipped, inserted, updated and changed counts", () => {
      const view = buildActualizarReportView(resultOf());

      expect(view.kpis).toEqual([
        { label: "Filas leídas", value: 1000 },
        { label: "Candidatas", value: 940 },
        { label: "Omitidas", value: 60 },
        { label: "Insertadas", value: 25 },
        { label: "Actualizadas", value: 24 },
        { label: "Geometrías que cambian", value: 25 },
      ]);
    });
  });

  describe("target counts", () => {
    it("should map each destination count to its row, with the unchanged rows as neutral", () => {
      const counts = buildActualizarReportView(resultOf()).target.counts;

      expect(counts.map((row) => [row.label, row.value])).toEqual([
        ["Insertadas", 25],
        ["Actualizadas", 24],
        ["Claves actualizadas", 0],
        ["Geometrías que cambian", 25],
        ["Geometrías pendientes", 0],
        ["Pares pendientes", 0],
        ["Sin cambios", 6],
        ["Sin cambios dentro de tolerancia", 2],
        ["Faltantes en destino", 1],
        ["Ambiguas", 1],
      ]);
    });
    it("should say that the geometry changes were not applied when Actualizar geometrías was off", () => {
      const view = buildActualizarReportView(
        resultOf({ target: { ...resultOf().target, updateApplied: false, updated: 0 } })
      );

      expect(view.target.notes).toEqual([`Las geometrías que cambian no se aplicaron en ${TABLE} (Actualizar geometrías desactivado).`]);
    });

    it("should label a cut list with the shown rows and the real count", () => {
      const view = buildActualizarReportView(resultOf());

      expect(view.target.insertedSummary).toBe("Padrones insertados (primeras 0 de 25)");
    });
  });

  describe("skipped rows", () => {
    it("should list only the reasons that skipped rows, largest first, with their whole-percent share", () => {
      const view = buildActualizarReportView(resultOf());

      expect(view.skippedRows.map((row) => [row.reason, row.value, row.percent])).toEqual([
        [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, 20, 40],
        [SKIP_REASON.CLAVE_DUPLICADA, 15, 30],
        [SKIP_REASON.SIN_GEOMETRIA, 10, 20],
        [SKIP_REASON.CLAVE_NULA, 5, 10],
      ]);
      expect(view.zeroReasonCount).toBe(ALL_REASONS.length - 4);
    });
  });

  describe("pair rows", () => {
    it("should map a pending LOOSE pair to its location, area, status and tier fields and carry no distance", () => {
      const pair: PadronPair = {
        status: "NOT_APPLIED_PENDING",
        tier: "LOOSE",
        changes: ["number"],
        oldId: 7,
        old: { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "500", department: "MONTEVIDEO", locality: "CENTRO" },
        new: { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "501", department: "MONTEVIDEO", locality: "CENTRO" },
        overlap: 0.93,
        areaRatio: 1.03,
        oldAreaM2: 9300,
        newAreaM2: 9579,
        areaChangePct: 103,
        centroidLat: -34.9011,
        centroidLon: -56.1645,
      };

      const view = buildActualizarReportView(resultOf({ target: { ...resultOf().target, pairs: [pair], pairsTotal: 1, pairsPending: 1 } }));

      expect(view.target.pairs).toEqual([
        {
          key: "7|URBANO|1|10|501",
          department: "MONTEVIDEO",
          locality: "CENTRO",
          type: "URBANO",
          number: "501",
          oldId: 7,
          oldType: "URBANO",
          oldLocality: "CENTRO",
          oldNumber: "500",
          oldAreaM2: 9300,
          newAreaM2: 9579,
          areaChangePct: 103,
          centroidLat: -34.9011,
          centroidLon: -56.1645,
          status: "Pendiente: coincidencia parcial",
          tier: "Parcial (coincidencia parcial)",
        },
      ]);
      expect(view.target.pairs[0]).not.toHaveProperty("distance");
    });
  });

  describe("banners", () => {
    it("should show only the done banner for a committed run", () => {
      expect(bannerKindsOf(resultOf())).toEqual(["done"]);
    });

    it("should show only the dry-run banner for an analysis", () => {
      expect(bannerKindsOf(resultOf({ dryRun: true }))).toEqual(["dryRun"]);
    });

    it("should show the unknown banner, asking to verify the destination, when the outcome is unknown", () => {
      const view = buildActualizarReportView(resultOf({ outcomeUnknown: true }));

      expect(view.banners).toEqual([expect.objectContaining({ kind: "unknown", text: expect.stringContaining("verificar") })]);
    });

    it("should add the warning banner when the run carries a visible warning", () => {
      expect(bannerKindsOf(resultOf({ warnings: ["Hay filas sin clave."] }))).toEqual(["done", "warning"]);
    });
  });
});
