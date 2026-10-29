import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompletarReviewStep } from "@/modules/routine-jobs/ui/steps/CompletarReviewStep";
import { CompletarReportStep } from "@/modules/routine-jobs/ui/steps/CompletarReportStep";
import { CompletarSlot } from "@/modules/routine-jobs/ui/completarUnidadTerritorialWizardState";
import type { CompletarStartRequest } from "@/modules/routine-jobs/ui/clientTypes";
import type { CompletarRunSnapshot } from "@/modules/routine-jobs/ui/completarUnidadTerritorialRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { buttonAttributes, isDisabledAttributes, openingTags, withoutValueAttributes } from "./wizardFixtures";
import type { CompletarResult } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import { completarResultOf } from "../completar-unidad-territorial/completarFixtures";

const SECRET = "s3cr3t-completar-9";
const STATEMENT = `REFRESH MATERIALIZED VIEW "carto"."mv_territorial_unit_full";`;
const STATEMENT_HTML = STATEMENT.replace(/"/g, "&quot;");
const SUGGESTION_HEADING = "Siguiente paso sugerido";
const SUGGESTION_REAL = "Actualice la vista materializada para que refleje los cambios.";
const SUGGESTION_DRY_RUN = "Después de cargar, actualice la vista materializada para que refleje los cambios.";

const unitResultOf = (patch: Partial<CompletarResult>, overrides: Partial<CompletarResult> = {}) =>
  completarResultOf({ ...overrides, ...patch });

const requestOf = (overrides: Partial<CompletarStartRequest> = {}): CompletarStartRequest => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: SECRET },
  unitSchema: "carto",
  unitTable: "territorial_unit",
  addressMasterSchema: "carto",
  addressMasterTable: "addresses_master",
  dryRun: false,
  confirm: true,
  ...overrides,
});

function renderReview(overrides: Partial<React.ComponentProps<typeof CompletarReviewStep>> = {}): string {
  const props: React.ComponentProps<typeof CompletarReviewStep> = {
    request: requestOf(),
    confirmation: { password: "", typedTables: { [CompletarSlot.UNIT]: "", [CompletarSlot.ADDRESS_MASTER]: "" } },
    canDryRun: false,
    canRun: false,
    busy: false,
    runBlockedReason: null,
    onPasswordChange: vi.fn(),
    onTypedTableChange: vi.fn(),
    onDryRun: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(CompletarReviewStep, props));
}

const disabledOf = (html: string, label: string): boolean => {
  const attributes = buttonAttributes(html, label);
  if (attributes === null) throw new Error(`${label} button not found`);
  return isDisabledAttributes(attributes);
};

const snapshotOf = (overrides: Partial<CompletarRunSnapshot> = {}): CompletarRunSnapshot => ({
  phase: RunPhase.IDLE,
  ...overrides,
});

const doneSnapshot = (result: ReturnType<typeof completarResultOf>): CompletarRunSnapshot =>
  snapshotOf({
    phase: RunPhase.DONE,
    jobId: "job-9",
    job: { jobId: "job-9", state: "DONE", step: null, dryRun: result.dryRun, startedAt: 1, result },
  });

function renderReport(snapshot: CompletarRunSnapshot): string {
  return renderToStaticMarkup(
    React.createElement(CompletarReportStep, { snapshot, onNewRun: vi.fn(), onBackToReview: vi.fn() }),
  );
}

describe("CompletarReviewStep", () => {
  describe("summary", () => {
    it("should list both tables with their schemas", () => {
      const html = renderReview();

      expect(html).toContain("carto.territorial_unit");
      expect(html).toContain("carto.addresses_master");
    });

    it("should never print the database password", () => {
      const html = withoutValueAttributes(renderReview({ confirmation: { password: SECRET, typedTables: { [CompletarSlot.UNIT]: "", [CompletarSlot.ADDRESS_MASTER]: "" } } }));

      expect(html).not.toContain(SECRET);
    });
  });

  describe("confirmation fields", () => {
    it("should ask for the password as a single password field", () => {
      const passwordInputs = openingTags(renderReview(), "input").filter((tag) => tag.includes('type="password"'));

      expect(passwordInputs).toHaveLength(1);
    });

    it("should ask to type the unit table name and the address master table name again", () => {
      const html = renderReview();

      expect(html).toContain("Vuelva a escribir el nombre de la tabla de unidades territoriales");
      expect(html).toContain("Vuelva a escribir el nombre de la tabla de direcciones maestras");
    });

    it("should show the typed name of each table in its own field", () => {
      const html = renderReview({
        confirmation: {
          password: "",
          typedTables: { [CompletarSlot.UNIT]: "territorial_unit", [CompletarSlot.ADDRESS_MASTER]: "addresses_master" },
        },
      });

      expect(html).toContain('value="territorial_unit"');
      expect(html).toContain('value="addresses_master"');
    });
  });

  describe("buttons", () => {
    it("should enable the dry run only when it can run", () => {
      expect(disabledOf(renderReview({ canDryRun: true }), "Analizar sin cargar")).toBe(false);
      expect(disabledOf(renderReview({ canDryRun: false }), "Analizar sin cargar")).toBe(true);
    });

    it("should enable the real run only when it is confirmed", () => {
      expect(disabledOf(renderReview({ canRun: true }), "Completar unidades territoriales")).toBe(false);
      expect(disabledOf(renderReview({ canRun: false }), "Completar unidades territoriales")).toBe(true);
    });

    it("should disable both runs while a job is busy and say so", () => {
      const html = renderReview({ canDryRun: true, canRun: true, busy: true });

      expect(disabledOf(html, "Analizar sin cargar")).toBe(true);
      expect(disabledOf(html, "Completar unidades territoriales")).toBe(true);
      expect(html).toContain("Hay un proceso de direcciones maestras en curso.");
    });

    it("should disable both runs and show the reason when the wizard blocks the run", () => {
      const html = renderReview({ canDryRun: true, canRun: true, runBlockedReason: "Alguna tabla tiene columnas faltantes o ambiguas." });

      expect(disabledOf(html, "Analizar sin cargar")).toBe(true);
      expect(disabledOf(html, "Completar unidades territoriales")).toBe(true);
      expect(html).toContain("Alguna tabla tiene columnas faltantes o ambiguas.");
    });

    it("should use no inline styles", () => {
      expect(renderReview()).not.toMatch(/\sstyle=/);
    });
  });
});

