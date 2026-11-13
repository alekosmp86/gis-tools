import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EjesResultStep, type EjesResultStepProps } from "@/modules/routine-jobs/ui/steps/EjesResultStep";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/ejesCallesRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const LOAD_LABEL = "Cargar ahora";

const doneSnapshot = (): EjesRunSnapshot =>
  ({ phase: RunPhase.DONE, job: undefined, plan: undefined }) as unknown as EjesRunSnapshot;

const propsOf = (phase: RunPhase, canLoad: boolean, overrides: Partial<EjesResultStepProps> = {}): EjesResultStepProps => ({
  snapshot: { ...doneSnapshot(), phase } as EjesRunSnapshot,
  nowMs: 0,
  mapBase: null,
  canLoad,
  onLoad: () => undefined,
  onNewRun: () => undefined,
  onBackToReview: () => undefined,
  ...overrides,
});

const html = (props: EjesResultStepProps): string => renderToStaticMarkup(React.createElement(EjesResultStep, props));

const textOf = (node: React.ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
};

const findOnClick = (node: React.ReactNode, label: string): (() => void) | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findOnClick(child, label);
      if (found) return found;
    }
    return undefined;
  }
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as { onClick?: () => void; children?: React.ReactNode };
  if (props.onClick && textOf(props.children) === label) return props.onClick;
  return findOnClick(props.children, label);
};

describe("EjesResultStep Cargar ahora (EJ-24)", () => {
  it("should render the Cargar ahora button when the run is DONE and canLoad is true", () => {
    expect(html(propsOf(RunPhase.DONE, true))).toContain(LOAD_LABEL);
  });

  it("should call onLoad when Cargar ahora is clicked", () => {
    const onLoad = vi.fn();
    const tree = EjesResultStep(propsOf(RunPhase.DONE, true, { onLoad }));

    const click = findOnClick(tree, LOAD_LABEL);
    click?.();

    expect(click).toBeDefined();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("should hide Cargar ahora when the run is DONE and canLoad is false", () => {
    expect(html(propsOf(RunPhase.DONE, false))).not.toContain(LOAD_LABEL);
  });

  it.each([RunPhase.IDLE, RunPhase.STARTING, RunPhase.RUNNING, RunPhase.FAILED, RunPhase.UNKNOWN])(
    "should not render Cargar ahora in phase %s even when canLoad is true",
    (phase) => {
      expect(html(propsOf(phase, true))).not.toContain(LOAD_LABEL);
    }
  );

  it("should keep Nueva carga and Volver a Revisar when Cargar ahora is shown", () => {
    const out = html(propsOf(RunPhase.DONE, true));

    expect(out).toContain("Nueva carga");
    expect(out).toContain("Volver a Revisar");
  });

  it("should keep Nueva carga and Volver a Revisar when Cargar ahora is hidden", () => {
    const out = html(propsOf(RunPhase.DONE, false));

    expect(out).toContain("Nueva carga");
    expect(out).toContain("Volver a Revisar");
  });
});
