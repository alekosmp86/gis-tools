import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ShpRunningProgress, type ShpRunningProgressProps } from "@/components/tools/db-shapefile-sync/ShpRunningProgress";
import styles from "@/components/tools/db-shapefile-sync/ShpRunningProgress.module.css";
import { ShpReplacePhase } from "@/core/types/shpReplace";

const NOW = 1_000_000;

const BASE_PROPS: ShpRunningProgressProps = {
  phase: ShpReplacePhase.PROCESSING,
  detail: null,
  current: 0,
  total: 0,
  startedAt: NOW,
  dryRun: false,
};

const renderProgress = (overrides: Partial<ShpRunningProgressProps> = {}): string =>
  renderToStaticMarkup(React.createElement(ShpRunningProgress, { ...BASE_PROPS, ...overrides }));

describe("ShpRunningProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("STAGING phase", () => {
    it("should render the percentage bar with the staging label and the rounded percentage", () => {
      const html = renderProgress({ phase: ShpReplacePhase.STAGING, current: 50, total: 200 });

      expect(html).toContain("Cargando registros");
      expect(html).toContain("25%");
    });

    it("should render no indeterminate bar during the staging phase", () => {
      const html = renderProgress({ phase: ShpReplacePhase.STAGING, current: 50, total: 200 });

      expect(html).not.toContain(styles.indeterminate);
    });

    it("should render zero percent and no elapsed timer when the staging total is zero", () => {
      const html = renderProgress({ phase: ShpReplacePhase.STAGING, current: 0, total: 0 });

      expect(html).toContain("0%");
      expect(html).not.toContain("Tiempo transcurrido");
    });

    it("should cap the staging percentage at one hundred when the current count exceeds the total", () => {
      const html = renderProgress({ phase: ShpReplacePhase.STAGING, current: 300, total: 200 });

      expect(html).toContain("100%");
      expect(html).not.toContain("150%");
    });
  });

  describe("non-staging phases", () => {
    it("should render the phase label, the step line, the elapsed label and the indeterminate bar", () => {
      const html = renderProgress({
        phase: ShpReplacePhase.PROCESSING,
        detail: "Reparando geometrías",
        current: 2,
        total: 5,
      });

      expect(html).toContain("Procesando geometrías");
      expect(html).toContain("Paso 2 de 5: Reparando geometrías");
      expect(html).toContain("Tiempo transcurrido: 00:00");
      expect(html).toContain(styles.indeterminate);
      expect(html).not.toContain("%");
    });

    it("should omit the step line when the detail is null", () => {
      const html = renderProgress({ phase: ShpReplacePhase.PROCESSING, detail: null, current: 2, total: 5 });

      expect(html).not.toContain("Paso ");
    });

    it("should omit the step line when the total is zero even if a detail is given", () => {
      const html = renderProgress({ phase: ShpReplacePhase.PROCESSING, detail: "Unificando", current: 0, total: 0 });

      expect(html).not.toContain("Paso ");
      expect(html).not.toContain("Unificando");
    });

    it("should render the starting label when no phase has been reported yet for a real run", () => {
      const html = renderProgress({ phase: null, dryRun: false });

      expect(html).toContain("Iniciando reemplazo");
    });

    it("should render the starting label for an analysis when no phase has been reported yet for a dry run", () => {
      const html = renderProgress({ phase: null, dryRun: true });

      expect(html).toContain("Iniciando análisis");
    });

    it("should render the simulated swap label for a dry run in the swap phase", () => {
      const html = renderProgress({ phase: ShpReplacePhase.SWAPPING, dryRun: true });

      expect(html).toContain("Simulando la carga en la tabla destino");
    });

    it("should render the elapsed time as minutes and seconds", () => {
      const html = renderProgress({ phase: ShpReplacePhase.FINALIZING, startedAt: NOW - 65_000 });

      expect(html).toContain("Tiempo transcurrido: 01:05");
    });
  });
});