describe("CompletarReportStep", () => {
  it("should show a hint and no report while no run exists", () => {
    const html = renderReport(snapshotOf({ phase: RunPhase.IDLE }));

    expect(html).toContain("Todavía no hay un informe.");
    expect(html).not.toContain(SUGGESTION_HEADING);
  });

  it("should show the running hint while the run is in progress", () => {
    expect(renderReport(snapshotOf({ phase: RunPhase.RUNNING }))).toContain("El proceso sigue en curso.");
  });

  it("should explain that a failed run has no report and point to the execution step", () => {
    const html = renderReport(snapshotOf({ phase: RunPhase.FAILED, error: "fallo" }));

    expect(html).toContain("Revise el paso Ejecución.");
  });

  it("should say the server sent no report when a finished run carries no result", () => {
    const html = renderReport(snapshotOf({ phase: RunPhase.DONE, job: { jobId: "j", state: "DONE", step: null, dryRun: false, startedAt: 1 } }));

    expect(html).toContain("el servidor no envió el informe");
  });

  it("should show the counts and the refresh suggestion after a real run that linked units", () => {
    const html = renderReport(doneSnapshot(completarResultOf()));

    expect(html).toContain("Unidades enlazadas");
    expect(html).toContain(SUGGESTION_HEADING);
    expect(html).toContain(SUGGESTION_REAL);
    expect(html).toContain(`<code>${STATEMENT_HTML}</code>`);
  });

  it("should show the dry-run suggestion text after a dry run that would link units", () => {
    const html = renderReport(doneSnapshot(completarResultOf({ dryRun: true, targetModified: false })));

    expect(html).toContain(SUGGESTION_DRY_RUN);
    expect(html).toContain(STATEMENT_HTML);
  });

  it("should hide the suggestion after a real run that linked nothing", () => {
    const html = renderReport(
      doneSnapshot(
        unitResultOf({
          counts: { withoutAddressMaster: 1, created: 0, linked: 0, alreadyHadRecord: 0, ambiguous: 1 },
          linkedList: [],
          ambiguousSamples: [{ id: 3, name: "Doble", provinceId: "09", records: 2 }],
        }),
      ),
    );

    expect(html).not.toContain(SUGGESTION_HEADING);
    expect(html).toContain("Ambiguas");
  });

  it("should give the suggestion statement no copy button", () => {
    const html = renderReport(doneSnapshot(completarResultOf()));
    const start = html.indexOf(SUGGESTION_HEADING);
    const suggestion = html.slice(start, html.indexOf("</section>", start));

    expect(start).toBeGreaterThan(-1);
    expect(suggestion).not.toMatch(/<button\b/);
  });

  it("should list at most DETAIL_LIST_LIMIT linked units in the report even when more were linked", () => {
    const listed = completarResultOf().linkedList;
    const html = renderReport(
      doneSnapshot(
        unitResultOf(
          {
            linkedList: Array.from({ length: DETAIL_LIST_LIMIT }, (_, index) => ({ ...listed[0], id: index + 1 })),
            counts: { withoutAddressMaster: 600, created: 0, linked: 600, alreadyHadRecord: 600, ambiguous: 0 },
          },
          { warnings: [`Se listan las primeras ${DETAIL_LIST_LIMIT} unidades enlazadas en carto.territorial_unit.`] },
        ),
      ),
    );

    expect(html).toContain(`Unidades enlazadas (${DETAIL_LIST_LIMIT})`);
    expect(html).toContain(`Se listan las primeras ${DETAIL_LIST_LIMIT} unidades enlazadas`);
  });

  it("should use no inline styles in any phase", () => {
    const phases = [
      snapshotOf({ phase: RunPhase.IDLE }),
      snapshotOf({ phase: RunPhase.RUNNING }),
      doneSnapshot(completarResultOf()),
      snapshotOf({ phase: RunPhase.FAILED, error: "x" }),
      snapshotOf({ phase: RunPhase.UNKNOWN }),
    ];

    for (const snapshot of phases) {
      expect(renderReport(snapshot), snapshot.phase).not.toMatch(/\sstyle=/);
    }
  });
});
