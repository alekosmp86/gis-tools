import { describe, expect, it } from "vitest";
import { buildCompletarReportView } from "@/modules/routine-jobs/ui/completarUnidadTerritorialReportView";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/warnings";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import type { CompletarCounts, CompletarResult } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import { completarResultOf, linkedUnitOf } from "../completar-unidad-territorial/completarFixtures";

const SUGGESTION_TEXT_REAL =
  "Actualice la vista materializada para que refleje los cambios. Si no tiene permiso para hacerlo, pida a quien lo tenga que ejecute:";
const SUGGESTION_TEXT_DRY_RUN =
  "Después de cargar, actualice la vista materializada para que refleje los cambios. Si no tiene permiso para hacerlo, pida a quien lo tenga que ejecute:";
const STATEMENT = `REFRESH MATERIALIZED VIEW "carto"."mv_territorial_unit_full";`;
const COUNT_LABELS = [
  "Unidades sin dirección maestra",
  "Registros creados",
  "Unidades enlazadas",
  "Ya tenían registro",
  "Ambiguas",
];

const CLEAN_COUNTS: CompletarCounts = { withoutAddressMaster: 0, created: 0, linked: 0, alreadyHadRecord: 0, ambiguous: 0 };

const viewOf = (overrides: Partial<CompletarResult> = {}) => buildCompletarReportView(completarResultOf(overrides));

describe("buildCompletarReportView counts (CU-15)", () => {
  it("should list the five count rows in the documented order with their values", () => {
    const view = viewOf({ counts: { withoutAddressMaster: 5, created: 2, linked: 4, alreadyHadRecord: 2, ambiguous: 1 } });

    expect(view.counts.map((row) => row.label)).toEqual(COUNT_LABELS);
    expect(view.counts.map((row) => row.value)).toEqual([5, 2, 4, 2, 1]);
  });

  it("should show zero counts as rows with value 0 instead of hiding them", () => {
    const view = viewOf({ counts: CLEAN_COUNTS, linkedList: [], warnings: [] });

    expect(view.counts).toHaveLength(COUNT_LABELS.length);
    expect(view.counts.every((row) => row.value === 0)).toBe(true);
  });
});

describe("buildCompletarReportView refresh suggestion (CU-12)", () => {
  it("should show the suggestion with the real-run text and statement after a real run that linked units", () => {
    const view = viewOf({ dryRun: false, targetModified: true });

    expect(view.suggestion).toEqual({ text: SUGGESTION_TEXT_REAL, statement: STATEMENT });
  });

  it("should show the suggestion with the dry-run text on a dry run that would link units", () => {
    const view = viewOf({ dryRun: true, targetModified: false });

    expect(view.suggestion).toEqual({ text: SUGGESTION_TEXT_DRY_RUN, statement: STATEMENT });
  });

  it("should name the schema chosen for the unit table in the statement", () => {
    const view = viewOf({ unitSchema: "Mi Carto" });

    expect(view.suggestion?.statement).toBe(`REFRESH MATERIALIZED VIEW "Mi Carto"."mv_territorial_unit_full";`);
  });

  it("should hide the suggestion on a real run that linked no unit", () => {
    const view = viewOf({ counts: { ...CLEAN_COUNTS, withoutAddressMaster: 1, ambiguous: 1 }, linkedList: [] });

    expect(view.suggestion).toBeNull();
  });

  it("should hide the suggestion on a dry run that would link no unit", () => {
    const view = viewOf({ dryRun: true, targetModified: false, counts: CLEAN_COUNTS, linkedList: [] });

    expect(view.suggestion).toBeNull();
  });

  it("should hide the suggestion on a real run whose target was not modified", () => {
    const view = viewOf({ dryRun: false, targetModified: false });

    expect(view.suggestion).toBeNull();
  });

  it("should show the real-run suggestion when the commit outcome is unknown and units were linked", () => {
    const view = viewOf({ dryRun: false, targetModified: false, outcomeUnknown: true });

    expect(view.suggestion).toEqual({ text: SUGGESTION_TEXT_REAL, statement: STATEMENT });
  });

  it("should hide the suggestion when the commit outcome is unknown and no unit was linked", () => {
    const view = viewOf({
      dryRun: false,
      targetModified: false,
      outcomeUnknown: true,
      counts: CLEAN_COUNTS,
      linkedList: [],
    });

    expect(view.suggestion).toBeNull();
  });
});

