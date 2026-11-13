import { describe, expect, it } from "vitest";
import { changedSummaryKeys, skippedRowsOf, toEjesLoadPlan, toLoadRenumberedRow, toSurplusRow } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import { buildEjesNextStep } from "@/modules/routine-jobs/jobs/ejes-calles/domain/nextStep";
import { EJES_STEP, plannedEjesStepLabels } from "@/modules/routine-jobs/jobs/ejes-calles/domain/plannedSteps";
import { EJES_SUMMARY_COUNT_KEYS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesAnalysis, EjesSummary } from "@/modules/routine-jobs/jobs/ejes-calles/types";

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
  it("should read the plan counts, with the masters created equal to the sections inserted", () => {
    const plan = toEjesLoadPlan({
      inserted: "3",
      updated: 2,
      renumbered: "1",
      ways: "2",
      points_moved: "9",
      idcalle: 1,
      type: "2",
      font: 0,
      geom: 1,
      surplus: "4",
    });

    expect(plan.counts).toEqual({ inserted: 3, updated: 2, renumbered: 1, waysCreated: 2, mastersCreated: 3, pointsMoved: 9 });
    expect(plan.attr).toEqual({ idcalle: 1, type: 2, font: 0, geom: 1 });
    expect(plan.surplusTotal).toBe(4);
  });

  it("should read an empty row as zeros", () => {
    const plan = toEjesLoadPlan({});

    expect(plan.counts).toEqual({ inserted: 0, updated: 0, renumbered: 0, waysCreated: 0, mastersCreated: 0, pointsMoved: 0 });
    expect(plan.surplusTotal).toBe(0);
  });

  it("should map surplus rows as text ref and id with numeric points", () => {
    expect(toSurplusRow({ ref: 12, id: 7, points: "5" })).toEqual({ ref: "12", id: "7", points: 5 });
  });

  it("should map renumbered rows as text refs and id with numeric points", () => {
    expect(toLoadRenumberedRow({ old_ref: 1, new_ref: 2, id: 3, points: "4" })).toEqual({ oldRef: "1", newRef: "2", id: "3", points: 4 });
  });

  it("should list splits, merges and plain removals as skipped, with their points", () => {
    const analysis = {
      splits: [{ oldRef: "1", idcalle: "9", newRefs: ["2", "3"], points: 5 }],
      merges: [{ newRef: "4", idcalle: "8", oldRefs: ["5", "6"], points: 7 }],
      plainRemovals: [{ ref: "7", idcalle: null, points: 0 }],
    } as unknown as EjesAnalysis;

    expect(skippedRowsOf(analysis)).toEqual([
      { kind: "split", refs: ["1"], idcalle: "9", points: 5 },
      { kind: "merge", refs: ["5", "6"], idcalle: "8", points: 7 },
      { kind: "removal", refs: ["7"], idcalle: null, points: 0 },
    ]);
  });

  it("should list nothing as skipped when there are no splits, merges or removals", () => {
    expect(skippedRowsOf({ splits: [], merges: [], plainRemovals: [] } as unknown as EjesAnalysis)).toEqual([]);
  });

  describe("changedSummaryKeys", () => {
    const counts = Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key, index) => [key, index]));
    const summary = (overrides: Record<string, number> = {}): EjesSummary => ({ counts: { ...counts, ...overrides } as EjesSummary["counts"] });

    it("should report no key when the summary equals the analysis counts", () => {
      expect(changedSummaryKeys(summary(), counts as unknown as EjesAnalysis["counts"])).toEqual([]);
    });

    it("should report the keys that differ", () => {
      expect(changedSummaryKeys(summary({ geom: 99, renumbered: 99 }), counts as unknown as EjesAnalysis["counts"])).toEqual(["geom", "renumbered"]);
    });

    it("should ignore analysis counts that are not part of the summary", () => {
      const analysis = { ...counts, twins: 50 } as unknown as EjesAnalysis["counts"];

      expect(changedSummaryKeys(summary(), analysis)).toEqual([]);
    });
  });
});
