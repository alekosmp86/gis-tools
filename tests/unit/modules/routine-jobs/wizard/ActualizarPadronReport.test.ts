import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActualizarPadronReport } from "@/modules/routine-jobs/ui/ActualizarPadronReport";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { SKIP_REASON } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronResult } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { openingTags } from "./wizardFixtures";
import { actualizarResultOf } from "./actualizarFixtures";

const render = (result: ActualizarPadronResult): string =>
  renderToStaticMarkup(React.createElement(ActualizarPadronReport, { result }));

describe("ActualizarPadronReport", () => {
  it("AP-34: should render the first banner of the view", () => {
    const result = actualizarResultOf({ dryRun: true, tempModified: false });

    expect(render(result)).toContain(buildActualizarReportView(result).banners[0].text);
  });

  it("AP-34: should render the unknown-outcome banner with its verify advice", () => {
    const html = render(actualizarResultOf({ outcomeUnknown: true, tempModified: false }));

    expect(html).toMatch(/verific/i);
  });

  it("AP-34: should render every skip reason label with its count", () => {
    const view = buildActualizarReportView(actualizarResultOf());
    const html = render(actualizarResultOf());

    for (const row of view.skippedByReason) {
      expect(html, row.reason).toContain(row.label);
    }
    expect(html).toContain("15");
  });

  it("AP-34: should render the samples with their department, locality and padron", () => {
    const html = render(actualizarResultOf());

    expect(html).toContain("LA PAZ");
    expect(html).toContain("VILLA");
    expect(html).toContain("1234");
  });

  it("AP-13: should render the colliding key with its row count", () => {
    const html = render(actualizarResultOf());

    expect(html).toContain("55");
  });

  it("AP-16: should render the warnings in order", () => {
    const html = render(actualizarResultOf({ warnings: ["Primera advertencia.", "Segunda advertencia."] }));

    expect(html.indexOf("Primera advertencia.")).toBeGreaterThan(-1);
    expect(html.indexOf("Primera advertencia.")).toBeLessThan(html.indexOf("Segunda advertencia."));
  });

  it("AP-16: should escape a warning that contains markup", () => {
    const html = render(actualizarResultOf({ warnings: ["<img src=x onerror=alert(1)>"] }));

    expect(html).not.toContain("<img");
  });

  it("AP-16: should render each step timing with its label", () => {
    const html = render(actualizarResultOf());

    expect(html).toContain("Cargar tabla de trabajo");
    expect(html).toContain("Analizar tabla de trabajo");
  });

  it("AP-34: should render the analysis label", () => {
    const view = buildActualizarReportView(actualizarResultOf({ analyze: { status: "failed", message: "sin permiso" } }));
    const html = render(actualizarResultOf({ analyze: { status: "failed", message: "sin permiso" } }));

    expect(html).toContain(view.analyze.label);
    expect(html).toContain("sin permiso");
  });

  it("AP-34: should never print NaN, undefined or null", () => {
    const html = render(
      actualizarResultOf({
        skipped: {
          ...actualizarResultOf().skipped,
          byDepartment: [{ name: null, count: 3 }],
          samples: [{ department: null, locality: null, padron: null, reason: SKIP_REASON.CLAVE_NULA }],
          collidingKeys: [{ typePadron: null, idProvince: null, idCadastralLocality: null, number: null, rows: 2 }],
        },
      }),
    );

    expect(html).not.toMatch(/NaN|undefined|>null</);
  });

  it("AP-34: should render no progress bar and no inline styles", () => {
    const html = render(actualizarResultOf());

    expect(html).not.toContain("<progress");
    expect(html).not.toMatch(/\sstyle=/);
    expect(openingTags(html, "input")).toHaveLength(0);
  });
});
