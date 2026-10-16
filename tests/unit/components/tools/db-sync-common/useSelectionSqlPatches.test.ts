import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** No DOM/renderHook lib installed: react hooks are replaced by a minimal slot-based shim. */
const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  const effects: Array<{ fn: () => void | (() => void); deps?: unknown[] }> = [];
  const effectState: Array<{ deps?: unknown[]; cleanup?: void | (() => void) }> = [];
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
        if (prev && typeof prev.cleanup === "function") prev.cleanup();
        effectState[i] = { deps: effect.deps, cleanup: effect.fn() };
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
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      effects[effectIdx++] = { fn, deps };
    },
  };
});

vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: h.useState,
  useEffect: h.useEffect,
}));

const bridge = vi.hoisted(() => ({
  generateSqlPatchesInWorker: vi.fn(),
  serializeFileDataset: vi.fn((d: unknown) => ({ serialized: d })),
}));
vi.mock("@/core/services/workerBridge", () => bridge);

import {
  useSelectionSqlPatches,
  type UseSelectionSqlPatchesParams,
} from "@/components/tools/db-sync-common/sql-patch-drawer/useSelectionSqlPatches";
import {
  DiscrepancyType,
  PairingMethod,
  type ComparisonSummary,
  type DiscrepancyItem,
  type SqlPatchSummary,
} from "@/core/types/comparison";
import type { DbConfig } from "@/core/types/db";

const runHook = useSelectionSqlPatches;
const PK = "gid";

const dbConfig = { schema_name: "sch", table_name: "tbl" } as unknown as DbConfig;

function upd(i: number): DiscrepancyItem {
  return {
    id: `u-${i}`,
    suid: `U${i}`,
    type: DiscrepancyType.ATTRIBUTE_MISMATCH,
    differences: [],
    dbRecord: { [PK]: i },
    pairing: { method: PairingMethod.EXACT, dbCount: 1, fileCount: 1 },
  };
}
function ins(i: number): DiscrepancyItem {
  return { id: `i-${i}`, suid: `I${i}`, type: DiscrepancyType.ONLY_IN_SHP, differences: [] };
}
const unkeyed: DiscrepancyItem = {
  id: "bad",
  suid: "BAD",
  type: DiscrepancyType.ATTRIBUTE_MISMATCH,
  differences: [],
  dbRecord: { [PK]: null },
  pairing: { method: PairingMethod.GEOMETRY, dbCount: 1, fileCount: 1 },
};

const range = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

function patchResult(overrides: Partial<SqlPatchSummary> = {}): SqlPatchSummary {
  return {
    sqlUpdateScript: "UPDATE;",
    sqlInsertScript: "INSERT;",
    sqlUpdateCount: 1,
    sqlInsertCount: 1,
    sqlUpdatePreview: "UPDATE preview",
    sqlInsertPreview: "INSERT preview",
    ...overrides,
  };
}

function makeParams(
  items: DiscrepancyItem[],
  selected: string[],
  extra: Partial<ComparisonSummary> = {}
): UseSelectionSqlPatchesParams {
  return {
    summary: { items, dbColumnTypes: { a: "text" }, ...extra } as unknown as ComparisonSummary,
    selectedIds: new Set(selected),
    fileDataset: { fileName: "f", recordsMap: new Map() } as never,
    mappingConfig: { primaryKeyColumn: PK, targetSrid: 4326 } as never,
    dbConfig,
  };
}

