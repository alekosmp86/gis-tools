import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CENTROS_STAGING_NOTE, CENTROS_WFS_URL } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { CENTROS_ANEP_JOB_ID, ROUTINE_JOBS } from "@/modules/routine-jobs/ui/jobs";
import { CentrosAnepReviewStep } from "@/modules/routine-jobs/ui/steps/CentrosAnepReviewStep";
import { centrosTablesBody } from "../centros-anep/centrosFixtures";

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

const reviewMarkup = (overrides: Partial<React.ComponentProps<typeof CentrosAnepReviewStep>> = {}): string =>
  renderToStaticMarkup(
    React.createElement(CentrosAnepReviewStep, {
      request: {
        connection: { host: "h", port: "5432", db_name: "d", user: "u", password: "pw" },
        tables: centrosTablesBody(),
        dryRun: true,
        confirm: false,
      },
      acknowledged: false,
      canAnalyze: true,
      canLoad: false,
      busy: false,
      runBlockedReason: null,
      onConfirmationChange: () => undefined,
      onAnalyze: () => undefined,
      onLoad: () => undefined,
      ...overrides,
    })
  );

const buttonOf = (html: string, label: string): string => {
  const match = new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}`, "s").exec(html);
  return match?.[0] ?? "";
};

describe("centros-anep job card (CA-1)", () => {
  it("should be the third job with the spec id and title", () => {
    expect(CENTROS_ANEP_JOB_ID).toBe("centros-anep");
    expect(ROUTINE_JOBS[2]).toMatchObject({ id: "centros-anep", title: "Carga de centros ANEP" });
  });

  it("should have a one-sentence description", () => {
    const sentences = ROUTINE_JOBS[2].description.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== "");

    expect(sentences).toHaveLength(1);
  });

  it("should list its card with its own Abrir button", () => {
    const html = renderToStaticMarkup(React.createElement(RoutineJobsDashboard, {}));

    expect(html).toContain("Carga de centros ANEP");
    expect(countOf(html, "Abrir")).toBe(ROUTINE_JOBS.length);
  });

  it("should open its own wizard on Conexión with the staging note, the URL and a way back to the list (CA-16)", () => {
    const html = renderToStaticMarkup(React.createElement(RoutineJobsDashboard, { selectedJobId: CENTROS_ANEP_JOB_ID }));

    expect(html).toContain("Carga de centros ANEP");
    expect(html).toContain("Conexión");
    expect(html).toContain("Volver a la lista");
    expect(html).toContain(CENTROS_STAGING_NOTE);
    expect(html).toContain(CENTROS_WFS_URL.replace(/&/g, "&amp;"));
    expect(html).not.toContain("Abrir");
  });
});

describe("CentrosAnepReviewStep (CA-10, CA-15)", () => {
  it("should summarize both tables and warn that the final table is emptied and refilled", () => {
    const html = reviewMarkup();

    expect(html).toContain("bdj_carto.ine_centros_anep");
    expect(html).toContain("carto.ine_centros_anep");
    expect(html).toContain("DELETE");
    expect(html).toContain("Analizar");
    expect(html).toContain("Cargar ahora");
  });

  it("should disable Cargar ahora and enable Analizar while canLoad is false", () => {
    const html = reviewMarkup({ canAnalyze: true, canLoad: false });

    expect(buttonOf(html, "Analizar")).not.toContain("disabled");
    expect(buttonOf(html, "Cargar ahora")).toContain("disabled");
  });

  it("should enable Cargar ahora with no analysis done, and say that Analizar is optional (CA-15)", () => {
    const html = reviewMarkup({ canAnalyze: true, canLoad: true, acknowledged: true });

    expect(buttonOf(html, "Cargar ahora")).not.toContain("disabled");
    expect(html).toContain("Analizar es opcional");
  });

  it("should disable Cargar ahora when the form is blocked even if canLoad is true", () => {
    const html = reviewMarkup({ canAnalyze: false, canLoad: true, runBlockedReason: "Indique el esquema de cada tabla." });

    expect(buttonOf(html, "Cargar ahora")).toContain("disabled");
  });

  it("should enable Cargar ahora when canLoad is true", () => {
    const html = reviewMarkup({ canAnalyze: true, canLoad: true, acknowledged: true });

    expect(buttonOf(html, "Cargar ahora")).not.toContain("disabled");
  });

  it("should disable both buttons while a run is busy or the form is blocked", () => {
    const busy = reviewMarkup({ canAnalyze: true, canLoad: true, busy: true });
    const blocked = reviewMarkup({ canAnalyze: true, canLoad: true, runBlockedReason: "Indique el esquema de cada tabla." });

    expect(buttonOf(busy, "Analizar")).toContain("disabled");
    expect(buttonOf(busy, "Cargar ahora")).toContain("disabled");
    expect(buttonOf(blocked, "Analizar")).toContain("disabled");
    expect(blocked).toContain("Indique el esquema de cada tabla.");
  });
});
