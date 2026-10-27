import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildReportView } from "@/modules/routine-jobs/ui/cargarPadronesReportView";
import { ResultStep } from "@/modules/routine-jobs/ui/steps/ResultStep";
import { STEP } from "@/modules/routine-jobs/jobs/cargar-padrones/domain/plannedSteps";
import { buttonAttributes, jobOf, openingTags, resultOf, snapshotOf } from "./wizardFixtures";
import type { CargarPadronesRunPlan, CargarPadronesRunSnapshot } from "@/modules/routine-jobs/ui/cargarPadronesRunStore";

const START_MS = 1_000_000;
const ELAPSED_125_SECONDS = START_MS + 125_000;
const PLAN: CargarPadronesRunPlan = { dryRun: false, options: { repair: true, clearMode: "delete", resetSequences: false } };

function render(snapshot: CargarPadronesRunSnapshot, nowMs = ELAPSED_125_SECONDS): string {
  return renderToStaticMarkup(React.createElement(ResultStep, { snapshot, nowMs, onNewRun: vi.fn(), onBackToReview: vi.fn() }));
}

const listItemsOf = (html: string): string[] => html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];

const running = (overrides: Partial<CargarPadronesRunSnapshot> = {}): CargarPadronesRunSnapshot =>
  snapshotOf({
    phase: "running",
    jobId: "job-42",
    startedAt: START_MS,
    job: jobOf({ startedAt: START_MS }),
    ...overrides,
  });

