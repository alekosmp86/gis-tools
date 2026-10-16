import { describe, it, expect, vi, beforeEach } from "vitest";

/** No DOM/renderHook lib installed: react hooks are replaced by a minimal slot-based shim. */
const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  const effects: Array<{ fn: () => void | (() => void); deps?: unknown[] }> = [];
  const effectState: Array<{ deps?: unknown[] }> = [];
  let idx = 0;
  let effectIdx = 0;
  return {
    reset() {
      slots.length = 0;
      effects.length = 0;
      effectState.length = 0;
      idx = 0;
      effectIdx = 0;
    },
    begin() {
      idx = 0;
      effectIdx = 0;
      effects.length = 0;
    },
    flushEffects() {
      effects.forEach((effect, i) => {
        const prev = effectState[i];
        const changed =
          !prev ||
          !effect.deps ||
          !prev.deps ||
          effect.deps.some((d, k) => !Object.is(d, prev.deps![k]));
        if (!changed) return;
        effectState[i] = { deps: effect.deps };
        effect.fn();
      });
    },
    useState<T>(init: T | (() => T)) {
      const i = idx++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => T)() : init;
      const set = (v: T | ((p: T) => T)) => {
        slots[i] = typeof v === "function" ? (v as (p: T) => T)(slots[i] as T) : v;
      };
      return [slots[i] as T, set] as const;
    },
    useRef<T>(init: T) {
      const i = idx++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i] as { current: T };
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      effects[effectIdx++] = { fn, deps };
    },
  };
});

vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: h.useState,
  useRef: h.useRef,
  useEffect: h.useEffect,
}));

const rq = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: rq.invalidateQueries }),
}));

import {
  useSqlPatchDrawerState,
  type UseSqlPatchDrawerStateParams,
} from "@/components/tools/db-sync-common/sql-patch-drawer/useSqlPatchDrawerState";
import { SqlScriptType } from "@/core/types/comparison";
import { AlertType } from "@/ui-kit/types/ui";

const runHook = useSqlPatchDrawerState;

type Generated = { sqlUpdateScript: string; sqlInsertScript: string };

const baseParams: UseSqlPatchDrawerStateParams = {
  tableName: "tbl",
  selectedCount: 2,
  selectionVersion: 1,
  sqlUpdatePreview: "UPDATE a;\nUPDATE b;",
  sqlUpdateCount: 2,
  sqlInsertPreview: "",
  sqlInsertCount: 0,
};

function setup(initial: Partial<UseSqlPatchDrawerStateParams> = {}) {
  h.reset();
  let params: UseSqlPatchDrawerStateParams = { ...baseParams, ...initial };
  const hook = { current: undefined as unknown as ReturnType<typeof runHook> };
  const render = () => {
    h.begin();
    hook.current = runHook(params);
    h.flushEffects();
  };
  const rerender = (next: Partial<UseSqlPatchDrawerStateParams>) => {
    params = { ...params, ...next };
    render();
  };
  render();
  return { hook, render, rerender };
}

const twoStatements: Generated = {
  sqlUpdateScript: "-- header\nUPDATE a;\nUPDATE b;",
  sqlInsertScript: "INSERT x;",
};

beforeEach(() => {
  rq.invalidateQueries.mockReset();
});

