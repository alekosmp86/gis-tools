import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { EJES_CALLES_JOB_ID, MONTHLY_CARTO_JOB_ID, ROUTINE_JOBS } from "@/modules/routine-jobs/ui/jobs";

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("ejes-calles job card (EJ-1)", () => {
  it("should be the second job, after Carga de padrones, with the spec id and title", () => {
    expect(ROUTINE_JOBS.map((job) => job.id)).toEqual([MONTHLY_CARTO_JOB_ID, "ejes-calles"]);
    expect(EJES_CALLES_JOB_ID).toBe("ejes-calles");
    expect(ROUTINE_JOBS[1].title).toBe("Carga de ejes de calles");
  });

  it("should have a one-sentence description", () => {
    const sentences = ROUTINE_JOBS[1].description.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== "");

    expect(sentences).toHaveLength(1);
  });

  it("should list the card with its own Abrir button", () => {
    const html = renderToStaticMarkup(React.createElement(RoutineJobsDashboard, {}));

    expect(html).toContain("Carga de ejes de calles");
    expect(countOf(html, "Abrir")).toBe(2);
  });

  it("should open its own wizard, with Conexión and a way back to the list", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoutineJobsDashboard, { selectedJobId: EJES_CALLES_JOB_ID })
    );

    expect(html).toContain("Carga de ejes de calles");
    expect(html).toContain("Conexión");
    expect(html).toContain("Volver a la lista");
    expect(html).not.toContain("Abrir");
  });
});
