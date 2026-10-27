import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { MONTHLY_CARTO_JOB_ID, ROUTINE_JOBS } from "@/modules/routine-jobs/ui/jobs";

const MONTHLY_TITLE = "Actualización mensual de carto";

const renderDashboard = (props: { selectedJobId?: string } = {}): string =>
  renderToStaticMarkup(React.createElement(RoutineJobsDashboard, props));

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("RoutineJobsDashboard with the monthly carto job", () => {
  it("AP-35: should list the single monthly carto job", () => {
    expect(ROUTINE_JOBS.map((job) => job.id)).toEqual([MONTHLY_CARTO_JOB_ID]);
    expect(ROUTINE_JOBS.map((job) => job.title)).toEqual([MONTHLY_TITLE]);
  });

  it("AP-35: should show the job title in the list", () => {
    expect(renderDashboard()).toContain(MONTHLY_TITLE);
  });

  it("AP-35: should offer one Abrir button for the job", () => {
    expect(countOf(renderDashboard(), "Abrir")).toBe(1);
  });

  it("AP-35: should open the monthly carto hub for its job id instead of the list", () => {
    const html = renderDashboard({ selectedJobId: MONTHLY_CARTO_JOB_ID });

    expect(html).toContain(MONTHLY_TITLE);
    expect(html).toContain("Conexión");
    expect(html).not.toContain("Abrir");
  });

  it("AP-35: should fall back to the list of the job for an unknown job id", () => {
    const html = renderDashboard({ selectedJobId: "no-existe" });

    expect(countOf(html, "Abrir")).toBe(1);
  });
});
