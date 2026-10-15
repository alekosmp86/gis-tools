import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DbConfig, ExecuteBatchResult } from "@/core/types/db";

/** No DOM/renderHook lib installed: react hooks are replaced by a minimal slot-based shim. */
const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  let idx = 0;
  return {
    reset() {
      slots.length = 0;
      idx = 0;
    },
    begin() {
      idx = 0;
    },
    useState<T>(init: T | (() => T)) {
      const i = idx++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => T)() : init;
      const set = (v: T | ((p: T) => T)) => {
        slots[i] = typeof v === "function" ? (v as (p: T) => T)(slots[i] as T) : v;
      };
      return [slots[i] as T, set] as const;
    },
  };
});

vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: h.useState,
}));

const exec = vi.hoisted(() => ({ executeSqlInChunks: vi.fn() }));
vi.mock("@/core/services/dbExecutionService", () => exec);

import { useSqlBatchExecution } from "@/hooks/useSqlBatchExecution";
import { SqlExecutionModal } from "@/components/tools/db-sync-common/SqlExecutionModal";
import { SqlExecutionHeader } from "@/components/tools/db-sync-common/execution/SqlExecutionHeader";
import { SqlExecutionForm } from "@/components/tools/db-sync-common/execution/SqlExecutionForm";
import { SqlExecutionProgress } from "@/components/tools/db-sync-common/execution/SqlExecutionProgress";
import { SqlExecutionSummary } from "@/components/tools/db-sync-common/execution/SqlExecutionSummary";

/** Aliased so the shimmed hook can be driven outside a component. */
const runHook = useSqlBatchExecution;

const dbConfig = {
  host: "h",
  port: 5432,
  db_name: "d",
  schema_name: "s",
  table_name: "t",
  user: "u",
  password: "",
} as unknown as DbConfig;

const okResult: ExecuteBatchResult = {
  success: true,
  totalProcessed: 2,
  affectedRows: 2,
  errorCount: 0,
  errors: [],
  message: "ok",
};

const submitEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

function setup(overrides: Record<string, unknown> = {}) {
  h.reset();
  const onClose = vi.fn();
  const onExecutionCompleted = vi.fn();
  const params = {
    dbConfig,
    activeScript: "SELECT 1;",
    onClose,
    onExecutionCompleted,
    ...overrides,
  };
  const hook = { current: undefined as unknown as ReturnType<typeof useSqlBatchExecution> };
  const render = () => {
    h.begin();
    hook.current = runHook(params);
  };
  render();
  return { hook, render, onClose, onExecutionCompleted };
}

function modal(overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onExecutionCompleted = vi.fn();
  const props = {
    isOpen: true,
    onClose,
    dbConfig,
    scriptType: "INSERT",
    statementCount: 2,
    activeScript: "SELECT 1;",
    onExecutionCompleted,
    ...overrides,
  };
  const render = () => {
    h.begin();
    return SqlExecutionModal(props) as ReactElement<{ className?: string; onClick?: unknown }>;
  };
  h.reset();
  return { render, onClose, onExecutionCompleted };
}

function find<P>(node: ReactNode, type: unknown): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = find<P>(n, type);
      if (f) return f;
    }
    return undefined;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return el as unknown as ReactElement<P>;
  return find<P>(el.props.children, type);
}

type HeaderP = React.ComponentProps<typeof SqlExecutionHeader>;
type FormP = React.ComponentProps<typeof SqlExecutionForm>;
type SummaryP = React.ComponentProps<typeof SqlExecutionSummary>;

beforeEach(() => {
  exec.executeSqlInChunks.mockReset();
  vi.mocked(submitEvent.preventDefault).mockReset();
});