function setup(initial: UseSelectionSqlPatchesParams) {
  h.reset();
  let params = initial;
  const hook = { current: undefined as unknown as ReturnType<typeof runHook> };
  const render = () => {
    h.begin();
    hook.current = runHook(params);
    h.flushEffects();
  };
  const rerender = (next: Partial<UseSelectionSqlPatchesParams>) => {
    params = { ...params, ...next };
    render();
  };
  render();
  return { hook, render, rerender };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(150);
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  bridge.generateSqlPatchesInWorker.mockReset();
  bridge.serializeFileDataset.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSelectionSqlPatches", () => {
  it("should not call the worker and report zero counts for an empty selection", async () => {
    const { hook } = setup(makeParams([upd(1), ins(1)], []));
    await settle();
    expect(bridge.generateSqlPatchesInWorker).not.toHaveBeenCalled();
    expect(hook.current.selectedCount).toBe(0);
    expect(hook.current.sqlUpdateCount).toBe(0);
    expect(hook.current.sqlInsertCount).toBe(0);
    expect(hook.current.sqlUpdatePreview).toBe("");
    expect(hook.current.sqlInsertPreview).toBe("");
  });

  it("should not call the worker when the only selected item is not actionable", async () => {
    const { hook } = setup(makeParams([unkeyed], ["bad"]));
    await settle();
    expect(bridge.generateSqlPatchesInWorker).not.toHaveBeenCalled();
    expect(hook.current.selectedCount).toBe(0);
  });

  it("should count updates and inserts from the actionable selection", () => {
    const { hook } = setup(makeParams([upd(1), upd(2), ins(1), unkeyed], ["u-1", "u-2", "i-1", "bad"]));
    expect(hook.current.selectedCount).toBe(3);
    expect(hook.current.sqlUpdateCount).toBe(2);
    expect(hook.current.sqlInsertCount).toBe(1);
  });

  it("should debounce the preview request by 150ms", async () => {
    setup(makeParams([upd(1)], ["u-1"]));
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    await vi.advanceTimersByTimeAsync(149);
    expect(bridge.generateSqlPatchesInWorker).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.generateSqlPatchesInWorker).toHaveBeenCalledTimes(1);
  });

  it("should cap the preview request at 25 items per kind", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const items = [...range(40, upd), ...range(30, ins)];
    setup(makeParams(items, items.map((i) => i.id)));
    await settle();

    const payload = bridge.generateSqlPatchesInWorker.mock.calls[0][0];
    const sent = payload.discrepancyItems as DiscrepancyItem[];
    expect(sent.filter((i) => i.type === DiscrepancyType.ONLY_IN_SHP)).toHaveLength(25);
    expect(sent.filter((i) => i.type !== DiscrepancyType.ONLY_IN_SHP)).toHaveLength(25);
    expect(sent).toHaveLength(50);
  });

  it("should send exactly 25 and 24 items at the cap boundary without truncating the smaller kind", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const items = [...range(25, upd), ...range(24, ins)];
    setup(makeParams(items, items.map((i) => i.id)));
    await settle();
    const sent = bridge.generateSqlPatchesInWorker.mock.calls[0][0].discrepancyItems;
    expect(sent).toHaveLength(49);
  });

  it("should send a single selected item", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    setup(makeParams([upd(1), upd(2)], ["u-2"]));
    await settle();
    const sent = bridge.generateSqlPatchesInWorker.mock.calls[0][0].discrepancyItems;
    expect(sent.map((i: DiscrepancyItem) => i.id)).toEqual(["u-2"]);
  });

  it("should pass table, schema, column types and the summary SRID to the worker", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    setup(makeParams([upd(1)], ["u-1"], { targetSrid: 25830 }));
    await settle();
    const payload = bridge.generateSqlPatchesInWorker.mock.calls[0][0];
    expect(payload.dbSchemaName).toBe("sch");
    expect(payload.dbTableName).toBe("tbl");
    expect(payload.dbColumnTypes).toEqual({ a: "text" });
    expect(payload.mappingConfig.targetSrid).toBe(25830);
  });

  it("should fall back to the mapping SRID when the summary has none", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    setup(makeParams([upd(1)], ["u-1"]));
    await settle();
    expect(bridge.generateSqlPatchesInWorker.mock.calls[0][0].mappingConfig.targetSrid).toBe(4326);
  });

  it("should expose the generated preview once the worker resolves", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const { hook, render } = setup(makeParams([upd(1)], ["u-1"]));
    await settle();
    render();
    expect(hook.current.sqlUpdatePreview).toBe("UPDATE preview");
    expect(hook.current.sqlInsertPreview).toBe("INSERT preview");
  });

  it("should clear the preview when the worker rejects", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult());
    const { hook, render, rerender } = setup(makeParams([upd(1), upd(2)], ["u-1"]));
    await settle();
    render();
    expect(hook.current.sqlUpdatePreview).toBe("UPDATE preview");

    bridge.generateSqlPatchesInWorker.mockRejectedValueOnce(new Error("boom"));
    rerender({ selectedIds: new Set(["u-1", "u-2"]) });
    await settle();
    render();
    expect(hook.current.sqlUpdatePreview).toBe("");
  });

  it("should hide the previous preview as soon as the selection becomes empty", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const { hook, render, rerender } = setup(makeParams([upd(1)], ["u-1"]));
    await settle();
    render();
    expect(hook.current.sqlUpdatePreview).not.toBe("");

    rerender({ selectedIds: new Set() });
    expect(hook.current.sqlUpdatePreview).toBe("");
    expect(hook.current.selectedCount).toBe(0);
  });

  it("should discard a late worker result when the selection changed meanwhile", async () => {
    let resolveFirst!: (r: SqlPatchSummary) => void;
    bridge.generateSqlPatchesInWorker.mockReturnValueOnce(
      new Promise<SqlPatchSummary>((res) => (resolveFirst = res))
    );
    const { hook, render, rerender } = setup(makeParams([upd(1), upd(2)], ["u-1"]));
    await vi.advanceTimersByTimeAsync(150);
    expect(bridge.generateSqlPatchesInWorker).toHaveBeenCalledTimes(1);

    bridge.generateSqlPatchesInWorker.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ selectedIds: new Set(["u-2"]) });
    resolveFirst(patchResult({ sqlUpdatePreview: "STALE" }));
    await Promise.resolve();
    await Promise.resolve();
    render();

    expect(hook.current.sqlUpdatePreview).toBe("");
  });

  it("should cancel the pending debounce when the selection changes before it fires", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const { rerender } = setup(makeParams([upd(1), upd(2)], ["u-1"]));
    await vi.advanceTimersByTimeAsync(100);
    rerender({ selectedIds: new Set(["u-2"]) });
    await settle();
    expect(bridge.generateSqlPatchesInWorker).toHaveBeenCalledTimes(1);
    const sent = bridge.generateSqlPatchesInWorker.mock.calls[0][0].discrepancyItems;
    expect(sent.map((i: DiscrepancyItem) => i.id)).toEqual(["u-2"]);
  });

  it("should generate the full script for ALL actionable items without the preview cap", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const items = [...range(60, upd), ...range(40, ins), unkeyed];
    const { hook } = setup(makeParams(items, items.map((i) => i.id)));
    await settle();
    bridge.generateSqlPatchesInWorker.mockClear();

    const result = await hook.current.generateFullScript();

    expect(result).toEqual(patchResult());
    const sent = bridge.generateSqlPatchesInWorker.mock.calls[0][0].discrepancyItems;
    expect(sent).toHaveLength(100);
    expect(sent.some((i: DiscrepancyItem) => i.id === "bad")).toBe(false);
  });

  it("should serialise a dataset without recordsMap by supplying an empty map", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const params = makeParams([upd(1)], ["u-1"]);
    params.fileDataset = { fileName: "f" } as never;
    const { hook } = setup(params);
    await hook.current.generateFullScript();
    const arg = bridge.serializeFileDataset.mock.calls.at(-1)![0] as { recordsMap: Map<unknown, unknown> };
    expect(arg.recordsMap).toBeInstanceOf(Map);
    expect(arg.recordsMap.size).toBe(0);
  });

  it("should expose an empty preview until the new one arrives when selectedIds changes", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult({ sqlUpdatePreview: "FIRST" }));
    const { hook, render, rerender } = setup(makeParams([upd(1), upd(2)], ["u-1"]));
    await settle();
    render();
    expect(hook.current.sqlUpdatePreview).toBe("FIRST");

    bridge.generateSqlPatchesInWorker.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ selectedIds: new Set(["u-2"]) });

    expect(hook.current.selectedCount).toBe(1);
    expect(hook.current.sqlUpdatePreview).toBe("");
    expect(hook.current.sqlInsertPreview).toBe("");
  });

  it("should expose the new preview once it arrives after selectedIds changed", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult({ sqlUpdatePreview: "FIRST" }));
    const { hook, render, rerender } = setup(makeParams([upd(1), upd(2)], ["u-1"]));
    await settle();
    render();

    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult({ sqlUpdatePreview: "SECOND" }));
    rerender({ selectedIds: new Set(["u-2"]) });
    expect(hook.current.sqlUpdatePreview).toBe("");
    await settle();
    render();

    expect(hook.current.sqlUpdatePreview).toBe("SECOND");
  });

  it("should not expose a preview generated for a previous summary until regenerated, even with the same selectedIds reference", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult({ sqlUpdatePreview: "OLD" }));
    const initial = makeParams([upd(1)], ["u-1"]);
    const { hook, render, rerender } = setup(initial);
    await settle();
    render();
    expect(hook.current.sqlUpdatePreview).toBe("OLD");

    bridge.generateSqlPatchesInWorker.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ summary: { ...initial.summary } });

    expect(hook.current.selectedCount).toBe(1);
    expect(hook.current.sqlUpdatePreview).toBe("");
    expect(hook.current.sqlInsertPreview).toBe("");
  });

  it("should expose the regenerated preview after the summary identity changed", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult({ sqlUpdatePreview: "OLD" }));
    const initial = makeParams([upd(1)], ["u-1"]);
    const { hook, render, rerender } = setup(initial);
    await settle();
    render();

    bridge.generateSqlPatchesInWorker.mockResolvedValueOnce(patchResult({ sqlUpdatePreview: "NEW" }));
    rerender({ summary: { ...initial.summary } });
    await settle();
    render();

    expect(hook.current.sqlUpdatePreview).toBe("NEW");
  });

  it("should keep the preview when re-rendered with the same selectedIds identity", async () => {
    bridge.generateSqlPatchesInWorker.mockResolvedValue(patchResult());
    const { hook, render } = setup(makeParams([upd(1)], ["u-1"]));
    await settle();
    render();
    render();
    expect(hook.current.sqlUpdatePreview).toBe("UPDATE preview");
  });
});
