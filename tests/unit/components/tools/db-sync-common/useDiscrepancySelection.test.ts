import { describe, it, expect } from "vitest";
import { vi } from "vitest";

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

import {
  useDiscrepancySelection,
  type UseDiscrepancySelectionParams,
} from "@/components/tools/db-sync-common/discrepancies-table/useDiscrepancySelection";
import {
  DiscrepancyType,
  PairingMethod,
  type DiscrepancyItem,
} from "@/core/types/comparison";

const runHook = useDiscrepancySelection;
const PK = "gid";

function mk(id: string, type: DiscrepancyType = DiscrepancyType.ATTRIBUTE_MISMATCH): DiscrepancyItem {
  return { id, suid: `S-${id}`, type, differences: [] };
}

function unkeyed(id: string): DiscrepancyItem {
  return {
    ...mk(id),
    dbRecord: { [PK]: null },
    pairing: { method: PairingMethod.GEOMETRY, dbCount: 1, fileCount: 1 },
  };
}

function setup(initial: UseDiscrepancySelectionParams) {
  h.reset();
  let params = initial;
  const hook = { current: undefined as unknown as ReturnType<typeof runHook> };
  const render = () => {
    h.begin();
    hook.current = runHook(params);
  };
  const rerender = (next: Partial<UseDiscrepancySelectionParams>) => {
    params = { ...params, ...next };
    render();
    render();
  };
  render();
  render();
  return { hook, rerender, render };
}

