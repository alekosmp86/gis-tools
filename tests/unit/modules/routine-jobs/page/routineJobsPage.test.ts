import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROUTINE_JOBS } from "@/modules/routine-jobs/ui/jobs";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { RoutineJobsHomeCard } from "@/modules/routine-jobs/ui/RoutineJobsHomeCard";
import { expectHelpLinkNotNested, expectSingleHelpLink } from "../../../ui-kit/helpLinkAssertions";

const ROUTE = "/tools/m/routine-jobs";

const renderDashboard = (props: { selectedJobId?: string } = {}): string =>
  renderToStaticMarkup(React.createElement(RoutineJobsDashboard, props));

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("ROUTINE_JOBS", () => {
  it("AP-35: should list the single Actualización mensual de carto job", () => {
    expect(ROUTINE_JOBS).toHaveLength(1);
    expect(ROUTINE_JOBS[0].id).toBe("actualizacion-mensual-carto");
    expect(ROUTINE_JOBS[0].title).toBe("Actualización mensual de carto");
  });

  it("AC-33: should give every job a non-empty Spanish description and a unique id", () => {
    for (const job of ROUTINE_JOBS) {
      expect(job.description.trim().length, job.id).toBeGreaterThan(0);
      expect(job.id, job.id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(new Set(ROUTINE_JOBS.map((job) => job.id)).size).toBe(ROUTINE_JOBS.length);
  });
});

describe("RoutineJobsDashboard", () => {
  it("AC-33: should show the page title", () => {
    expect(renderDashboard()).toContain("Trabajos de rutina");
  });

  it("AC-33: should list every job with its title and description", () => {
    const html = renderDashboard();

    for (const job of ROUTINE_JOBS) {
      expect(html, job.id).toContain(job.title);
      expect(html, job.id).toContain(job.description);
    }
  });

  it("AC-33: should offer one Abrir button per job", () => {
    const html = renderDashboard();

    expect(countOf(html, "Abrir")).toBe(ROUTINE_JOBS.length);
  });

  it("AC-33: should not show the wizard while no job is selected", () => {
    const html = renderDashboard();

    expect(html).not.toContain("Servidor");
    expect(html).not.toContain("Conexión");
  });

  it("AC-33: should show the wizard instead of the list when a job is selected", () => {
    const html = renderDashboard({ selectedJobId: "actualizacion-mensual-carto" });

    expect(html).toContain("Servidor");
    expect(html).toContain("Conexión");
    expect(html).not.toContain("Abrir");
  });

  it("AC-33: should fall back to the list when the selected job does not exist", () => {
    const html = renderDashboard({ selectedJobId: "no-existe" });

    expect(countOf(html, "Abrir")).toBe(ROUTINE_JOBS.length);
    expect(html).not.toContain("Servidor");
  });

  it("AC-33: should fall back to the list when the selected job id is empty", () => {
    const html = renderDashboard({ selectedJobId: "" });

    expect(countOf(html, "Abrir")).toBe(ROUTINE_JOBS.length);
  });

  it("AC-33: should not use inline styles", () => {
    expect(renderDashboard()).not.toMatch(/\sstyle=/);
    expect(renderDashboard({ selectedJobId: "actualizacion-mensual-carto" })).not.toMatch(/\sstyle=/);
  });
});

describe("RoutineJobsHomeCard", () => {
  const html = renderToStaticMarkup(React.createElement(RoutineJobsHomeCard));

  it("AC-33: should show the module title", () => {
    expect(html).toContain("Trabajos de rutina");
  });

  it("AC-33: should link to the module page", () => {
    expect(html).toContain(`href="${ROUTE}"`);
  });

  it("AC-33: should carry a single sibling help link to the module wiki", () => {
    expectSingleHelpLink(html, "routine-jobs", "Trabajos de rutina");
    expectHelpLinkNotNested(html);
  });

  it("AC-33: should describe the module in Spanish", () => {
    expect(html).toMatch(/padrones|trabajos/i);
  });

  it("AC-33: should not use inline styles", () => {
    expect(html).not.toMatch(/\sstyle=/);
  });
});
