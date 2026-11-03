import { describe, expect, it } from "vitest";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { GEOMETRY_STATE, PAIR_STATUS, SKIP_REASON, type SkipReason } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronResult, MissingPadron, PadronGeometryChange, PadronPair } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

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
    it("should map the seven cards in order to the rows read, candidates, skipped, inserted, updated, changed and removed counts", () => {
      const view = buildActualizarReportView(resultOf());

      expect(view.kpis).toEqual([
        { label: "Filas leídas", value: 1000 },
        { label: "Candidatas", value: 940 },
        { label: "Omitidas", value: 60 },
        { label: "Insertadas", value: 25 },
        { label: "Actualizadas", value: 24 },
        { label: "Geometrías que cambian", value: 25 },
        { label: "Eliminadas", value: 0 },
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
        ["Eliminadas", 0],
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

  describe("refresh suggestion (AP-83, AP-106's removed count)", () => {
    const noChangesTarget = (overrides: Partial<ActualizarPadronResult["target"]> = {}) => ({
      ...resultOf().target,
      inserted: 0,
      updated: 0,
      pairsApplied: 0,
      ...overrides,
    });

    it("should show the suggestion for a committed run that only deleted padrones, with zero inserts, updates and pairs", () => {
      const view = buildActualizarReportView(resultOf({ target: noChangesTarget({ removed: 3 }) }));

      expect(view.suggestion).not.toBeNull();
    });

    it("should not show the suggestion, and not throw, when target.removed is undefined (an older result shape), with every other count zero", () => {
      const view = buildActualizarReportView(resultOf({ target: noChangesTarget({ removed: undefined }) }));

      expect(view.suggestion).toBeNull();
    });

    it("should not show the suggestion when removed is explicitly zero, with every other count zero", () => {
      const view = buildActualizarReportView(resultOf({ target: noChangesTarget({ removed: 0 }) }));

      expect(view.suggestion).toBeNull();
    });

    it("should not show the suggestion for a dry run, even when removed is greater than zero", () => {
      const view = buildActualizarReportView(resultOf({ dryRun: true, target: noChangesTarget({ removed: 3 }) }));

      expect(view.suggestion).toBeNull();
    });

    it("should show the suggestion for a run whose commit outcome is unknown, when removed is greater than zero", () => {
      const view = buildActualizarReportView(
        resultOf({ targetModified: false, outcomeUnknown: true, target: noChangesTarget({ removed: 3 }) })
      );

      expect(view.suggestion).not.toBeNull();
    });
  });

  describe("one list per case", () => {
    const keyOf = (number: string) => ({ typePadron: "URBANO", provinceId: 1, localityId: 10, number, department: "MONTEVIDEO", locality: "CENTRO" });
    const pairOf = (status: PadronPair["status"], oldId: number, number: string): PadronPair => ({
      status,
      tier: status === PAIR_STATUS.APPLIED ? "STRICT" : "LOOSE",
      changes: ["number"],
      oldId,
      old: keyOf(`old${oldId}`),
      new: keyOf(number),
      overlap: 0.9,
      areaRatio: 1,
      oldAreaM2: 100,
      newAreaM2: 100,
      areaChangePct: 0,
      centroidLat: -34.9,
      centroidLon: -56.1,
    });
    const geometryOf = (number: string, state: PadronGeometryChange["state"]): PadronGeometryChange => ({
      ...keyOf(number),
      oldId: Number(number),
      state,
      oldAreaM2: 100,
      newAreaM2: 120,
      areaChangePct: 20,
      centroidLat: -34.9,
      centroidLon: -56.1,
    });
    const missingOf = (oldId: number): MissingPadron => ({
      oldId,
      typePadron: "URBANO",
      provinceId: 1,
      department: "MONTEVIDEO",
      locality: "CENTRO",
      number: `old${oldId}`,
      oldAreaM2: 100,
      centroidLat: -34.9,
      centroidLon: -56.1,
      class: "ORPHAN",
      coveredPct: 0,
      parts: [],
      removalReason: null,
    });
    const mixedTarget = () => ({
      ...resultOf().target,
      pairs: [
        pairOf(PAIR_STATUS.APPLIED, 1, "10"),
        pairOf(PAIR_STATUS.NOT_APPLIED_PENDING, 2, "20"),
        pairOf(PAIR_STATUS.NOT_APPLIED_AMBIGUOUS, 3, "30"),
        pairOf(PAIR_STATUS.NOT_APPLIED_AMBIGUOUS, 4, "30"),
      ],
      pairsTotal: 4,
      pairsApplied: 1,
      pairsPending: 1,
      pairsNotApplied: 1,
      geometryChanges: [geometryOf("501", GEOMETRY_STATE.PENDING), geometryOf("502", GEOMETRY_STATE.APPLIED)],
      changed: 5,
      geometryPending: 3,
      missing: 6,
      missingReview: [1, 2, 3, 4, 5, 6].map(missingOf),
    });

    it("should expose no flat pairs table, only the pending rows and the ambiguous groups", () => {
      const target = buildActualizarReportView(resultOf({ target: mixedTarget() })).target;

      expect(target).not.toHaveProperty("pairsSummary");
      expect(target.pairRows.filter((row) => row.pending).map((row) => row.view.number)).toEqual(["20"]);
      expect(target.ambiguousGroups).toHaveLength(1);
      expect(target.ambiguousGroups[0].candidates.map((candidate) => candidate.oldId)).toEqual([3, 4]);
    });

    it("should count the applied geometries and summarise only the pending ones as primeras N de M pendientes", () => {
      const target = buildActualizarReportView(resultOf({ target: mixedTarget() })).target;

      expect(target.geometryAppliedCount).toBe(2);
      expect(target.geometryChangesSummary).toBe("Geometrías pendientes (primeras 1 de 3)");
    });

    it("should expose the pending geometry total of the report as geometryPending", () => {
      const target = buildActualizarReportView(resultOf({ target: mixedTarget() })).target;

      expect(target.geometryPending).toBe(3);
    });

    it("should count no applied geometries when Actualizar geometrías is off", () => {
      const target = buildActualizarReportView(resultOf({ target: { ...mixedTarget(), updateApplied: false } })).target;

      expect(target.geometryAppliedCount).toBe(0);
    });

    it("should leave out of the missing list the old side of a pending or ambiguous pair and say how many wait", () => {
      const review = buildActualizarReportView(resultOf({ target: mixedTarget() })).target.missingReview;

      expect(review?.rows.map((row) => row.oldId)).toEqual([1, 5, 6]);
      expect(review?.awaitingPairNote).toBe("3 faltantes esperan una decisión de par (ver pares pendientes y ambiguos)");
    });

    it("should say at least N when the pairs list is cut", () => {
      const review = buildActualizarReportView(resultOf({ target: { ...mixedTarget(), pairsTotal: 9 } })).target.missingReview;

      expect(review?.awaitingPairNote).toBe("Al menos 3 faltantes esperan una decisión de par (ver pares pendientes y ambiguos)");
    });

    it("should add no note when no missing padrón waits for a pair decision", () => {
      const target = { ...resultOf().target, missing: 1, missingReview: [missingOf(8)] };

      expect(buildActualizarReportView(resultOf({ target })).target.missingReview?.awaitingPairNote).toBeNull();
    });

    it("should keep the listed-of-total wording truthful when the server cut the missing list", () => {
      const target = { ...mixedTarget(), missing: 600 };

      const review = buildActualizarReportView(resultOf({ target })).target.missingReview;

      expect(review?.title).toBe("Padrones que ya no están en el catastro (primeras 3 de 597)");
    });

    it("should sum the whole picture in one line", () => {
      const target = buildActualizarReportView(resultOf({ target: mixedTarget() })).target;

      expect(target.reviewSummary).toBe(
        "Aplicados sin revisión: 1 claves actualizadas, 2 geometrías. Para revisar: 1 pares pendientes, 1 grupos ambiguos, 3 geometrías pendientes, 3 faltantes.",
      );
    });

    it("should say hasta N faltantes in the summary when the pairs list is cut", () => {
      const target = buildActualizarReportView(resultOf({ target: { ...mixedTarget(), pairsTotal: 9 } })).target;

      expect(target.reviewSummary).toContain("hasta 3 faltantes.");
    });
  });
});