describe("useDiscrepancySelection", () => {
  const items = [mk("a"), mk("b"), mk("c"), mk("d", DiscrepancyType.ONLY_IN_DB), unkeyed("u")];

  it("should select every selectable enabled item at version 1 after the first items load", () => {
    const { hook } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    expect([...hook.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
    expect(hook.current.selectionVersion).toBe(1);
  });

  it("should exclude unkeyed paired and non-selectable items from the default all-selection", () => {
    const { hook } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    expect(hook.current.selectedIds.has("u")).toBe(false);
    expect(hook.current.selectedIds.has("d")).toBe(false);
    expect(hook.current.selectedIds.size).toBe(hook.current.selectableCount);
  });

  it("should count only enabled selectable items as selectableCount", () => {
    const { hook } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    expect(hook.current.selectableCount).toBe(3);
  });

  it("should report zero selectable and an empty selection when items are undefined", () => {
    const { hook } = setup({ items: undefined, comparisonKey: "k1" });
    expect(hook.current.selectionVersion).toBe(0);
    expect(hook.current.selectableCount).toBe(0);
    expect(hook.current.selectedIds.size).toBe(0);
  });

  it("should toggle an id off and on and bump the version each time", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.toggle("a");
    render();
    expect(hook.current.selectedIds.has("a")).toBe(false);
    expect(hook.current.selectionVersion).toBe(2);

    hook.current.toggle("a");
    render();
    expect(hook.current.selectedIds.has("a")).toBe(true);
    expect(hook.current.selectionVersion).toBe(3);
  });

  it("should select only ids that are selectable and enabled", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.clear();
    render();
    hook.current.select(["a", "d", "u", "ghost"]);
    render();
    expect([...hook.current.selectedIds]).toEqual(["a"]);
  });

  it("should not bump the version when select adds nothing new", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.clear();
    hook.current.select(["a", "b"]);
    render();
    const versionAfterFirst = hook.current.selectionVersion;
    const refAfterFirst = hook.current.selectedIds;

    hook.current.select(["a", "b"]);
    hook.current.select(["d", "u"]);
    hook.current.select([]);
    render();

    expect(hook.current.selectionVersion).toBe(versionAfterFirst);
    expect(hook.current.selectedIds).toBe(refAfterFirst);
  });

  it("should deselect ids and not bump the version when nothing is removed", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.deselect(["a"]);
    render();
    expect([...hook.current.selectedIds].sort()).toEqual(["b", "c"]);
    const version = hook.current.selectionVersion;

    hook.current.deselect(["zzz"]);
    render();
    expect(hook.current.selectionVersion).toBe(version);
  });

  it("should clear the selection, and not bump the version when already empty", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.clear();
    render();
    expect(hook.current.selectedIds.size).toBe(0);
    expect(hook.current.selectionVersion).toBe(2);

    hook.current.clear();
    render();
    expect(hook.current.selectionVersion).toBe(2);

    hook.current.select(["a"]);
    render();
    hook.current.clear();
    render();
    expect(hook.current.selectedIds.size).toBe(0);
    expect(hook.current.selectionVersion).toBe(4);
  });

  it("should support selecting every selectable id", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.clear();
    render();
    hook.current.select(items.map((i) => i.id));
    render();
    expect(hook.current.selectedIds.size).toBe(hook.current.selectableCount);
  });

  it("should reset to select-all of the new items and bump the version when comparisonKey changes", () => {
    const { hook, render, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.deselect(["a"]);
    render();
    const before = hook.current.selectionVersion;

    rerender({ items: [mk("a"), mk("b"), mk("n")], comparisonKey: "k2" });

    expect([...hook.current.selectedIds].sort()).toEqual(["a", "b", "n"]);
    expect(hook.current.selectionVersion).toBe(before + 1);
  });

  it("should bump the version exactly once on a new comparison even when the selection is unchanged", () => {
    const { hook, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    const before = hook.current.selectionVersion;
    rerender({ items: [mk("a")], comparisonKey: "k2" });
    expect(hook.current.selectionVersion).toBe(before + 1);
  });

  it("should prune ids that disappear when items change under the same key and bump the version", () => {
    const { hook, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    const before = hook.current.selectionVersion;

    rerender({ items: [mk("a"), mk("c")] });

    expect([...hook.current.selectedIds].sort()).toEqual(["a", "c"]);
    expect(hook.current.selectionVersion).toBe(before + 1);
  });

  it("should keep the selection reference but bump the version when new items still contain every selected id", () => {
    const { hook, render, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.clear();
    hook.current.select(["a"]);
    render();
    const ref = hook.current.selectedIds;
    const before = hook.current.selectionVersion;

    rerender({ items: [mk("a"), mk("z")] });

    expect(hook.current.selectedIds).toBe(ref);
    expect(hook.current.selectionVersion).toBe(before + 1);
  });

  it("should bump the version when a new items array has the same ids but different content", () => {
    const { hook, rerender } = setup({
      items: [mk("a"), mk("b")],
      comparisonKey: "k1",
      primaryKeyColumn: PK,
    });
    const before = hook.current.selectionVersion;

    rerender({ items: [mk("a", DiscrepancyType.ONLY_IN_SHP), mk("b")] });

    expect(hook.current.selectionVersion).toBe(before + 1);
  });

  it("should prune selected ids that become blocked after a primary key change", () => {
    const { hook, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });

    rerender({ items: [unkeyed("a")] });

    expect(hook.current.selectedIds.size).toBe(0);
  });

  it("should not touch the selection when items are re-rendered with the same array reference", () => {
    const { hook, render } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.deselect(["c"]);
    render();
    const version = hook.current.selectionVersion;
    render();
    render();
    expect(hook.current.selectionVersion).toBe(version);
    expect([...hook.current.selectedIds].sort()).toEqual(["a", "b"]);
  });

  it("should keep the pruned user selection and not re-select all when the same comparison is re-analysed", () => {
    const { hook, render, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.deselect(["a", "b"]);
    render();

    rerender({ items: [mk("a"), mk("b"), mk("c"), mk("d", DiscrepancyType.ONLY_IN_DB)] });

    expect([...hook.current.selectedIds]).toEqual(["c"]);
  });

  it("should keep an emptied selection empty when the same comparison is re-analysed", () => {
    const { hook, render, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });
    hook.current.clear();
    render();

    rerender({ items: [mk("a"), mk("b"), mk("c")] });

    expect(hook.current.selectedIds.size).toBe(0);
  });

  it("should not auto-select a newly selectable id that appears under the same comparison key", () => {
    const { hook, rerender } = setup({ items, comparisonKey: "k1", primaryKeyColumn: PK });

    rerender({ items: [...items, mk("new")] });

    expect(hook.current.selectedIds.has("new")).toBe(false);
    expect(hook.current.selectableCount).toBe(4);
    expect([...hook.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
  });
});
