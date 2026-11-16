import { describe, expect, it } from "vitest";
import {
  changedSummaryKeys,
  fingerprintChanged,
  skippedRowsOf,
  summaryOf,
  toEjesLoadPlan,
  toLoadRenumberedRow,
  toSurplusRow,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import { buildEjesNextStep } from "@/modules/routine-jobs/jobs/ejes-calles/domain/nextStep";
import { EJES_STEP, plannedEjesStepLabels } from "@/modules/routine-jobs/jobs/ejes-calles/domain/plannedSteps";
import { EJES_SUMMARY_COUNT_KEYS, RENUMBER_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesAnalysis, EjesFingerprint, EjesSummary } from "@/modules/routine-jobs/jobs/ejes-calles/types";

describe("plannedEjesStepLabels (EJL-2, EJL-4)", () => {
  it("should plan the four analysis steps for a dry run, which is the default", () => {
    expect(plannedEjesStepLabels()).toEqual([EJES_STEP.VALIDATE, EJES_STEP.PRIVILEGES, EJES_STEP.STAGING, EJES_STEP.ANALYZE]);
    expect(plannedEjesStepLabels(true)).toEqual(plannedEjesStepLabels());
  });

  it("should plan the 14 steps of the real run in order", () => {
    expect(plannedEjesStepLabels(false)).toEqual([
      "Validar tablas y columnas",
      "Comprobar privilegios",
      "Bloquear las tablas de destino",
      "Revisar los ejes de origen",
      "Clasificar los tramos y calcular cloc_iso",
      "Ajustar las secuencias",
      "Preparar los tramos a aplicar",
      "Generar el respaldo para revertir",
      "Insertar las vías nuevas",
      "Insertar los tramos nuevos y sus direcciones maestras",
      "Actualizar los tramos con cambios",
      "Aplicar los tramos renumerados y mover sus puntos de acceso",
      "Analizar las tablas modificadas",
      "Confirmar la transacción",
    ]);
  });

  it("should lock before the checks, back up before the first write, analyze before the commit, and commit last", () => {
    const labels = plannedEjesStepLabels(false);

    expect(labels.indexOf(EJES_STEP.LOCK)).toBeLessThan(labels.indexOf(EJES_STEP.STAGING));
    expect(labels.indexOf(EJES_STEP.BACKUP)).toBeLessThan(labels.indexOf(EJES_STEP.WAYS));
    expect(labels.indexOf(EJES_STEP.WAYS)).toBeLessThan(labels.indexOf(EJES_STEP.SECTIONS));
    expect(labels.indexOf(EJES_STEP.ANALYZE_TABLES)).toBeLessThan(labels.indexOf(EJES_STEP.COMMIT));
    expect(labels[labels.length - 1]).toBe(EJES_STEP.COMMIT);
  });

  it("should have unique labels so each timing is attributable", () => {
    const labels = plannedEjesStepLabels(false);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("should return a copy that callers cannot use to alter the plan", () => {
    const labels = plannedEjesStepLabels(false);
    labels.pop();

    expect(plannedEjesStepLabels(false)).toHaveLength(14);
  });
});

describe("buildEjesNextStep (EJL-13, EJ-22)", () => {
  const step = buildEjesNextStep({ schema: "carto", table: "road_section" }, { schema: "bdj_carto", table: "ide_ejesviacirculacion" });

  it("should explain that an administrator refreshes the materialized views", () => {
    expect(step.text).toContain("Las vistas materializadas de ejes no se actualizan solas");
    expect(step.text).toContain("bdj_ejes");
  });

  it("should list the refresh statements in order: staging view first, then the three carto views", () => {
    expect(step.statement.split("\n")).toEqual([
      'REFRESH MATERIALIZED VIEW "bdj_carto"."bdj_ejes";',
      'REFRESH MATERIALIZED VIEW "carto"."mv_road_section";',
      'REFRESH MATERIALIZED VIEW "carto"."mv_road_section2";',
      'REFRESH MATERIALIZED VIEW "carto"."mv_addresses_2_0";',
    ]);
  });

  it("should follow the schemas of the chosen tables", () => {
    const other = buildEjesNextStep({ schema: "otro", table: "road_section" }, { schema: "staging", table: "x" });

    expect(other.statement).toContain('"staging"."bdj_ejes"');
    expect(other.statement).toContain('"otro"."mv_road_section"');
  });
});

describe("load mapping (EJL-12, EJL-13)", () => {
  const analysisLists = (overrides: Record<string, unknown> = {}): EjesAnalysis =>
    ({ splits: [], merges: [], plainRemovals: [], renumberSkipped: [], ...overrides }) as unknown as EjesAnalysis;

  it("should read the plan counts of the load as numbers", () => {
    const plan = toEjesLoadPlan({
      inserted: "3",
      updated: 2,
      renumbered: "1",
      renumber_skipped: "5",
      ways: "2",
      points_moved: "9",
      idcalle: 1,
      type: "2",
      font: 0,
      geom: 1,
      surplus: "4",
    });

    expect(plan.counts).toEqual({ inserted: 3, updated: 2, renumbered: 1, renumberSkipped: 5, waysCreated: 2, pointsMoved: 9 });
    expect(plan.attr).toEqual({ idcalle: 1, type: 2, font: 0, geom: 1 });
    expect(plan.surplusTotal).toBe(4);
  });

  it("should map the renumber_skipped column of the load to renumberSkipped, the held pairs count (EJL-13)", () => {
    expect(toEjesLoadPlan({ renumber_skipped: "7" }).counts.renumberSkipped).toBe(7);
    expect(toEjesLoadPlan({ renumber_skipped: 0 }).counts.renumberSkipped).toBe(0);
  });

  it("should read an empty row as zeros", () => {
    const plan = toEjesLoadPlan({});

    expect(plan.counts).toEqual({ inserted: 0, updated: 0, renumbered: 0, renumberSkipped: 0, waysCreated: 0, pointsMoved: 0 });
    expect(plan.attr).toEqual({ idcalle: 0, type: 0, font: 0, geom: 0 });
    expect(plan.surplusTotal).toBe(0);
  });

  it("should map surplus rows as text ref and id with numeric points", () => {
    expect(toSurplusRow({ ref: 12, id: 7, points: "5" })).toEqual({ ref: "12", id: "7", points: 5 });
  });

  it("should map renumbered rows as text refs and id with numeric points", () => {
    expect(toLoadRenumberedRow({ old_ref: 1, new_ref: 2, id: 3, points: "4" })).toEqual({ oldRef: "1", newRef: "2", id: "3", points: 4 });
  });

  it("should list splits, merges and plain removals as skipped, with their points", () => {
    const analysis = analysisLists({
      splits: [{ oldRef: "1", idcalle: "9", newRefs: ["2", "3"], points: 5 }],
      merges: [{ newRef: "4", idcalle: "8", oldRefs: ["5", "6"], points: 7 }],
      plainRemovals: [{ ref: "7", idcalle: null, points: 0 }],
    });

    expect(skippedRowsOf(analysis)).toEqual([
      { kind: "split", refs: ["1"], idcalle: "9", points: 5 },
      { kind: "merge", refs: ["5", "6"], idcalle: "8", points: 7 },
      { kind: "removal", refs: ["7"], idcalle: null, points: 0 },
    ]);
  });

  it("should list a held renumber pair as one skipped row with both refs, its points and its reason (EJL-12, EJL-17)", () => {
    const analysis = analysisLists({
      renumberSkipped: [
        { oldRef: "3001", newRef: "3002", idcalle: "5", points: 4, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF },
      ],
    });

    expect(skippedRowsOf(analysis)).toEqual([
      {
        kind: "renumber",
        refs: ["3001", "3002"],
        idcalle: "5",
        points: 4,
        reason: RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF,
      },
    ]);
  });

  it("should keep the renumber rows after the splits, merges and removals, one row per held pair", () => {
    const analysis = analysisLists({
      splits: [{ oldRef: "1", idcalle: "9", newRefs: ["2", "3"], points: 5 }],
      plainRemovals: [{ ref: "7", idcalle: "4", points: 0 }],
      renumberSkipped: [
        { oldRef: "10", newRef: "11", idcalle: "5", points: 1, reason: RENUMBER_SKIP_REASON.REPEATED_OLD_REF },
        { oldRef: "12", newRef: "13", idcalle: "5", points: 2, reason: RENUMBER_SKIP_REASON.NOT_SINGLE_COPY },
      ],
    });

    expect(skippedRowsOf(analysis).map((row) => row.kind)).toEqual(["split", "removal", "renumber", "renumber"]);
    expect(skippedRowsOf(analysis)[3]).toMatchObject({ refs: ["12", "13"], reason: RENUMBER_SKIP_REASON.NOT_SINGLE_COPY });
  });

  it("should list nothing as skipped when there are no splits, merges, removals or held renumbers", () => {
    expect(skippedRowsOf(analysisLists())).toEqual([]);
  });

  describe("summaryOf (EJL-20, EJL-22)", () => {
    const fingerprint: EjesFingerprint = { rows: 7, digest: "abc123" };
    const counts = Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key, index) => [key, index + 1])) as unknown as EjesAnalysis["counts"];

    it("should carry the Revisar counts and the staging fingerprint of the analysis", () => {
      const summary = summaryOf({ counts, fingerprint } as unknown as EjesAnalysis);

      expect(summary.counts).toEqual(counts);
      expect(summary.fingerprint).toEqual(fingerprint);
    });

    it("should carry exactly the summary count keys, not the analysis-only counts", () => {
      const summary = summaryOf({ counts: { ...counts, twins: 50 }, fingerprint } as unknown as EjesAnalysis);

      expect(Object.keys(summary.counts).sort()).toEqual([...EJES_SUMMARY_COUNT_KEYS].sort());
      expect(summary.counts).not.toHaveProperty("twins");
    });

    it("should include renumberSkipped among the summary counts (EJL-1)", () => {
      expect(EJES_SUMMARY_COUNT_KEYS).toContain("renumberSkipped");
      expect(summaryOf({ counts, fingerprint } as unknown as EjesAnalysis).counts.renumberSkipped).toBe(counts.renumberSkipped);
    });
  });

  describe("changedSummaryKeys", () => {
    const counts = Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key, index) => [key, index]));
    const summary = (overrides: Record<string, number> = {}): EjesSummary => ({
      counts: { ...counts, ...overrides } as EjesSummary["counts"],
      fingerprint: { rows: 0, digest: "" },
    });

    it("should report no key when the summary equals the analysis counts", () => {
      expect(changedSummaryKeys(summary(), counts as unknown as EjesAnalysis["counts"])).toEqual([]);
    });

    it("should report the keys that differ", () => {
      expect(changedSummaryKeys(summary({ geom: 99, renumbered: 99 }), counts as unknown as EjesAnalysis["counts"])).toEqual([
        "geom",
        "renumbered",
      ]);
    });

    it("should report a renumberSkipped count that differs, with identical other counts (EJL-20)", () => {
      expect(changedSummaryKeys(summary({ renumberSkipped: 42 }), counts as unknown as EjesAnalysis["counts"])).toEqual([
        "renumberSkipped",
      ]);
    });

    it("should ignore analysis counts that are not part of the summary", () => {
      const analysis = { ...counts, twins: 50 } as unknown as EjesAnalysis["counts"];

      expect(changedSummaryKeys(summary(), analysis)).toEqual([]);
    });
  });

  describe("fingerprintChanged (EJL-20)", () => {
    const summaryWith = (fingerprint: EjesFingerprint): EjesSummary => ({
      counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key) => [key, 0])) as EjesSummary["counts"],
      fingerprint,
    });

    it("should report no change when the row count and the digest are the same", () => {
      expect(fingerprintChanged(summaryWith({ rows: 5, digest: "d1" }), { rows: 5, digest: "d1" })).toBe(false);
    });

    it("should report a change when only the row count differs", () => {
      expect(fingerprintChanged(summaryWith({ rows: 5, digest: "d1" }), { rows: 6, digest: "d1" })).toBe(true);
    });

    it("should report a change when only the digest differs, with the same row count (attributes or geometry edited)", () => {
      expect(fingerprintChanged(summaryWith({ rows: 5, digest: "d1" }), { rows: 5, digest: "d2" })).toBe(true);
    });

    it("should report a change when the digest is empty on one side only", () => {
      expect(fingerprintChanged(summaryWith({ rows: 0, digest: "" }), { rows: 0, digest: "d1" })).toBe(true);
    });
  });
});
