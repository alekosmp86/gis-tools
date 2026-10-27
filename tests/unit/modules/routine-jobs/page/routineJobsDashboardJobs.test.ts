import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { ROUTINE_JOBS } from "@/modules/routine-jobs/ui/jobs";

vi.mock("@/modules/routine-jobs/ui/CargarPadronesWizard", () => ({
  CargarPadronesWizard: () => "MARCA_CARGAR",
}));

vi.mock("@/modules/routine-jobs/ui/ActualizarPadronWizard", () => ({
  default: () => "MARCA_ACTUALIZAR",
}));

const CARGAR_MARK = "MARCA_CARGAR";
const ACTUALIZAR_MARK = "MARCA_ACTUALIZAR";
const CARGAR_TITLE = "Cargar padrones";
const ACTUALIZAR_TITLE = "Actualizar padrones de carto";

const renderDashboard = (props: { selectedJobId?: string } = {}): string =>
  renderToStaticMarkup(React.createElement(RoutineJobsDashboard, props));

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("RoutineJobsDashboard with both routine jobs", () => {
  it("AP-35: should list Cargar padrones and Actualizar padrones de carto in that order", () => {
    expect(ROUTINE_JOBS.map((job) => job.id)).toEqual(["cargar-padrones", "actualizar-padron"]);
    expect(ROUTINE_JOBS.map((job) => job.title)).toEqual([CARGAR_TITLE, ACTUALIZAR_TITLE]);
  });

  it("AP-35: should show both job titles in the list", () => {
    const html = renderDashboard();

    expect(html).toContain(CARGAR_TITLE);
    expect(html).toContain(ACTUALIZAR_TITLE);
  });

  it("AP-35: should offer one Abrir button for each job", () => {
    expect(countOf(renderDashboard(), "Abrir")).toBe(2);
  });

  it("AP-35: should show no wizard while no job is opened", () => {
    const html = renderDashboard();

    expect(html).not.toContain(CARGAR_MARK);
    expect(html).not.toContain(ACTUALIZAR_MARK);
  });

  it("AP-35: should open the Cargar padrones wizard for its job id and no other", () => {
    const html = renderDashboard({ selectedJobId: "cargar-padrones" });

    expect(html).toContain(CARGAR_MARK);
    expect(html).not.toContain(ACTUALIZAR_MARK);
    expect(html).toContain(CARGAR_TITLE);
  });

  it("AP-35: should open the Actualizar padrones wizard for its job id and no other", () => {
    const html = renderDashboard({ selectedJobId: "actualizar-padron" });

    expect(html).toContain(ACTUALIZAR_MARK);
    expect(html).not.toContain(CARGAR_MARK);
    expect(html).toContain(ACTUALIZAR_TITLE);
  });

  it("AP-35: should fall back to the list of both jobs for an unknown job id", () => {
    const html = renderDashboard({ selectedJobId: "no-existe" });

    expect(countOf(html, "Abrir")).toBe(2);
    expect(html).not.toContain(ACTUALIZAR_MARK);
  });
});
