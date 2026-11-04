import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SKIP_REASON, type SkipReason } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronResult, SkippedLocalityGroup } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { ActualizarPadronReport } from "@/modules/routine-jobs/ui/ActualizarPadronReport";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { MonthlyStage } from "@/modules/routine-jobs/ui/monthlyCartoStages";
import { REPORT_CSV_KIND, reportCsvFilename } from "@/modules/routine-jobs/ui/reportCsv/filename";

const BUTTON_LABEL = "Descargar localidades no encontradas (CSV)";
const ALL_REASONS = Object.values(SKIP_REASON) as SkipReason[];

const zeroReasons = (): Record<SkipReason, number> =>
  Object.fromEntries(ALL_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;

const resultOf = (groups: SkippedLocalityGroup[]): ActualizarPadronResult => ({
  dryRun: true,
  targetModified: false,
  outcomeUnknown: false,
  totals: { rowsRead: 100, candidates: 90, repaired: 0, skipped: 10 },
  skipped: {
    byReason: { ...zeroReasons(), [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: 10 },
    byDepartment: [],
    byLocality: [],
    byLocalityAndReason: groups,
    samples: [],
    skippedRows: [],
    collidingKeys: [],
    collidingKeyCount: 0,
  },
  target: {
    table: "carto.padron",
    schema: "carto",
    inserted: 0,
    insertedList: [],
    updated: 0,
    updateApplied: false,
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
  },
  warnings: [],
  stepTimings: [],
});

const notFound = (overrides: Partial<SkippedLocalityGroup> = {}): SkippedLocalityGroup => ({
  department: "CANELONES",
  locality: "NUEVA HELVECIA",
  reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA,
  count: 7,
  otherDepartments: ["COLONIA"],
  ...overrides,
});

const ambiguous = (): SkippedLocalityGroup => ({
  department: "ROCHA",
  locality: "LA PALOMA",
  reason: SKIP_REASON.LOCALIDAD_AMBIGUA,
  count: 3,
});

const renderReport = (groups: SkippedLocalityGroup[]): string =>
  renderToStaticMarkup(
    React.createElement(ActualizarPadronReport, {
      result: resultOf(groups),
      pairChoices: { choices: [], submitted: [], canResimulate: false },
      geometryAccepts: { accepted: [], submitted: [] },
      mapBase: null,
    })
  );

describe("buildActualizarReportView locality rows (AP-119)", () => {
  it("should carry the other departments of a not found row", () => {
    const view = buildActualizarReportView(resultOf([notFound({ otherDepartments: ["COLONIA", "ROCHA"] })]));

    expect(view.localitiesNotFound).toEqual([
      { department: "CANELONES", locality: "NUEVA HELVECIA", count: 7, otherDepartments: ["COLONIA", "ROCHA"] },
    ]);
  });

  it("should default the other departments to an empty list when the group has none", () => {
    const view = buildActualizarReportView(resultOf([notFound({ otherDepartments: undefined }), ambiguous()]));

    expect(view.localitiesNotFound[0].otherDepartments).toEqual([]);
    expect(view.localitiesAmbiguous).toEqual([{ department: "ROCHA", locality: "LA PALOMA", count: 3, otherDepartments: [] }]);
  });
});

describe("reportCsvFilename localities not found kind (AP-120)", () => {
  it("should name the file with the localidades-no-encontradas segment before the timestamp", () => {
    const generatedAt = new Date(2026, 9, 28, 14, 5, 9);

    expect(reportCsvFilename(MonthlyStage.ACTUALIZAR_PADRON, true, generatedAt, REPORT_CSV_KIND.LOCALITIES_NOT_FOUND)).toBe(
      "carto-actualizar-padron-simulacion-localidades-no-encontradas-20261028-140509.csv"
    );
  });

  it("should give every report kind a distinct file name", () => {
    const generatedAt = new Date(2026, 0, 1, 0, 0, 0);

    const names = Object.values(REPORT_CSV_KIND).map((kind) => reportCsvFilename(MonthlyStage.ACTUALIZAR_PADRON, false, generatedAt, kind));

    expect(new Set(names).size).toBe(Object.values(REPORT_CSV_KIND).length);
  });
});

describe("ActualizarPadronReport localities not found download button (AP-120)", () => {
  it("should show the button once when the not found list has rows", () => {
    const html = renderReport([notFound()]);

    expect(html.split(BUTTON_LABEL)).toHaveLength(2);
  });

  it("should not show the button when only ambiguous localities exist", () => {
    const html = renderReport([ambiguous()]);

    expect(html).not.toContain(BUTTON_LABEL);
  });

  it("should not show the button when there are no locality groups", () => {
    const html = renderReport([]);

    expect(html).not.toContain(BUTTON_LABEL);
  });

  it("should not put the button on the ambiguous table when both tables exist", () => {
    const html = renderReport([notFound(), ambiguous()]);

    expect(html.split(BUTTON_LABEL)).toHaveLength(2);
    expect(html.indexOf(BUTTON_LABEL)).toBeLessThan(html.indexOf("LA PALOMA"));
  });
});