describe("useSqlBatchExecution close handling", () => {
  it("should expose handleFinish as the very same function as handleClose", () => {
    const { hook } = setup();
    expect(hook.current.handleFinish).toBe(hook.current.handleClose);
  });

  it("should call onClose and not onExecutionCompleted when closed before executing", () => {
    const { hook, onClose, onExecutionCompleted } = setup();
    hook.current.handleClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onExecutionCompleted).not.toHaveBeenCalled();
  });

  it("should be a no-op while executing", async () => {
    let release!: (r: ExecuteBatchResult) => void;
    exec.executeSqlInChunks.mockReturnValue(new Promise((res) => (release = res)));
    const { hook, render, onClose, onExecutionCompleted } = setup();
    hook.current.setPasswordInput("pw");
    render();

    const pending = hook.current.handleStartExecution(submitEvent);
    render();
    expect(hook.current.isExecuting).toBe(true);
    hook.current.handleClose();

    expect(onClose).not.toHaveBeenCalled();
    expect(onExecutionCompleted).not.toHaveBeenCalled();
    expect(hook.current.isExecuting).toBe(true);
    release(okResult);
    await pending;
  });

  it("should call onExecutionCompleted exactly once with the result, then reset and close", async () => {
    exec.executeSqlInChunks.mockResolvedValue(okResult);
    const { hook, render, onClose, onExecutionCompleted } = setup();
    hook.current.setPasswordInput("pw");
    render();
    await hook.current.handleStartExecution(submitEvent);
    render();
    expect(hook.current.isCompleted).toBe(true);
    expect(hook.current.result).toBe(okResult);

    hook.current.handleClose();
    render();

    expect(onExecutionCompleted).toHaveBeenCalledTimes(1);
    expect(onExecutionCompleted).toHaveBeenCalledWith(okResult);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hook.current.isCompleted).toBe(false);
    expect(hook.current.result).toBeNull();
    expect(hook.current.progress).toBeNull();
    expect(hook.current.generalError).toBeNull();
    expect(hook.current.isExecuting).toBe(false);
  });

  it("should not fire onExecutionCompleted when closing after an execution error without result", async () => {
    exec.executeSqlInChunks.mockRejectedValue(new Error("boom"));
    const { hook, render, onClose, onExecutionCompleted } = setup();
    hook.current.setPasswordInput("pw");
    render();
    await hook.current.handleStartExecution(submitEvent);
    render();
    expect(hook.current.generalError).toBe("boom");
    expect(hook.current.isCompleted).toBe(false);

    hook.current.handleClose();

    expect(onExecutionCompleted).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should not throw when completed and no onExecutionCompleted callback is provided", async () => {
    exec.executeSqlInChunks.mockResolvedValue(okResult);
    const { hook, render, onClose } = setup({ onExecutionCompleted: undefined });
    hook.current.setPasswordInput("pw");
    render();
    await hook.current.handleStartExecution(submitEvent);
    render();
    expect(() => hook.current.handleClose()).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SqlExecutionModal close wiring", () => {
  it("should render nothing when closed", () => {
    const m = modal({ isOpen: false });
    expect(m.render()).toBeNull();
  });

  it("should give the overlay no click handler in the form state", () => {
    const m = modal();
    const tree = m.render();
    expect(Object.keys(tree.props)).not.toContain("onClick");
  });

  it("should close without onExecutionCompleted when the form Cancel is used", () => {
    const m = modal();
    const form = find<FormP>(m.render(), SqlExecutionForm)!;
    form.props.onCancel();
    expect(m.onClose).toHaveBeenCalledTimes(1);
    expect(m.onExecutionCompleted).not.toHaveBeenCalled();
  });

  it("should hide the header X while executing and keep overlay inert", async () => {
    let release!: (r: ExecuteBatchResult) => void;
    exec.executeSqlInChunks.mockReturnValue(new Promise((res) => (release = res)));
    const m = modal();
    let tree = m.render();
    find<FormP>(tree, SqlExecutionForm)!.props.onPasswordChange("pw");
    tree = m.render();
    const pending = find<FormP>(tree, SqlExecutionForm)!.props.onSubmit(
      submitEvent
    ) as unknown as Promise<void>;
    tree = m.render();

    expect(find(tree, SqlExecutionProgress)).toBeDefined();
    expect(find(tree, SqlExecutionForm)).toBeUndefined();
    expect(Object.keys(tree.props)).not.toContain("onClick");
    const header = find<HeaderP>(tree, SqlExecutionHeader)!;
    expect(renderToStaticMarkup(createElement(SqlExecutionHeader, header.props))).not.toContain(
      "Cerrar modal"
    );
    header.props.onClose();
    expect(m.onClose).not.toHaveBeenCalled();
    release(okResult);
    await pending;
  });

  it("should share one close path between summary button and header X once completed", async () => {
    exec.executeSqlInChunks.mockResolvedValue(okResult);
    const m = modal();
    let tree = m.render();
    find<FormP>(tree, SqlExecutionForm)!.props.onPasswordChange("pw");
    tree = m.render();
    await find<FormP>(tree, SqlExecutionForm)!.props.onSubmit(submitEvent);
    tree = m.render();

    const header = find<HeaderP>(tree, SqlExecutionHeader)!;
    const summary = find<SummaryP>(tree, SqlExecutionSummary)!;
    expect(summary).toBeDefined();
    expect(header.props.onClose).toBe(summary.props.onFinish);
    expect(Object.keys(tree.props)).not.toContain("onClick");
    expect(renderToStaticMarkup(createElement(SqlExecutionHeader, header.props))).toContain(
      "Cerrar modal"
    );

    summary.props.onFinish();
    expect(m.onExecutionCompleted).toHaveBeenCalledTimes(1);
    expect(m.onExecutionCompleted).toHaveBeenCalledWith(okResult);
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });

  it("should call onExecutionCompleted once when completed state is closed via header X", async () => {
    exec.executeSqlInChunks.mockResolvedValue(okResult);
    const m = modal();
    let tree = m.render();
    find<FormP>(tree, SqlExecutionForm)!.props.onPasswordChange("pw");
    tree = m.render();
    await find<FormP>(tree, SqlExecutionForm)!.props.onSubmit(submitEvent);
    tree = m.render();

    find<HeaderP>(tree, SqlExecutionHeader)!.props.onClose();

    expect(m.onExecutionCompleted).toHaveBeenCalledTimes(1);
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SqlExecutionHeader static render", () => {
  const base: HeaderP = {
    isExecuting: false,
    isCompleted: false,
    result: null,
    progress: null,
    statementCount: 2,
    onClose: () => undefined,
  };

  it("should render the X in the form state", () => {
    expect(renderToStaticMarkup(createElement(SqlExecutionHeader, base))).toContain("Cerrar modal");
  });

  it("should not render the X while executing", () => {
    const html = renderToStaticMarkup(
      createElement(SqlExecutionHeader, { ...base, isExecuting: true })
    );
    expect(html).not.toContain("Cerrar modal");
  });

  it("should render the X in the completed state", () => {
    const html = renderToStaticMarkup(
      createElement(SqlExecutionHeader, { ...base, isCompleted: true, result: okResult })
    );
    expect(html).toContain("Cerrar modal");
  });
});
