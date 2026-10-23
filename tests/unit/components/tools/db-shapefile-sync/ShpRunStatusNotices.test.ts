import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ShpRunStatusNotices, type ShpRunStatusNoticesProps } from "@/components/tools/db-shapefile-sync/ShpRunStatusNotices";
import { ShpReplaceRunStatus } from "@/core/services/shpReplaceRunStore";
import { ShpReplacePhase } from "@/core/types/shpReplace";

const NOW = 1_000_000;

const BASE_PROPS: ShpRunStatusNoticesProps = {
  status: ShpReplaceRunStatus.IDLE,
  dryRun: false,
  uploadPct: 0,
  phase: null,
  detail: null,
  current: 0,
  total: 0,
  startedAt: NOW,
  error: null,
  outcomeUnknown: false,
  jobId: null,
};

const renderNotices = (overrides: Partial<ShpRunStatusNoticesProps> = {}): string =>
  renderToStaticMarkup(React.createElement(ShpRunStatusNotices, { ...BASE_PROPS, ...overrides }));

const REPLACE_UPLOADING = "Cerrar o recargar la pestaña mientras se sube el archivo cancela el reemplazo.";
const ANALYSIS_UPLOADING = "Cerrar o recargar la pestaña mientras se sube el archivo cancela el análisis.";
const REPLACE_RUNNING = "Cambiar de sección no detiene el reemplazo.";
const ANALYSIS_RUNNING = "Cambiar de sección no detiene el análisis.";
const REPLACE_UNMODIFIED = "La tabla destino no fue modificada: el reemplazo se ejecuta en una sola transacción";
const ANALYSIS_UNMODIFIED = "La tabla destino no fue modificada.";
const REPLACE_UNKNOWN = "Estado desconocido: el servidor puede seguir trabajando o haber confirmado el reemplazo.";
const ANALYSIS_UNKNOWN = "Estado desconocido: el servidor puede seguir analizando el archivo.";

describe("ShpRunStatusNotices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("UPLOADING", () => {
    it("should render the replace upload warning and the upload progress percentage for a real run", () => {
      const html = renderNotices({ status: ShpReplaceRunStatus.UPLOADING, dryRun: false, uploadPct: 42 });

      expect(html).toContain(REPLACE_UPLOADING);
      expect(html).toContain("Subiendo archivo");
      expect(html).toContain("42%");
    });

    it("should render the analysis upload warning for a dry run and not the replace wording", () => {
      const html = renderNotices({ status: ShpReplaceRunStatus.UPLOADING, dryRun: true, uploadPct: 10 });

      expect(html).toContain(ANALYSIS_UPLOADING);
      expect(html).not.toContain(REPLACE_UPLOADING);
    });
  });

  describe("RUNNING", () => {
    it("should render the replace running notice and the swap phase for a real run", () => {
      const html = renderNotices({
        status: ShpReplaceRunStatus.RUNNING,
        dryRun: false,
        phase: ShpReplacePhase.SWAPPING,
      });

      expect(html).toContain(REPLACE_RUNNING);
      expect(html).toContain("Reemplazando la tabla");
      expect(html).not.toContain(ANALYSIS_RUNNING);
    });

    it("should render the analysis running notice and the simulated swap phase for a dry run", () => {
      const html = renderNotices({
        status: ShpReplaceRunStatus.RUNNING,
        dryRun: true,
        phase: ShpReplacePhase.SWAPPING,
      });

      expect(html).toContain(ANALYSIS_RUNNING);
      expect(html).toContain("Simulando la carga en la tabla destino");
      expect(html).not.toContain(REPLACE_RUNNING);
    });
  });

  describe("FAILED", () => {
    it("should render the error and the unmodified-target warning for a failed real run with a known outcome", () => {
      const html = renderNotices({
        status: ShpReplaceRunStatus.FAILED,
        dryRun: false,
        error: "La columna destino no existe.",
        outcomeUnknown: false,
      });

      expect(html).toContain("La columna destino no existe.");
      expect(html).toContain(REPLACE_UNMODIFIED);
      expect(html).not.toContain("Estado desconocido");
    });

    it("should render the unknown-outcome warning with the job id for a failed real run whose outcome is unknown", () => {
      const html = renderNotices({
        status: ShpReplaceRunStatus.FAILED,
        dryRun: false,
        error: "Conexión perdida",
        outcomeUnknown: true,
        jobId: "job-123",
      });

      expect(html).toContain(REPLACE_UNKNOWN);
      expect(html).toContain("Trabajo: job-123.");
      expect(html).not.toContain(REPLACE_UNMODIFIED);
    });

    it("should render the unknown job id placeholder when the outcome is unknown and no job id exists", () => {
      const html = renderNotices({
        status: ShpReplaceRunStatus.FAILED,
        dryRun: false,
        outcomeUnknown: true,
        jobId: null,
      });

      expect(html).toContain("Trabajo: desconocido.");
    });

    it("should render the analysis unmodified warning for a failed dry run with a known outcome", () => {
      const html = renderNotices({ status: ShpReplaceRunStatus.FAILED, dryRun: true, error: "Fallo", outcomeUnknown: false });

      expect(html).toContain(ANALYSIS_UNMODIFIED);
      expect(html).not.toContain(REPLACE_UNMODIFIED);
      expect(html).not.toContain("Estado desconocido");
    });

    it("should render the analysis unknown-outcome warning for a failed dry run whose outcome is unknown", () => {
      const html = renderNotices({
        status: ShpReplaceRunStatus.FAILED,
        dryRun: true,
        outcomeUnknown: true,
        jobId: "job-9",
      });

      expect(html).toContain(ANALYSIS_UNKNOWN);
      expect(html).toContain("El análisis no modifica la tabla destino.");
      expect(html).toContain("Trabajo: job-9.");
    });

    it("should render the unmodified-target warning without an error alert when the failure carries no error text", () => {
      const html = renderNotices({ status: ShpReplaceRunStatus.FAILED, dryRun: false, error: null });

      expect(html).toContain(REPLACE_UNMODIFIED);
      expect(html).not.toContain("columna destino no existe");
    });
  });

  describe("no notice", () => {
    it.each([ShpReplaceRunStatus.IDLE, ShpReplaceRunStatus.DONE])(
      "should render nothing when the status is %s",
      (status) => {
        expect(renderNotices({ status })).toBe("");
      }
    );
  });
});