describe("ResultStep", () => {
  describe("idle", () => {
    it("AC-32: should show a hint and no progress, report or error", () => {
      const html = render(snapshotOf({ phase: "idle" }));

      expect(html.trim().length).toBeGreaterThan(0);
      expect(html).not.toContain("<progress");
      expect(html).not.toContain("Filas leídas");
      expect(buttonAttributes(html, "Nueva carga")).toBeNull();
    });
  });

  describe("starting", () => {
    it("AC-32: should show a waiting label before the job id is known", () => {
      const html = render(snapshotOf({ phase: "starting", startedAt: START_MS }));

      expect(html).toContain("Iniciando la carga...");
      expect(html).not.toMatch(/NaN|undefined/);
    });
  });

  describe("running", () => {
    it("AC-32: should show the current step as a checked-off row in the planned checklist", () => {
      const html = render({ ...running(), plan: PLAN, job: jobOf({ step: STEP.LOAD_RURAL, current: 2, total: 5, startedAt: START_MS }) });
      const currentRow = listItemsOf(html).find((item) => item.includes("Cargar padrones rurales"));

      expect(html).toContain("Cargar padrones rurales");
      expect(currentRow, "current row").toBeDefined();
      expect(currentRow).toMatch(/checkItemCurrent/);
    });

    it("AC-32: should show the elapsed time computed from nowMs and the start instant", () => {
      const html = render(running());

      expect(html).toMatch(/2:05|2 min 05 s|2 min 5 s|125 s/);
    });

    it("AC-32: should show a different elapsed time for a later nowMs", () => {
      const short = render(running(), START_MS + 5_000);
      const long = render(running(), START_MS + 3_725_000);

      expect(long).not.toBe(short);
      expect(long).toMatch(/62 min|1:02:05|1 h/);
    });

    it("AC-32: should not print NaN or undefined when the job has no step, current or total yet", () => {
      const html = render(running({ job: jobOf({ step: null, current: undefined, total: undefined, startedAt: START_MS }) }));

      expect(html).not.toMatch(/NaN|undefined/);
    });

    it("AC-32: should not print NaN when the run has no start instant", () => {
      const html = render(running({ startedAt: undefined, job: undefined }));

      expect(html).not.toMatch(/NaN|undefined/);
    });

    it("AC-32: should not go negative when the clock is behind the start instant", () => {
      const html = render(running(), START_MS - 10_000);

      expect(html).not.toMatch(/NaN|-\d+ s/);
    });

    it("AC-32: should escape a step label that contains markup", () => {
      const html = render(running({ job: jobOf({ step: "<b>paso</b>", startedAt: START_MS }) }));

      expect(html).not.toContain("<b>paso</b>");
    });
  });

  describe("progress accessibility", () => {
    it("AC-32: should label the step checklist and not repeat its implicit role", () => {
      const html = render({ ...running(), plan: PLAN });
      const tag = openingTags(html, "ol")[0] ?? "";

      expect(tag).toMatch(/\saria-label="[^"]+"/);
      expect(tag).not.toContain("role=");
      expect(html).not.toContain('role="progressbar"');
    });

    it("AC-32: should label the checklist while the run is starting too", () => {
      const tag = openingTags(render({ ...snapshotOf({ phase: "starting", startedAt: START_MS }), plan: PLAN }), "ol")[0] ?? "";

      expect(tag).toMatch(/\saria-label="[^"]+"/);
      expect(tag).not.toContain("role=");
    });
  });

  describe("back to review", () => {
    const terminal: Array<[string, CargarPadronesRunSnapshot]> = [
      ["done", snapshotOf({ phase: "done", job: jobOf({ state: "DONE", result: resultOf() }) })],
      ["failed", snapshotOf({ phase: "failed", error: "Falló." })],
      ["unknown", snapshotOf({ phase: "unknown", jobId: "job-1" })],
    ];

    it.each(terminal)("AC-32: should offer Volver a Revisar next to Nueva carga when %s", (_name, snapshot) => {
      const html = render(snapshot);

      expect(buttonAttributes(html, "Volver a Revisar")).not.toBeNull();
      expect(buttonAttributes(html, "Nueva carga")).not.toBeNull();
    });

    it.each([
      ["idle", snapshotOf({ phase: "idle" })],
      ["starting", snapshotOf({ phase: "starting", startedAt: START_MS })],
      ["running", running()],
    ])("AC-32: should not offer Volver a Revisar while %s", (_name, snapshot) => {
      expect(buttonAttributes(render(snapshot), "Volver a Revisar")).toBeNull();
    });

    it("AC-32: should not call onBackToReview while rendering", () => {
      const onBackToReview = vi.fn();

      renderToStaticMarkup(
        React.createElement(ResultStep, {
          snapshot: snapshotOf({ phase: "failed", error: "x" }),
          nowMs: START_MS,
          onNewRun: vi.fn(),
          onBackToReview,
        }),
      );

      expect(onBackToReview).not.toHaveBeenCalled();
    });
  });

  describe("done", () => {
    it("AC-32: should show the report built from the job result, banner included", () => {
      const result = resultOf({ warnings: ["Hay 3 padrones sin geometría."] });
      const html = render(snapshotOf({ phase: "done", jobId: "job-42", job: jobOf({ state: "DONE", result }) }));

      expect(html).toContain(buildReportView(result).banner.text);
      expect(html).toContain("Filas leídas");
      expect(html).toContain("Hay 3 padrones sin geometría.");
      expect(html).not.toContain("<progress");
    });

    it("AC-32: should show the dry-run banner for a finished analysis", () => {
      const result = resultOf({ dryRun: true, targetModified: false });
      const html = render(snapshotOf({ phase: "done", job: jobOf({ state: "DONE", dryRun: true, result }) }));

      expect(html).toContain(buildReportView(result).banner.text);
    });

    it("AC-32: should not throw when a finished job carries no result", () => {
      const render_ = () => render(snapshotOf({ phase: "done", job: jobOf({ state: "DONE", result: undefined }) }));

      expect(render_).not.toThrow();
    });
  });

  describe("failed", () => {
    it("AC-32: should show the error and offer Nueva carga", () => {
      const html = render(snapshotOf({ phase: "failed", error: "Ya hay una carga en curso para esta tabla." }));

      expect(html).toContain("Ya hay una carga en curso para esta tabla.");
      expect(buttonAttributes(html, "Nueva carga")).not.toBeNull();
    });

    it("AC-32: should escape an error that contains markup", () => {
      const html = render(snapshotOf({ phase: "failed", error: "<script>x</script>" }));

      expect(html).not.toContain("<script>");
    });

    it("AC-32: should show a Spanish fallback when the failure has no message", () => {
      const html = render(snapshotOf({ phase: "failed", error: undefined }));

      expect(html).not.toMatch(/undefined|null/);
      expect(buttonAttributes(html, "Nueva carga")).not.toBeNull();
    });
  });

  describe("unknown outcome", () => {
    it("AC-32: should name the job id and tell the user to verify the destination table", () => {
      const html = render(snapshotOf({ phase: "unknown", jobId: "job-77", error: "No se pudo confirmar el resultado del trabajo job-77." }));

      expect(html).toContain("job-77");
      expect(html).toMatch(/tabla destino/i);
      expect(html).toMatch(/verific|revis/i);
    });

    it("AC-32: should still name the job id when the snapshot has no message", () => {
      const html = render(snapshotOf({ phase: "unknown", jobId: "job-88" }));

      expect(html).toContain("job-88");
      expect(html).toMatch(/tabla destino/i);
    });
  });

  describe("every phase", () => {
    const phases: CargarPadronesRunSnapshot[] = [
      snapshotOf({ phase: "idle" }),
      snapshotOf({ phase: "starting", startedAt: START_MS }),
      running(),
      snapshotOf({ phase: "done", job: jobOf({ state: "DONE", result: resultOf() }) }),
      snapshotOf({ phase: "failed", error: "Falló." }),
      snapshotOf({ phase: "unknown", jobId: "job-1" }),
    ];

    it("AC-32: should never render a password input or inline styles", () => {
      for (const snapshot of phases) {
        const html = render(snapshot);

        expect(openingTags(html, "input").some((tag) => tag.includes('type="password"')), snapshot.phase).toBe(false);
        expect(html, snapshot.phase).not.toMatch(/\sstyle=/);
      }
    });
  });
});
