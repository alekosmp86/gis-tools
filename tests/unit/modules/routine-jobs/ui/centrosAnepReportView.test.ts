import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CentrosResult } from "@/modules/routine-jobs/jobs/centros-anep/types";
import {
  buildCentrosAnepReportView,
  signedDifferenceOf,
  subsistemaTextOf,
} from "@/modules/routine-jobs/ui/centrosAnepReportView";
import { CENTROS_DRY_RUN_BANNER, CENTROS_NEXT_STEP_TEXT, CENTROS_NEXT_STEP_TITLE } from "@/modules/routine-jobs/ui/centrosAnepTexts";
import { CentrosAnepReport } from "@/modules/routine-jobs/ui/CentrosAnepReport";
import { CentrosAnepStagingNote } from "@/modules/routine-jobs/ui/steps/CentrosAnepStagingNote";
import { CENTROS_STAGING_NOTE, CENTROS_WFS_URL } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import { cleanStaging } from "../centros-anep/centrosFixtures";

const resultOf = (overrides: Partial<CentrosResult> = {}): CentrosResult => ({
  dryRun: true,
  targetModified: false,
  outcomeUnknown: false,
  staging: cleanStaging({ repeatedGroups: 2, repeatedRows: 4, repeatedRuee: [{ ruee: "1", rows: 2 }, { ruee: "2", rows: 2 }] }),
  comparison: {
    currentRows: 2800,
    afterRows: 2902,
    bySubsistema: [
      { value: "CEIP", current: 2200, after: 2269, difference: 69 },
      { value: null, current: 5, after: 0, difference: -5 },
    ],
  },
  blockers: [],
  privilegeInfo: [],
  columnInfo: [],
  copiedColumns: ["geom", "ruee"],
  finalSrid: 32721,
  deleted: 0,
  inserted: 0,
  warnings: [],
  tables: { "centros-anep-staging": "bdj_carto.ine_centros_anep", "centros-anep-final": "carto.ine_centros_anep" },
  stepTimings: [
    { label: "a", ms: 1500 },
    { label: "b", ms: 500 },
  ],
  ...overrides,
});

const kpiOf = (view: ReturnType<typeof buildCentrosAnepReportView>, label: string) =>
  view.kpis.find((kpi) => kpi.label === label)?.value;

