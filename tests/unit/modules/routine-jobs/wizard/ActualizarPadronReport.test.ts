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

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);

describe("ActualizarPadronReport", () => {
  it("AP-34: should render the first banner of the view", () => {
    const result = actualizarResultOf({ dryRun: true, tempModified: false });

    expect(render(result)).toContain(buildActualizarReportView(result).banners[0].text);
  });

  it("AP-34: should render the unknown-outcome banner with its verify advice", () => {
    const html = render(actualizarResultOf({ outcomeUnknown: true, tempModified: false }));

    expect(html).toMatch(/verific/i);
  });

  it("AP-32b: should render the label and count of every non-zero skip reason and collapse the zero ones", () => {
    const view = buildActualizarReportView(actualizarResultOf());
    const html = render(actualizarResultOf());

    for (const row of view.skippedRows) {
      expect(html, row.reason).toContain(row.label);
    }
    expect(html).toContain(`Sin filas: ${view.zeroReasonCount} motivos`);
    expect(html).toContain("15");
  });

  it("AP-32b: should render each shown reason with its one-line hint and a bar marker in 5 percent steps", () => {
    const view = buildActualizarReportView(actualizarResultOf());
    const html = render(actualizarResultOf());

    for (const row of view.skippedRows) {
      expect(html, row.reason).toContain(escapeHtml(row.hint));
    }
    expect(html).toContain(`data-bar-step="${view.skippedRows[0].barStep}"`);
  });

  it("AP-32b: should render the four KPI labels and values in order", () => {
    const view = buildActualizarReportView(actualizarResultOf());
    const html = render(actualizarResultOf());
    const positions = view.kpis.map((kpi) => html.indexOf(kpi.label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const kpi of view.kpis) {
      expect(html).toContain(String(kpi.value));
    }
  });

  it("AP-32b: should render the outcome banner before the KPI cards", () => {
    const result = actualizarResultOf({ dryRun: true, tempModified: false });
    const html = render(result);
    const bannerAt = html.indexOf(buildActualizarReportView(result).banners[0].text);

    expect(bannerAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(html.indexOf(buildActualizarReportView(result).kpis[0].label));
  });

  it("AP-32b: should render Ver todo with the rest count only when there are more than ten departments", () => {
    const groups = Array.from({ length: 25 }, (_, index) => ({ name: `G${index}`, count: 25 - index }));
    const many = render(actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, byDepartment: groups } }));
    const few = render(actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, byDepartment: groups.slice(0, 3) } }));

    expect(many).toContain("Ver todo (10)");
    expect(few).not.toContain("Ver todo");
  });

  it("AP-32b: should render the localities not found section only when that reason has locality groups", () => {
    const withGroups = render(
      actualizarResultOf({
        skipped: {
          ...actualizarResultOf().skipped,
          byLocalityAndReason: [{ department: "LA PAZ", locality: "VILLA NUEVA", reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, count: 7 }],
        },
      }),
    );

    expect(withGroups).toContain("Localidades no encontradas");
    expect(withGroups).toContain("VILLA NUEVA");
    expect(render(actualizarResultOf())).not.toContain("Localidades no encontradas");
  });

  it("AP-32b: should render the localities ambiguous section only when that reason has locality groups", () => {
    const withGroups = render(
      actualizarResultOf({
        skipped: {
          ...actualizarResultOf().skipped,
          byLocalityAndReason: [{ department: "ORURO", locality: "CENTRO", reason: SKIP_REASON.LOCALIDAD_AMBIGUA, count: 2 }],
        },
      }),
    );

    expect(withGroups).toContain("Localidades ambiguas");
    expect(withGroups).toContain("CENTRO");
    expect(render(actualizarResultOf())).not.toContain("Localidades ambiguas");
  });

  it("AP-32b: should put the samples and the step timings inside collapsible details", () => {
    const html = render(actualizarResultOf());

    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*?1234(?:(?!<\/details>)[\s\S])*?<\/details>/);
    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*?Cargar tabla de trabajo(?:(?!<\/details>)[\s\S])*?<\/details>/);
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

  it("AP-34: should render no progress element, no inline styles and no input", () => {
    const html = render(actualizarResultOf());

    expect(html).not.toContain("<progress");
    expect(html).not.toMatch(/\sstyle=/);
    expect(openingTags(html, "input")).toHaveLength(0);
  });
});