describe("useSqlPatchDrawerState selection gating", () => {
  it("should return null and never call the generator when nothing is selected", async () => {
    const gen = vi.fn();
    const { hook } = setup({ selectedCount: 0, onGenerateFullScript: gen });
    expect(await hook.current.ensureScriptAvailable()).toBeNull();
    expect(gen).not.toHaveBeenCalled();
    expect(hook.current.isGenerating).toBe(false);
  });

  it("should report no executable statements when counts are zero", () => {
    const { hook } = setup({
      selectedCount: 0,
      sqlUpdateCount: 0,
      sqlUpdatePreview: "",
      sqlInsertCount: 0,
      sqlInsertPreview: "",
    });
    expect(hook.current.hasExecutableStatements).toBe(false);
  });

  it("should report executable statements for the active tab when its count is positive", () => {
    const { hook } = setup();
    expect(hook.current.hasExecutableStatements).toBe(true);
  });

  it("should switch executability when moving to a tab with zero statements", () => {
    const { hook, render } = setup();
    hook.current.handleTabChange(SqlScriptType.INSERT);
    render();
    expect(hook.current.activeTab).toBe(SqlScriptType.INSERT);
    expect(hook.current.hasExecutableStatements).toBe(false);
  });

  it("should use precomputed preview and counts instead of scanning scripts", () => {
    const { hook } = setup();
    expect(hook.current.updateStats.previewScript).toBe("UPDATE a;\nUPDATE b;");
    expect(hook.current.updateStats.statementCount).toBe(2);
    expect(hook.current.updateStats.isTruncated).toBe(false);
  });

  it("should mark the preview truncated when the count exceeds 25 and not at exactly 25", () => {
    const { hook: over } = setup({ sqlUpdateCount: 26 });
    expect(over.current.updateStats.isTruncated).toBe(true);
    const { hook: exact } = setup({ sqlUpdateCount: 25 });
    expect(exact.current.updateStats.isTruncated).toBe(false);
  });

  it("should fall back to scanning the script, ignoring comments and blank lines", () => {
    const { hook } = setup({
      sqlUpdatePreview: undefined,
      sqlUpdateCount: undefined,
      sqlUpdateScript: "-- c\n\nUPDATE a;\nUPDATE b;\n",
    });
    expect(hook.current.updateStats.statementCount).toBe(2);
  });
});