describe("buildCentrosAnepReportView (CA-9, CA-14)", () => {
  it("should show the analysis banner, and no loaded kpis, for a dry run", () => {
    const view = buildCentrosAnepReportView(resultOf());

    expect(view.banners).toEqual([{ kind: "dryRun", text: CENTROS_DRY_RUN_BANNER }]);
    expect(CENTROS_DRY_RUN_BANNER).toBe("Análisis: no se modificó ninguna tabla.");
    expect(view.kpis.map((kpi) => kpi.label)).not.toContain("Filas insertadas en la tabla final");
  });

  it("should report the staging, current and after counts and the problem counts as kpis", () => {
    const view = buildCentrosAnepReportView(resultOf());

    expect(kpiOf(view, "Filas de staging")).toBe(2902);
    expect(kpiOf(view, "Filas ahora en la tabla final")).toBe(2800);
    expect(kpiOf(view, "Filas en la tabla final después del reemplazo")).toBe(2902);
    expect(kpiOf(view, "ruee repetidos (grupos)")).toBe(2);
    expect(kpiOf(view, "ruee repetidos (filas)")).toBe(4);
    expect(kpiOf(view, "Geometría nula o vacía")).toBe(0);
  });

  it("should carry the comparison rows, the repeated ruee and a summary of the list", () => {
    const view = buildCentrosAnepReportView(resultOf());

    expect(view.comparisonRows).toHaveLength(2);
    expect(view.repeatedRows).toHaveLength(2);
    expect(view.repeatedSummary).toBe("ruee repetidos (2)");
  });

  it("should say the list is cut when fewer ruee are listed than groups exist", () => {
    const view = buildCentrosAnepReportView(
      resultOf({ staging: cleanStaging({ repeatedGroups: 900, repeatedRows: 1800, repeatedRuee: [{ ruee: "1", rows: 2 }] }) })
    );

    expect(view.repeatedSummary).toBe("ruee repetidos (primeras 1 de 900)");
  });

  it("should show the done banner, the deleted and inserted kpis and the backup for a committed real run", () => {
    const backup = { token: "t", fileName: "centros-anep-revert-x.sql.gz", bytes: 10, rows: 2800 };
    const view = buildCentrosAnepReportView(resultOf({ dryRun: false, targetModified: true, deleted: 2800, inserted: 2902, backup }));

    expect(view.banners).toHaveLength(1);
    expect(view.banners[0].kind).toBe("done");
    expect(kpiOf(view, "Filas eliminadas de la tabla final")).toBe(2800);
    expect(kpiOf(view, "Filas insertadas en la tabla final")).toBe(2902);
    expect(view.backup).toEqual(backup);
  });

  it("should show the unknown banner and no done banner when the outcome is unknown", () => {
    const view = buildCentrosAnepReportView(resultOf({ dryRun: false, outcomeUnknown: true, targetModified: false }));

    expect(view.banners.map((banner) => banner.kind)).toEqual(["unknown"]);
  });

  it("should have no backup for a dry run and pass blockers, privileges, columns and warnings through", () => {
    const view = buildCentrosAnepReportView(
      resultOf({ blockers: ["b"], privilegeInfo: ["p"], columnInfo: ["c"], warnings: ["w"] })
    );

    expect(view.backup).toBeNull();
    expect([view.blockers, view.privilegeInfo, view.columnInfo, view.warnings]).toEqual([["b"], ["p"], ["c"], ["w"]]);
  });

  it("should convert the step timings to seconds and add them up", () => {
    const view = buildCentrosAnepReportView(resultOf());

    expect(view.timings).toEqual([
      { label: "a", seconds: 1.5 },
      { label: "b", seconds: 0.5 },
    ]);
    expect(view.totalSeconds).toBe(2);
  });

  it("should show an empty report for an empty comparison without throwing", () => {
    const view = buildCentrosAnepReportView(
      resultOf({ comparison: { currentRows: 0, afterRows: 0, bySubsistema: [] }, staging: cleanStaging({ rows: 0, bySubsistema: [] }), stepTimings: [] })
    );

    expect(view.comparisonRows).toEqual([]);
    expect(view.totalSeconds).toBe(0);
  });
});

describe("subsistemaTextOf and signedDifferenceOf", () => {
  it("should label a NULL subsistema as sin dato", () => {
    expect(subsistemaTextOf(null)).toBe("sin dato");
    expect(subsistemaTextOf("CES")).toBe("CES");
  });

  it("should sign positive differences only", () => {
    expect(signedDifferenceOf(5)).toBe("+5");
    expect(signedDifferenceOf(0)).toBe("0");
    expect(signedDifferenceOf(-3)).toBe("-3");
  });
});

describe("CentrosAnepReport markup (CA-9, CA-14)", () => {
  const render = (result: CentrosResult): string =>
    renderToStaticMarkup(React.createElement(CentrosAnepReport, { result }));

  it("should render the analysis banner and the counts per subsistema for a dry run", () => {
    const html = render(resultOf());

    expect(html).toContain(CENTROS_DRY_RUN_BANNER);
    expect(html).toContain("CEIP");
    expect(html).toContain("sin dato");
    expect(html).not.toContain(CENTROS_NEXT_STEP_TITLE);
  });

  it("should render the next suggested step for a committed real run (CA-14)", () => {
    const html = render(resultOf({ dryRun: false, targetModified: true, deleted: 1, inserted: 1 }));

    expect(html).toContain(CENTROS_NEXT_STEP_TITLE);
    expect(html).toContain("Siguiente paso sugerido");
    expect(html).toContain(CENTROS_NEXT_STEP_TEXT.slice(0, 30));
  });

  it("should render the warnings of the analysis in the result", () => {
    const html = render(resultOf({ dryRun: false, targetModified: true, warnings: ["3 ruee se repiten (6 filas)"] }));

    expect(html).toContain("3 ruee se repiten");
  });
});

describe("CentrosAnepStagingNote (CA-16)", () => {
  it("should show the note and the download URL as a link", () => {
    const html = renderToStaticMarkup(React.createElement(CentrosAnepStagingNote));

    expect(html).toContain(CENTROS_STAGING_NOTE);
    expect(html).toContain(`href="${CENTROS_WFS_URL.replace(/&/g, "&amp;")}"`);
  });
});
