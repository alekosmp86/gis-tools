import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JobReportStep, type JobReportTexts } from "@/modules/routine-jobs/ui/steps/JobReportStep";
import { UnidadReportStep } from "@/modules/routine-jobs/ui/steps/UnidadReportStep";
import { LocalidadesReportStep } from "@/modules/routine-jobs/ui/steps/LocalidadesReportStep";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import type { UnidadRunSnapshot } from "@/modules/routine-jobs/ui/unidadTerritorialRunStore";
import type { CargarLocalidadesRunSnapshot } from "@/modules/routine-jobs/ui/cargarLocalidadesRunStore";
import { buttonAttributes } from "./wizardFixtures";

const TEXTS: JobReportTexts = {
  idleHint: "IDLE-HINT",
  runningHint: "RUNNING-HINT",
  noReport: "NO-REPORT",
  notFinished: "NOT-FINISHED",
};
const BACK = "Volver a Revisar";
const NEW_RUN = "Nueva carga";

interface FakeResult {
  value: string;
}

type FakeSnapshot = { phase: RunPhase; job?: { result?: FakeResult } };

const renderReport = (result: FakeResult): React.ReactNode => React.createElement("p", null, `RESULT ${result.value}`);

function render(snapshot: FakeSnapshot, reporter: (result: FakeResult) => React.ReactNode = renderReport): string {
  return renderToStaticMarkup(
    React.createElement(JobReportStep<FakeResult>, {
      snapshot,
      texts: TEXTS,
      renderReport: reporter,
      onNewRun: vi.fn(),
      onBackToReview: vi.fn(),
    }),
  );
}

describe("JobReportStep phases", () => {
  it("should show the idle hint and no actions before any run", () => {
    const html = render({ phase: RunPhase.IDLE });

    expect(html).toContain("IDLE-HINT");
    expect(buttonAttributes(html, BACK)).toBeNull();
    expect(buttonAttributes(html, NEW_RUN)).toBeNull();
  });

  it.each([RunPhase.STARTING, RunPhase.RUNNING])("should show the running hint and no actions while %s", (phase) => {
    const html = render({ phase });

    expect(html).toContain("RUNNING-HINT");
    expect(buttonAttributes(html, BACK)).toBeNull();
  });

  it("should render the report of a finished run that carries a result, with both actions", () => {
    const reporter = vi.fn(renderReport);

    const html = render({ phase: RunPhase.DONE, job: { result: { value: "42" } } }, reporter);

    expect(reporter).toHaveBeenCalledWith({ value: "42" });
    expect(html).toContain("RESULT 42");
    expect(buttonAttributes(html, BACK)).not.toBeNull();
    expect(buttonAttributes(html, NEW_RUN)).not.toBeNull();
  });

  it("should show the no-report warning, not the reporter, when a finished run has no result", () => {
    const reporter = vi.fn(renderReport);

    const html = render({ phase: RunPhase.DONE, job: {} }, reporter);

    expect(reporter).not.toHaveBeenCalled();
    expect(html).toContain("NO-REPORT");
    expect(buttonAttributes(html, NEW_RUN)).not.toBeNull();
  });

  it.each([RunPhase.FAILED, RunPhase.UNKNOWN])("should show the not-finished warning and both actions when %s", (phase) => {
    const reporter = vi.fn(renderReport);

    const html = render({ phase }, reporter);

    expect(reporter).not.toHaveBeenCalled();
    expect(html).toContain("NOT-FINISHED");
    expect(buttonAttributes(html, BACK)).not.toBeNull();
    expect(buttonAttributes(html, NEW_RUN)).not.toBeNull();
  });
});

describe("stage report wrappers keep their own texts", () => {
  it("should show the unidad territorial idle and not-finished texts", () => {
    const idle = renderToStaticMarkup(React.createElement(UnidadReportStep, { snapshot: { phase: RunPhase.IDLE } as UnidadRunSnapshot, onNewRun: vi.fn(), onBackToReview: vi.fn() }));
    const failed = renderToStaticMarkup(React.createElement(UnidadReportStep, { snapshot: { phase: RunPhase.FAILED } as UnidadRunSnapshot, onNewRun: vi.fn(), onBackToReview: vi.fn() }));

    expect(idle).toContain("Todavía no hay un informe. Ejecute una actualización desde el paso Revisar.");
    expect(failed).toContain("La actualización no terminó correctamente, así que no hay informe. Revise el paso Ejecución.");
  });

  it("should show the cargar localidades not-finished text and its actions", () => {
    const failed = renderToStaticMarkup(
      React.createElement(LocalidadesReportStep, { snapshot: { phase: RunPhase.UNKNOWN } as CargarLocalidadesRunSnapshot, onNewRun: vi.fn(), onBackToReview: vi.fn() }),
    );

    expect(failed).toContain("La carga no terminó correctamente, así que no hay informe. Revise el paso Ejecución.");
    expect(buttonAttributes(failed, NEW_RUN)).not.toBeNull();
  });
});
