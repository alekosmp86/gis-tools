import { describe, it, expect, vi } from "vitest";

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

import { useDiscrepanciesTableData } from "@/components/tools/db-sync-common/discrepancies-table/useDiscrepanciesTableData";
import {
  DiscrepancyFilter,
  DiscrepancyType,
  PairingMethod,
  type DiscrepancyItem,
} from "@/core/types/comparison";

const runHook = useDiscrepanciesTableData;
const PK = "gid";

function mk(i: number, type: DiscrepancyType = DiscrepancyType.ATTRIBUTE_MISMATCH): DiscrepancyItem {
  return { id: `id-${i}`, suid: `S-${i}`, type, differences: [] };
}

function many(count: number, type?: DiscrepancyType): DiscrepancyItem[] {
  return Array.from({ length: count }, (_, i) => mk(i, type));
}

type Params = Parameters<typeof runHook>[0];

function setup(initial: Params) {
  h.reset();
  let params = initial;
  const hook = { current: undefined as unknown as ReturnType<typeof runHook> };
  const render = () => {
    h.begin();
    hook.current = runHook(params);
  };
  const rerender = (next: Partial<Params>) => {
    params = { ...params, ...next };
    render();
    render();
  };
  render();
  return { hook, render, rerender };
}

const base = { activeFilter: DiscrepancyFilter.ALL, searchQuery: "", primaryKeyColumn: PK };

describe("useDiscrepanciesTableData selectable ids", () => {
  it("should return empty id lists for no items", () => {
    const { hook } = setup({ ...base, items: [] });
    expect(hook.current.filteredSelectableIds).toEqual([]);
    expect(hook.current.pageSelectableIds).toEqual([]);
  });

  it("should include only selectable enabled items", () => {
    const items = [
      mk(0),
      mk(1, DiscrepancyType.ONLY_IN_DB),
      mk(2, DiscrepancyType.ONLY_IN_SHP),
      mk(3, DiscrepancyType.MATCH),
      {
        ...mk(4),
        dbRecord: { [PK]: null },
        pairing: { method: PairingMethod.EXACT, dbCount: 1, fileCount: 1 },
      },
    ];
    const { hook } = setup({ ...base, items });
    expect(hook.current.filteredSelectableIds).toEqual(["id-0", "id-2"]);
  });

  it("should put everything on the page when items fit within 50", () => {
    const { hook } = setup({ ...base, items: many(50) });
    expect(hook.current.pageSelectableIds).toHaveLength(50);
    expect(hook.current.filteredSelectableIds).toHaveLength(50);
    expect(hook.current.paginationProps.totalPages).toBe(1);
  });

  it("should limit the page ids to 50 when there are 51 items while the filter ids keep all 51", () => {
    const { hook } = setup({ ...base, items: many(51) });
    expect(hook.current.pageSelectableIds).toHaveLength(50);
    expect(hook.current.filteredSelectableIds).toHaveLength(51);
    expect(hook.current.pageSelectableIds[49]).toBe("id-49");
    expect(hook.current.paginationProps.totalPages).toBe(2);
  });

  it("should move to the second page ids on page change", () => {
    const { hook, render } = setup({ ...base, items: many(51) });
    hook.current.paginationProps.onPageChange(2);
    render();
    expect(hook.current.pageSelectableIds).toEqual(["id-50"]);
    expect(hook.current.filteredSelectableIds).toHaveLength(51);
  });

  it("should exclude items hidden by the type filter from both lists", () => {
    const items = [
      mk(0, DiscrepancyType.ATTRIBUTE_MISMATCH),
      mk(1, DiscrepancyType.GEOMETRY_MISMATCH),
      mk(2, DiscrepancyType.GEOMETRY_MISMATCH),
    ];
    const { hook } = setup({
      ...base,
      items,
      activeFilter: DiscrepancyFilter.GEOMETRY_MISMATCH,
    });
    expect(hook.current.filteredSelectableIds).toEqual(["id-1", "id-2"]);
    expect(hook.current.pageSelectableIds).toEqual(["id-1", "id-2"]);
  });

  it("should exclude items hidden by the search query", () => {
    const { hook } = setup({ ...base, items: many(5), searchQuery: "s-3" });
    expect(hook.current.filteredSelectableIds).toEqual(["id-3"]);
  });

  it("should return no selectable ids when the filter shows only non-selectable types", () => {
    const { hook } = setup({
      ...base,
      items: [mk(0), mk(1, DiscrepancyType.ONLY_IN_DB)],
      activeFilter: DiscrepancyFilter.ONLY_IN_DB,
    });
    expect(hook.current.filteredSelectableIds).toEqual([]);
    expect(hook.current.pageSelectableIds).toEqual([]);
    expect(hook.current.totalFilteredCount).toBe(1);
  });

  it("should reset to page 1 when the filter changes", () => {
    const { hook, render, rerender } = setup({ ...base, items: many(120) });
    hook.current.paginationProps.onPageChange(3);
    render();
    expect(hook.current.paginationProps.currentPage).toBe(3);
    rerender({ searchQuery: "S-1" });
    expect(hook.current.paginationProps.currentPage).toBe(1);
  });
});
