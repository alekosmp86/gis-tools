import { describe, expect, it } from "vitest";
import {
  changedSummaryKeys,
  fingerprintChanged,
  summaryOf,
  toEjesLoadPlan,
  toLoadRenumberedRow,
  toSkipCount,
  toSkippedRow,
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

  it("should plan the 17 steps of the real run in order, the topology step after the removals and before the ANALYZE", () => {
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
      "Mover los puntos de acceso de las divisiones y reemplazos aceptados",
      "Quitar los tramos divididos o reemplazados, unidos y sin reemplazo aceptados",
      "Actualizar la topología y limpiar los vértices sin uso",
      "Analizar las tablas modificadas",
      "Confirmar la transacción",
    ]);
  });

  it("should lock before the checks, back up before the first write, analyze before the commit, and commit last", () => {
    const labels = plannedEjesStepLabels(false);

    expect(labels.indexOf(EJES_STEP.LOCK)).toBeLessThan(labels.indexOf(EJES_STEP.STAGING));
    expect(labels.indexOf(EJES_STEP.BACKUP)).toBeLessThan(labels.indexOf(EJES_STEP.WAYS));
    expect(labels.indexOf(EJES_STEP.WAYS)).toBeLessThan(labels.indexOf(EJES_STEP.SECTIONS));
    expect(labels.indexOf(EJES_STEP.REMOVE)).toBeLessThan(labels.indexOf(EJES_STEP.TOPOLOGY));
    expect(labels.indexOf(EJES_STEP.TOPOLOGY)).toBeLessThan(labels.indexOf(EJES_STEP.ANALYZE_TABLES));
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

    expect(plannedEjesStepLabels(false)).toHaveLength(17);
  });
});

describe("buildEjesNextStep (EJL-13, EJ-22)", () => {
  const step = buildEjesNextStep({ schema: "carto", table: "road_section" });

  it("should explain that an administrator refreshes the materialized views", () => {
    expect(step.text).toContain("Las vistas materializadas de ejes no se actualizan solas");
    expect(step.text).not.toContain("bdj_ejes");
  });

  it("should list the refresh statements in order: the road section view, then the two views that read it", () => {
    expect(step.statement.split("\n")).toEqual([
      'REFRESH MATERIALIZED VIEW "carto"."mv_road_section";',
      'REFRESH MATERIALIZED VIEW "carto"."mv_addresses_2_0";',
      'REFRESH MATERIALIZED VIEW "carto"."mv_direcciones_tlk_full_v2";',
    ]);
  });

  it("should follow the schema of the chosen road section table", () => {
    const other = buildEjesNextStep({ schema: "otro", table: "road_section" });

    expect(other.statement).toContain('"otro"."mv_road_section"');
    expect(other.statement).not.toContain("bdj_ejes");
  });
});

describe("load mapping (EJL-12, EJL-13)", () => {
  it("should read the plan counts of the load as numbers", () => {
    const plan = toEjesLoadPlan({
      inserted: "3",
      updated: 2,
      renumbered: "1",
      renumber_skipped: "5",
      removed: "2",
      twins_removed: "1",
      merged: "1",
      splits: "2",
      deleted: "4",
      masters_deleted: "3",
      ways: "2",
      points_moved: "9",
      idcalle: 1,
      type: "2",
      font: 0,
      geom: 1,
      surplus: "4",
    });

    expect(plan.counts).toEqual({
      inserted: 3,
      updated: 2,
      renumbered: 1,
      renumberSkipped: 5,
      removed: 2,
      twinsRemoved: 1,
      merged: 1,
      splitsApplied: 2,
      deleted: 4,
      waysCreated: 2,
      pointsMoved: 9,
      topologyAssigned: 0,
      verticesCreated: 0,
      verticesDeleted: 0,
    });
    expect(plan.deletedMasters).toBe(3);
    expect(plan.attr).toEqual({ idcalle: 1, type: 2, font: 0, geom: 1 });
    expect(plan.surplusTotal).toBe(4);
  });

  it("should map the renumber_skipped column of the load to renumberSkipped, the held pairs count (EJL-13)", () => {
    expect(toEjesLoadPlan({ renumber_skipped: "7" }).counts.renumberSkipped).toBe(7);
    expect(toEjesLoadPlan({ renumber_skipped: 0 }).counts.renumberSkipped).toBe(0);
  });

  it("should read an empty row as zeros", () => {
    const plan = toEjesLoadPlan({});

    expect(plan.counts).toEqual({
      inserted: 0,
      updated: 0,
      renumbered: 0,
      renumberSkipped: 0,
      removed: 0,
      twinsRemoved: 0,
      merged: 0,
      deleted: 0,
      splitsApplied: 0,
      waysCreated: 0,
      pointsMoved: 0,
      topologyAssigned: 0,
      verticesCreated: 0,
      verticesDeleted: 0,
    });
    expect(plan.deletedMasters).toBe(0);
    expect(plan.attr).toEqual({ idcalle: 0, type: 0, font: 0, geom: 0 });
    expect(plan.surplusTotal).toBe(0);
  });

  it("should map surplus rows as text ref and id with numeric points", () => {
    expect(toSurplusRow({ ref: 12, id: 7, points: "5" })).toEqual({ ref: "12", id: "7", points: 5 });
  });

  it("should map renumbered rows as text refs and id with numeric points", () => {
    expect(toLoadRenumberedRow({ old_ref: 1, new_ref: 2, id: 3, points: "4" })).toEqual({ oldRef: "1", newRef: "2", id: "3", points: 4 });
  });

  it("should map a skipped row with its refs, new refs, street, points and reason, as text and numbers", () => {
    expect(toSkippedRow({ kind: "merge", refs: "8001,8002", new_refs: "8003", idcalle: "4", points: "3", reason: "not_accepted" })).toEqual({
      kind: "merge",
      refs: ["8001", "8002"],
      newRefs: ["8003"],
      idcalle: "4",
      points: 3,
      reason: "not_accepted",
    });
  });

  it("should map an empty new refs text to an empty list, and a NULL street to null", () => {
    expect(toSkippedRow({ kind: "removal", refs: "7001", new_refs: "", idcalle: null, points: 0, reason: "has_points" })).toEqual({
      kind: "removal",
      refs: ["7001"],
      newRefs: [],
      idcalle: null,
      points: 0,
      reason: "has_points",
    });
  });

  it("should map a held renumber pair to its old and new refs and its reason (EJL-12, EJL-17)", () => {
    expect(
      toSkippedRow({ kind: "renumber", refs: "3001", new_refs: "3002", idcalle: "5", points: 4, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF })
    ).toMatchObject({ kind: "renumber", refs: ["3001"], newRefs: ["3002"], reason: RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF });
  });

  it("should map a reason count row to its reason and a numeric count", () => {
    expect(toSkipCount({ reason: "split_pending", count: "900" })).toEqual({ reason: "split_pending", count: 900 });
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