describe("buildCompletarReportView banners", () => {
  it("should show the unknown banner first when the commit outcome is unknown", () => {
    const view = viewOf({ outcomeUnknown: true, targetModified: false });

    expect(view.banners[0].kind).toBe("unknown");
    expect(view.banners[0].text).toMatch(/verifique/i);
  });

  it("should show the dry-run banner on a dry run", () => {
    const view = viewOf({ dryRun: true, targetModified: false });

    expect(view.banners).toEqual([{ kind: "dryRun", text: DRY_RUN_WARNING }]);
  });

  it("should show the done banner after a real run that modified the tables", () => {
    const view = viewOf({ dryRun: false, targetModified: true });

    expect(view.banners.map((banner) => banner.kind)).toEqual(["done"]);
  });

  it("should show no banner on a real run that modified nothing and has no unknown outcome", () => {
    expect(viewOf({ dryRun: false, targetModified: false, outcomeUnknown: false }).banners).toEqual([]);
  });
});

describe("buildCompletarReportView lists and warnings (CU-15)", () => {
  it("should pass the linked units and the ambiguous samples through", () => {
    const sample = { id: 9, name: "Doble", provinceId: "09", records: 2 };
    const view = viewOf({ ambiguousSamples: [sample] });

    expect(view.linked).toEqual(completarResultOf().linkedList);
    expect(view.ambiguous).toEqual([sample]);
  });

  it("should keep the list at DETAIL_LIST_LIMIT and carry the truncation warning when more units were linked", () => {
    const listed = Array.from({ length: DETAIL_LIST_LIMIT }, (_, index) => linkedUnitOf({ id: index + 1, created: false }));
    const truncationWarning = `Se listan las primeras ${DETAIL_LIST_LIMIT} unidades enlazadas en carto.territorial_unit.`;

    const view = viewOf({
      linkedList: listed,
      counts: { ...CLEAN_COUNTS, withoutAddressMaster: 600, alreadyHadRecord: 600, linked: 600 },
      warnings: [truncationWarning],
    });

    expect(view.linked).toHaveLength(DETAIL_LIST_LIMIT);
    expect(view.warnings).toContain(truncationWarning);
  });

  it("should not repeat the dry-run and unknown-outcome warnings that the banners already show", () => {
    const view = viewOf({
      dryRun: true,
      targetModified: false,
      warnings: [DRY_RUN_WARNING, COMMIT_UNKNOWN_WARNING, "Hay una advertencia real."],
    });

    expect(view.warnings).toEqual(["Hay una advertencia real."]);
  });
});

describe("buildCompletarReportView timings", () => {
  it("should convert the step milliseconds to seconds and sum them into the total", () => {
    const view = viewOf({
      stepTimings: [
        { label: "Clasificar", ms: 1234 },
        { label: "Confirmar", ms: 500 },
      ],
    });

    expect(view.timings).toEqual([
      { label: "Clasificar", seconds: 1.234 },
      { label: "Confirmar", seconds: 0.5 },
    ]);
    expect(view.totalSeconds).toBeCloseTo(1.734, 10);
  });

  it("should return no timings and a zero total when no step was timed", () => {
    const view = viewOf({ stepTimings: [] });

    expect(view.timings).toEqual([]);
    expect(view.totalSeconds).toBe(0);
  });
});

describe("buildCompletarReportView purity", () => {
  it("should not mutate its input and return equal views for equal inputs", () => {
    const input = completarResultOf({ warnings: [DRY_RUN_WARNING, "x"], dryRun: true, targetModified: false });
    const before = JSON.stringify(input);

    const first = buildCompletarReportView(input);
    const second = buildCompletarReportView(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(second).toEqual(first);
  });
});