describe("useSqlPatchDrawerState lazy full script generation", () => {
  it("should generate once, return the active tab script and cache it for the same version", async () => {
    const gen = vi.fn().mockResolvedValue(twoStatements);
    const { hook, render } = setup({ onGenerateFullScript: gen });

    const first = await hook.current.ensureScriptAvailable();
    render();
    expect(first).toBe(twoStatements.sqlUpdateScript);
    expect(hook.current.isGenerating).toBe(false);
    expect(hook.current.activeScript).toBe(twoStatements.sqlUpdateScript);

    const second = await hook.current.ensureScriptAvailable();
    expect(second).toBe(twoStatements.sqlUpdateScript);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("should return the insert script when the insert tab is active", async () => {
    const gen = vi.fn().mockResolvedValue(twoStatements);
    const { hook, render } = setup({ onGenerateFullScript: gen, sqlInsertCount: 1, sqlInsertPreview: "INSERT x;" });
    hook.current.handleTabChange(SqlScriptType.INSERT);
    render();
    expect(await hook.current.ensureScriptAvailable()).toBe("INSERT x;");
  });

  it("should reset the cached scripts when selectionVersion changes", async () => {
    const gen = vi.fn().mockResolvedValue(twoStatements);
    const { hook, render, rerender } = setup({ onGenerateFullScript: gen });
    await hook.current.ensureScriptAvailable();
    render();
    expect(hook.current.activeScript).not.toBe("");

    rerender({ selectionVersion: 2 });
    expect(hook.current.activeScript).toBe("");

    await hook.current.ensureScriptAvailable();
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("should discard a late result and raise an INFO alert when the selection version moved during generation", async () => {
    let release!: (g: Generated) => void;
    const gen = vi.fn().mockReturnValue(new Promise<Generated>((res) => (release = res)));
    const { hook, render, rerender } = setup({ onGenerateFullScript: gen });

    const pending = hook.current.ensureScriptAvailable();
    rerender({ selectionVersion: 2 });
    release(twoStatements);
    const result = await pending;
    render();

    expect(result).toBeNull();
    expect(hook.current.activeScript).toBe("");
    expect(hook.current.isGenerating).toBe(false);
    expect(hook.current.executionResult?.type).toBe(AlertType.INFO);
    expect(hook.current.executionResult?.text).toBe(
      "La selección cambió durante la generación del script. Vuelva a intentarlo."
    );
  });

  it("should not warn when the generated statement count matches the selection", async () => {
    const gen = vi.fn().mockResolvedValue(twoStatements);
    const { hook, render } = setup({ onGenerateFullScript: gen });
    await hook.current.ensureScriptAvailable();
    render();
    expect(hook.current.executionResult).toBeNull();
  });

  it("should raise a WARNING when the generated statement count differs from the selection", async () => {
    const gen = vi.fn().mockResolvedValue({
      sqlUpdateScript: "UPDATE a;",
      sqlInsertScript: "",
    });
    const { hook, render } = setup({ onGenerateFullScript: gen });
    const script = await hook.current.ensureScriptAvailable();
    render();

    expect(script).toBe("UPDATE a;");
    expect(hook.current.executionResult?.type).toBe(AlertType.WARNING);
    expect(hook.current.executionResult?.text).toContain("1 sentencias");
    expect(hook.current.executionResult?.text).toContain("se esperaban 2");
  });

  it("should surface an ERROR alert and return null when generation fails", async () => {
    const gen = vi.fn().mockRejectedValue(new Error("worker down"));
    const { hook, render } = setup({ onGenerateFullScript: gen });
    const script = await hook.current.ensureScriptAvailable();
    render();

    expect(script).toBeNull();
    expect(hook.current.isGenerating).toBe(false);
    expect(hook.current.executionResult?.type).toBe(AlertType.ERROR);
  });

  it("should return the existing script without generating when one is already provided", async () => {
    const gen = vi.fn();
    const { hook } = setup({ onGenerateFullScript: gen, sqlUpdateScript: "UPDATE z;" });
    expect(await hook.current.ensureScriptAvailable()).toBe("UPDATE z;");
    expect(gen).not.toHaveBeenCalled();
  });

  it("should return the empty script when none exists and no generator is supplied", async () => {
    const { hook } = setup();
    expect(await hook.current.ensureScriptAvailable()).toBe("");
  });
});

describe("useSqlPatchDrawerState execution completion", () => {
  it("should mark the active tab executed and invalidate the comparison query", () => {
    const { hook, render } = setup();
    hook.current.handleExecutionCompleted({
      success: true,
      totalProcessed: 2,
      affectedRows: 2,
      errorCount: 0,
      errors: [],
      message: "ok",
    });
    render();
    expect(hook.current.executedTabs[SqlScriptType.UPDATE]).toBe(true);
    expect(hook.current.executedTabs[SqlScriptType.INSERT]).toBe(false);
    expect(rq.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["datasetComparison"] });
  });
});

describe("useSqlPatchDrawerState executed tabs keyed on selectionVersion", () => {
  const result = {
    success: true,
    totalProcessed: 2,
    affectedRows: 2,
    errorCount: 0,
    errors: [],
    message: "ok",
  };

  it("should report the current tab as executed after an execution completes", () => {
    const { hook, render } = setup();
    expect(hook.current.isCurrentTabExecuted).toBe(false);

    hook.current.handleExecutionCompleted(result);
    render();

    expect(hook.current.isCurrentTabExecuted).toBe(true);
  });

  it("should keep the tab executed when re-rendered with the same selectionVersion", () => {
    const { hook, render, rerender } = setup();
    hook.current.handleExecutionCompleted(result);
    render();

    rerender({ selectionVersion: 1 });

    expect(hook.current.isCurrentTabExecuted).toBe(true);
    expect(hook.current.executedTabs[SqlScriptType.UPDATE]).toBe(true);
  });

  it("should re-enable execution when selectionVersion is bumped after an execution", () => {
    const { hook, render, rerender } = setup();
    hook.current.handleExecutionCompleted(result);
    render();
    expect(hook.current.isCurrentTabExecuted).toBe(true);

    rerender({ selectionVersion: 2 });

    expect(hook.current.isCurrentTabExecuted).toBe(false);
    expect(hook.current.executedTabs[SqlScriptType.UPDATE]).toBe(false);
    expect(hook.current.executedTabs[SqlScriptType.INSERT]).toBe(false);
  });

  it("should mark only the new version's tab executed after a further execution", () => {
    const { hook, render, rerender } = setup();
    hook.current.handleExecutionCompleted(result);
    render();
    rerender({ selectionVersion: 2 });

    hook.current.handleExecutionCompleted(result);
    render();

    expect(hook.current.executedTabs[SqlScriptType.UPDATE]).toBe(true);
    expect(hook.current.executedTabs[SqlScriptType.INSERT]).toBe(false);
  });
});
