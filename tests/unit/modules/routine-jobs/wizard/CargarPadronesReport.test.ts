import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AttributeConflictSample, CargarPadronesResult } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { buildReportView } from "@/modules/routine-jobs/ui/cargarPadronesReportView";
import { CargarPadronesReport } from "@/modules/routine-jobs/ui/CargarPadronesReport";
import { resultOf, typeReportOf } from "./wizardFixtures";

const render = (result: CargarPadronesResult): string =>
  renderToStaticMarkup(React.createElement(CargarPadronesReport, { result }));

const samples = (prefix: string, count: number): AttributeConflictSample[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    column: "nomdepto",
    values: ["Colonia", "COLONIA"],
  }));

/** The markup just before the banner text: wrapper and kind class, nothing else. */
const bannerPrefix = (html: string, text: string): string => {
  const index = html.indexOf(text);
  expect(index, text).toBeGreaterThanOrEqual(0);
  return html.slice(Math.max(0, index - 300), index);
};

describe("CargarPadronesReport", () => {
  describe("banner", () => {
    it("AC-31: should show the banner text of each of the four kinds", () => {
      const results: CargarPadronesResult[] = [
        resultOf({ outcomeUnknown: true }),
        resultOf({ dryRun: true, targetModified: false }),
        resultOf({ warnings: ["algo"] }),
        resultOf(),
      ];

      for (const result of results) {
        expect(render(result)).toContain(buildReportView(result).banner.text);
      }
    });

    it("AC-31: should give each banner kind its own class", () => {
      const results = [
        resultOf({ outcomeUnknown: true }),
        resultOf({ dryRun: true, targetModified: false }),
        resultOf({ warnings: ["algo"] }),
        resultOf(),
      ];

      const prefixes = results.map((result) => bannerPrefix(render(result), buildReportView(result).banner.text));

      expect(new Set(prefixes).size).toBe(4);
    });

    it("AC-31: should put the banner before the tables", () => {
      const result = resultOf();
      const html = render(result);

      expect(html.indexOf(buildReportView(result).banner.text)).toBeLessThan(html.indexOf("Filas leídas"));
    });
  });

  describe("per-type tables and totals", () => {
    it("AC-31: should show a Rural and an Urbano section", () => {
      const html = render(resultOf());

      expect(html).toContain("Rural");
      expect(html).toContain("Urbano");
    });

    it("AC-31: should show every row label and value of both types and of the totals", () => {
      const result = resultOf();
      const view = buildReportView(result);
      const html = render(result);

      for (const row of [...view.rural, ...view.urbano, ...view.totals]) {
        expect(html, row.label).toContain(row.label);
        expect(html, `${row.label} ${row.value}`).toContain(String(row.value));
      }
    });

    it("AC-31: should show the no-repair rows when geometries were inserted invalid", () => {
      const result = resultOf({
        report: {
          rural: typeReportOf(100, { insertedInvalid: 11, repairedInUnion: 12 }),
          urbano: typeReportOf(200),
        },
      });
      const html = render(result);

      expect(html).toContain("Insertadas inválidas");
      expect(html).toContain("Reparadas en la unión");
    });

    it("AC-31: should render zeros as zeros", () => {
      const zero = typeReportOf(0, {
        rowsRead: 0, groups: 0, rowsMerged: 0, repaired: 0, noGeometry: 0, nullKeyRows: 0, inserted: 0,
      });
      const html = render(resultOf({
        report: { rural: zero, urbano: zero },
        totals: { rowsRead: 0, groups: 0, rowsMerged: 0, inserted: 0 },
      }));

      expect(html).not.toMatch(/NaN|undefined/);
      expect(html).toContain("Filas leídas");
    });
  });

  describe("warnings", () => {
    it("AC-31: should list every warning under a heading", () => {
      const html = render(resultOf({ warnings: ["Primera advertencia.", "Segunda advertencia."] }));

      expect(html).toContain("Advertencias");
      expect(html).toContain("Primera advertencia.");
      expect(html).toContain("Segunda advertencia.");
    });

    it("AC-31: should show no warnings section when there are none", () => {
      expect(render(resultOf({ warnings: [] }))).not.toContain("Advertencias");
    });

    it("AC-31: should escape warning text that contains markup", () => {
      const html = render(resultOf({ warnings: ["<script>x</script>"] }));

      expect(html).not.toContain("<script>");
    });
  });

  describe("conflict samples", () => {
    it("AC-31: should show a sample with its key, column and values", () => {
      const html = render(resultOf({
        report: {
          rural: typeReportOf(100, { attributeConflicts: 1, attributeConflictSamples: samples("KR", 1) }),
          urbano: typeReportOf(200),
        },
      }));

      expect(html).toContain("KR-01");
      expect(html).toContain("nomdepto");
      expect(html).toContain("Colonia");
      expect(html).toContain("COLONIA");
      expect(html).not.toMatch(/y \d+ más/);
    });

    it("AC-31: should show at most 20 samples and say how many more conflicts exist", () => {
      const result = resultOf({
        report: {
          rural: typeReportOf(100, { attributeConflicts: 30, attributeConflictSamples: samples("KR", 15) }),
          urbano: typeReportOf(200, { attributeConflicts: 10, attributeConflictSamples: samples("KU", 15) }),
        },
      });
      const view = buildReportView(result);
      const html = render(result);

      const shownKeys = view.conflictSamples.map((sample) => sample.key);
      expect(shownKeys).toHaveLength(20);
      for (const key of shownKeys) expect(html, key).toContain(key);
      expect(html).not.toContain("KU-06");
      expect(html).toContain(`y ${view.moreConflicts} más`);
      expect(view.moreConflicts).toBe(20);
    });

    it("AC-31: should show no samples table when there are no conflicts", () => {
      const html = render(resultOf());

      expect(html).not.toMatch(/y \d+ más/);
      expect(html).not.toContain("nomdepto");
    });

    it("AC-31: should escape conflict values that contain markup", () => {
      const html = render(resultOf({
        report: {
          rural: typeReportOf(100, {
            attributeConflicts: 1,
            attributeConflictSamples: [{ key: "K", column: "c", values: ["<b>x</b>"] }],
          }),
          urbano: typeReportOf(200),
        },
      }));

      expect(html).not.toContain("<b>x</b>");
    });
  });

  describe("ambiguous locality codes", () => {
    it("AC-31: should list each code with its department, locality code and names", () => {
      const html = render(resultOf({
        ambiguousLocalityCodes: [{ coddepto: 7, codloccat: 1234, nomdepto: null, nomloccat: ["Paso Hondo", "Paso Fondo"] }],
      }));

      expect(html).toMatch(/ambigu/i);
      expect(html).toContain("1234");
      expect(html).toContain("Paso Hondo");
      expect(html).toContain("Paso Fondo");
    });

    it("AC-31: should render null codes without printing null", () => {
      const html = render(resultOf({
        ambiguousLocalityCodes: [{ coddepto: null, codloccat: null, nomdepto: null, nomloccat: ["Sin código"] }],
      }));

      expect(html).toContain("Sin código");
      expect(html).not.toMatch(/>null</);
    });

    it("AC-31: should show no ambiguous codes section when there are none", () => {
      expect(render(resultOf({ ambiguousLocalityCodes: [] }))).not.toMatch(/ambigu/i);
    });
  });

  describe("timings and analyze", () => {
    it("AC-31: should list each step timing and the total in seconds", () => {
      const html = render(resultOf());

      expect(html).toContain("Leer rurales");
      expect(html).toContain("Insertar destino");
      expect(html).toMatch(/1[.,]23/);
      expect(html).toMatch(/3[.,]23/);
    });

    it("AC-31: should render with no step timings", () => {
      const html = render(resultOf({ stepTimings: [] }));

      expect(html).not.toMatch(/NaN|undefined/);
    });

    it("AC-31: should show the analyze status label", () => {
      for (const status of ["ok", "failed", "skipped"] as const) {
        const result = resultOf({ analyze: { status } });

        expect(render(result), status).toContain(buildReportView(result).analyze.label);
      }
    });

    it("AC-31: should show the analyze failure message", () => {
      const html = render(resultOf({ analyze: { status: "failed", message: "permiso denegado para ANALYZE" } }));

      expect(html).toContain("permiso denegado para ANALYZE");
    });
  });

  it("AC-31: should not use inline styles", () => {
    const html = render(resultOf({
      warnings: ["a"],
      ambiguousLocalityCodes: [{ coddepto: 1, codloccat: 2, nomdepto: null, nomloccat: ["x"] }],
    }));

    expect(html).not.toMatch(/\sstyle=/);
  });
});
