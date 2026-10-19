import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { FullReplaceRunPanel } from "@/components/tools/db-sync-common/FullReplaceRunPanel";
import { Button } from "@/ui-kit/components/ui/Button";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FullReplaceSummary } from "@/components/tools/db-sync-common/FullReplaceSummary";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, resetMock: vi.fn() }));

vi.mock("@/components/tools/db-sync-common/useFullReplaceRun", () => ({ useFullReplaceRun: () => h.state }));
vi.mock("@/core/services/fullReplaceRunStore", () => ({
  FullReplaceRunStatus: { IDLE: "idle", RUNNING: "running", DONE: "done", FAILED: "failed" },
  reset: h.resetMock,
}));

const context = {
  sourceLabel: "public.a",
  targetLabel: "geo.b",
  sourceServer: "src:5432/sdb",
  targetServer: "tgt:5432/tdb",
  startedAt: 1,
};
const result = { sourceRows: 2, insertedRows: 2, errorCount: 0, errors: [], ignoredSourceColumns: [], targetModified: true };

const setState = (over: Record<string, unknown>) => {
  h.state = { status: "idle", progress: null, result: null, error: null, context, ...over };
};

const flatten = (node: ReactNode, out: ReactElement[] = [], texts: string[] = []) => {
  if (node === null || node === undefined || typeof node === "boolean") return { els: out, texts };
  if (typeof node === "string" || typeof node === "number") {
    texts.push(String(node));
    return { els: out, texts };
  }
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out, texts));
    return { els: out, texts };
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  out.push(el);
  flatten(el.props.children, out, texts);
  return { els: out, texts };
};

const render = () => {
  const tree = FullReplaceRunPanel({}) as ReactNode;
  const { els, texts } = flatten(tree);
  return {
    tree,
    text: texts.join(" "),
    byType: (type: unknown) => els.filter((el) => el.type === type) as ReactElement<Record<string, unknown>>[],
  };
};

describe("FullReplaceRunPanel", () => {
  beforeEach(() => {
    h.resetMock.mockReset();
  });

  it("should render nothing without a run context", () => {
    setState({ context: null });
    expect(FullReplaceRunPanel({})).toBeNull();
  });

  it("should show endpoints, progress and the leave-page notice and no Cerrar while running (AC-12)", () => {
    setState({ status: "running", progress: { label: "Lote 1", current: 1, total: 4 } });
    const view = render();
    expect(view.text).toContain("Reemplazo completo en curso");
    expect(view.text).toContain("geo.b");
    expect(view.text).toContain("public.a");
    expect(view.text).toContain("tgt:5432/tdb");
    expect(view.text).toContain("Salir de esta página no detiene el reemplazo");
    const bars = view.byType(ProgressBar);
    expect(bars).toHaveLength(1);
    expect(bars[0].props).toMatchObject({ phase: "Lote 1", current: 1, total: 4, pct: 25 });
    expect(view.byType(Button)).toHaveLength(0);
  });

  it("should show the starting phase at 0% when running without progress", () => {
    setState({ status: "running" });
    const bar = render().byType(ProgressBar)[0];
    expect(bar.props).toMatchObject({ phase: "Iniciando reemplazo...", current: 0, total: 0, pct: 0 });
  });

  it("should cap progress at 100%", () => {
    setState({ status: "running", progress: { label: "x", current: 9, total: 4 } });
    expect(render().byType(ProgressBar)[0].props.pct).toBe(100);
  });

  it("should show the summary and Cerrar when done, without progress or notice", () => {
    setState({ status: "done", result });
    const view = render();
    expect(view.text).toContain("Reemplazo completo finalizado");
    expect(view.text).not.toContain("Salir de esta página");
    expect(view.byType(ProgressBar)).toHaveLength(0);
    const summary = view.byType(FullReplaceSummary);
    expect(summary).toHaveLength(1);
    expect(summary[0].props.result).toBe(result);
    expect(view.byType(Button)).toHaveLength(1);
  });

  it("should show the error and Cerrar when failed (AC-12)", () => {
    setState({ status: "failed", error: "fetch broke" });
    const view = render();
    const alerts = view.byType(AlertMessage);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].props.text).toBe("fetch broke");
    expect(view.byType(FullReplaceSummary)).toHaveLength(0);
    expect(view.byType(Button)).toHaveLength(1);
  });

  it("should wire Cerrar to the store reset", () => {
    setState({ status: "done", result });
    const button = render().byType(Button)[0];
    expect(button.props.onClick).toBe(h.resetMock);
  });
});
