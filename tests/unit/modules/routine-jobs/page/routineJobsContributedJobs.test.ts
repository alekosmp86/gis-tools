import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { ModuleContributionsProvider } from "@/ui-kit/modules/ModuleContributionsContext";
import { UiSlot } from "@/ui-kit/modules/contracts";

const MONTHLY_TITLE = "Actualización mensual de carto";
const JOB_ID = "x.job";

const Job: React.FC = () => React.createElement("span", null, "contributed-body");

type ProviderProps = React.ComponentProps<typeof ModuleContributionsProvider>;
type Contributions = ProviderProps["contributions"];

const renderDashboard = (contributions: Contributions, selectedJobId?: string): string =>
  renderToStaticMarkup(
    React.createElement(
      ModuleContributionsProvider,
      { contributions } as ProviderProps,
      React.createElement(RoutineJobsDashboard, { selectedJobId }),
    ),
  );

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

const jobContribution = (over: Record<string, unknown> = {}) => ({
  slot: UiSlot.ROUTINE_JOBS_LIST,
  id: JOB_ID,
  order: 1,
  label: "Trabajo X",
  description: "Descripcion X",
  Component: Job,
  ...over,
});

describe("RoutineJobsDashboard contributed jobs", () => {
  it("CJ-1: should expose the slot as routineJobs.list", () => {
    expect(UiSlot.ROUTINE_JOBS_LIST).toBe("routineJobs.list");
  });

  it("CJ-3: should render the contributed card with label, description and Abrir after the monthly card", () => {
    const html = renderDashboard([jobContribution()] as Contributions);

    expect(html).toContain("Trabajo X");
    expect(html).toContain("Descripcion X");
    expect(countOf(html, "Abrir")).toBe(2);
    expect(html.indexOf(MONTHLY_TITLE)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(MONTHLY_TITLE)).toBeLessThan(html.indexOf("Trabajo X"));
    expect(html).not.toContain("contributed-body");
  });

  it("CJ-9: should render only the monthly card when nothing is contributed", () => {
    const html = renderDashboard([]);

    expect(html).toContain(MONTHLY_TITLE);
    expect(countOf(html, "Abrir")).toBe(1);
  });

  it("CJ-9: should ignore contributions of other slots", () => {
    const html = renderDashboard([jobContribution({ slot: UiSlot.HOME_TOOL_GRID })] as Contributions);

    expect(html).not.toContain("Trabajo X");
    expect(countOf(html, "Abrir")).toBe(1);
  });

  it("CJ-3: should order contributed cards by order and place unordered ones last", () => {
    const html = renderDashboard([
      jobContribution({ id: "c", label: "Cuarto", order: undefined }),
      jobContribution({ id: "b", label: "Segundo", order: 20 }),
      jobContribution({ id: "a", label: "Primero", order: 10 }),
    ] as Contributions);

    expect(html.indexOf("Primero")).toBeLessThan(html.indexOf("Segundo"));
    expect(html.indexOf("Segundo")).toBeLessThan(html.indexOf("Cuarto"));
  });

  it("CJ-3: should fall back to the id as title and an empty description when they are missing", () => {
    const html = renderDashboard([jobContribution({ label: undefined, description: undefined })] as Contributions);

    expect(html).toContain(JOB_ID);
    expect(countOf(html, "Abrir")).toBe(2);
  });

  it("CJ-4: should open the contributed component in the job panel with a back button instead of the list", () => {
    const html = renderDashboard([jobContribution()] as Contributions, JOB_ID);

    expect(html).toContain("Trabajo X");
    expect(html).toContain("contributed-body");
    expect(html).toContain("Volver a la lista");
    expect(html).not.toContain("Abrir");
    expect(html).not.toContain(MONTHLY_TITLE);
  });

  it("CJ-4: should fall back to the list when the selected contributed job is not registered", () => {
    const html = renderDashboard([], JOB_ID);

    expect(html).not.toContain("contributed-body");
    expect(countOf(html, "Abrir")).toBe(1);
  });

  it("CJ-5: should accept a description on contributions of other slots without rendering it in the dashboard", () => {
    const contribution = { slot: UiSlot.APP_STATUS, id: "s", order: 1, description: "ignored", Component: Job };
    const html = renderDashboard([contribution] as Contributions);

    expect(html).not.toContain("ignored");
    expect(html).not.toContain("contributed-body");
  });
});
