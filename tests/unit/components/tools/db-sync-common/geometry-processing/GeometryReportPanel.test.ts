import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { GeometryReportPanel } from "@/components/tools/db-sync-common/geometry-processing/GeometryReportPanel";
import alertStyles from "@/ui-kit/components/AlertMessage.module.css";
import {
  DEFAULT_GEOMETRY_PROCESSING,
  EMPTY_GEOMETRY_REPORT,
  type GeometryProcessingReport,
} from "@/core/types/geometryProcessing";

const reportOf = (overrides: Partial<GeometryProcessingReport> = {}): GeometryProcessingReport => ({
  ...EMPTY_GEOMETRY_REPORT,
  ...overrides,
});

const renderPanel = (report: GeometryProcessingReport): string =>
  renderToStaticMarkup(
    React.createElement(GeometryReportPanel, { report, options: DEFAULT_GEOMETRY_PROCESSING })
  );

/** Text of every alert div rendered with the error variant class. */
const errorAlertTexts = (html: string): string[] =>
  html
    .split("<div")
    .slice(1)
    .filter((segment) => segment.slice(0, segment.indexOf(">")).includes(alertStyles.alertError))
    .map((segment) => /<span class="[^"]*">([^<]*)<\/span>/.exec(segment)?.[1] ?? "");

/** Visible text of the rendered markup: React comment separators and tags removed. */
const textOf = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");

const TIMED_REPORT = reportOf({
  stepTimings: [
    { label: "Convirtiendo geometrías", ms: 12345 },
    { label: "Revisando validez de geometrías", ms: 980 },
  ],
  processingMs: 13325,
});

describe("GeometryReportPanel", () => {
  describe("step timings section", () => {
    it("should render the 'Tiempos por paso' section when stepTimings is non-empty", () => {
      const text = textOf(renderPanel(TIMED_REPORT));

      expect(text).toContain("Tiempos por paso");
    });

    it("should list each step label before its formatted duration in plan order when stepTimings is non-empty", () => {
      const text = textOf(renderPanel(TIMED_REPORT));

      const convertAt = text.indexOf("Convirtiendo geometrías");
      const validityAt = text.indexOf("Revisando validez de geometrías");
      const firstDurationAt = text.indexOf("12,3 s");
      const secondDurationAt = text.indexOf("980 ms");
      expect(convertAt).toBeGreaterThan(-1);
      expect(validityAt).toBeGreaterThan(convertAt);
      expect(firstDurationAt).toBeGreaterThan(convertAt);
      expect(firstDurationAt).toBeLessThan(validityAt);
      expect(secondDurationAt).toBeGreaterThan(validityAt);
    });

    it("should render the total line with the formatted processingMs when stepTimings is non-empty", () => {
      const text = textOf(renderPanel(TIMED_REPORT));

      expect(text).toContain("Total del procesamiento: 13,3 s");
    });

    it("should omit the 'Tiempos por paso' section and the total line when stepTimings is empty", () => {
      const text = textOf(renderPanel(reportOf({ stepTimings: [], processingMs: 0 })));

      expect(text).not.toContain("Tiempos por paso");
      expect(text).not.toContain("Total del procesamiento");
    });
  });

  describe("incompatible multi-part geometry ERROR", () => {
    it("should render the plural ERROR naming the Punto label when a POINT target rejects multi-part geometries", () => {
      const html = renderPanel(reportOf({ incompatibleGeometryRows: 2, incompatibleTargetType: "Punto" }));

      expect(errorAlertTexts(html)).toEqual([
        "2 geometrías de varias partes no caben en la columna destino de tipo Punto",
      ]);
    });

    it("should render the singular ERROR naming the Polígono label when one POLYGON row is multi-part", () => {
      const html = renderPanel(reportOf({ incompatibleGeometryRows: 1, incompatibleTargetType: "Polígono" }));

      expect(errorAlertTexts(html)).toEqual([
        "1 geometría de varias partes no cabe en la columna destino de tipo Polígono",
      ]);
    });

    it("should render no incompatible-geometry ERROR when no row is incompatible", () => {
      const html = renderPanel(reportOf({ incompatibleGeometryRows: 0, incompatibleTargetType: null }));

      expect(errorAlertTexts(html)).toEqual([]);
    });
  });
});
