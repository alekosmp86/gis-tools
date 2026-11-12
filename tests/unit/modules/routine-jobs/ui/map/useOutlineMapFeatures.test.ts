import { describe, expect, it, vi } from "vitest";
import { MapLoadStatus, useOutlineMapFeatures, type FetchOutlines } from "@/modules/routine-jobs/ui/map/useOutlineMapFeatures";
import type { OutlineFeature } from "@/modules/routine-jobs/ui/map/outlineTypes";

/** No DOM/renderHook lib installed: the react hooks are replaced by a minimal slot-based runtime that re-renders until stable. */
const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  const depSlots: Array<readonly unknown[] | undefined> = [];
  let index = 0;
  let dirty = false;
  let queued: Array<() => void> = [];
  const sameDeps = (left: readonly unknown[] | undefined, right: readonly unknown[]): boolean =>
    left !== undefined && left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
  const memo = <T>(factory: () => T, deps: readonly unknown[]): T => {
    const slot = index++;
    if (!sameDeps(depSlots[slot], deps)) {
      slots[slot] = factory();
      depSlots[slot] = deps;
    }
    return slots[slot] as T;
  };
  return {
    reset() {
      slots.length = 0;
      depSlots.length = 0;
      index = 0;
      dirty = false;
      queued = [];
    },
    begin() {
      index = 0;
    },
    takeDirty(): boolean {
      const was = dirty;
      dirty = false;
      return was;
    },
    takeEffects(): Array<() => void> {
      const taken = queued;
      queued = [];
      return taken;
    },
    useState<T>(init: T | (() => T)) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof init === "function" ? (init as () => T)() : init;
      const set = (value: T | ((previous: T) => T)) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slots[slot] as T) : value;
        if (!Object.is(next, slots[slot])) dirty = true;
        slots[slot] = next;
      };
      return [slots[slot] as T, set] as const;
    },
    useRef<T>(init: T) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: init };
      return slots[slot] as { current: T };
    },
    useMemo: memo,
    useCallback<T>(callback: T, deps: readonly unknown[]): T {
      return memo(() => callback, deps);
    },
    useEffect(effect: () => void, deps: readonly unknown[]) {
      const slot = index++;
      if (!sameDeps(depSlots[slot], deps)) {
        depSlots[slot] = deps;
        queued.push(effect);
      }
    },
  };
});

vi.mock("react", () => ({
  useState: runtime.useState,
  useRef: runtime.useRef,
  useMemo: runtime.useMemo,
  useCallback: runtime.useCallback,
  useEffect: runtime.useEffect,
}));

const LINE = { type: "LineString" as const, coordinates: [[-56.1, -34.9], [-56.0, -34.9]] };
const SCOPE = "db.local|5432|gis|user";
const ITEM_A = { oldRef: 1 };
const ITEM_B = { newRef: "2" };

const featureOf = (itemIndex: number, role: OutlineFeature["role"] = "new"): OutlineFeature => ({
  itemIndex,
  role,
  label: `item ${itemIndex}`,
  geometry: LINE,
});

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};

/** Renders the hook again until no state changes and no effect is left to run. */
function renderHook<Item>(items: readonly Item[], scope: string, fetchOutlines: FetchOutlines<Item>) {
  const render = () => {
    let result!: ReturnType<typeof useOutlineMapFeatures>;
    for (let pass = 0; pass < 25; pass++) {
      runtime.begin();
      result = useOutlineMapFeatures(items, scope, fetchOutlines);
      const effects = runtime.takeEffects();
      effects.forEach((effect) => effect());
      if (!runtime.takeDirty() && effects.length === 0) break;
    }
    return result;
  };
  return render;
}

describe("useOutlineMapFeatures (EM-2)", () => {
  it("should be loading until the outlines arrive, then number the features by request item", async () => {
    runtime.reset();
    const fetchOutlines = vi.fn(async () => [featureOf(0, "old"), featureOf(1)]);
    const render = renderHook([ITEM_A, ITEM_B], SCOPE, fetchOutlines);

    expect(render().status).toBe(MapLoadStatus.LOADING);
    await settle();
    const ready = render();

    expect(fetchOutlines).toHaveBeenCalledTimes(1);
    expect(fetchOutlines).toHaveBeenCalledWith([ITEM_A, ITEM_B]);
    expect(ready.status).toBe(MapLoadStatus.READY);
    expect(ready.features.map((feature) => feature.itemIndex)).toEqual([0, 1]);
  });

  it("should not fetch again for the items it already holds", async () => {
    runtime.reset();
    const fetchOutlines = vi.fn(async () => [featureOf(0, "old"), featureOf(1)]);
    const render = renderHook([ITEM_A, ITEM_B], SCOPE, fetchOutlines);

    render();
    await settle();
    render();
    render();

    expect(fetchOutlines).toHaveBeenCalledTimes(1);
  });

  it("should request only the items that are not cached yet", async () => {
    runtime.reset();
    const fetchOutlines = vi.fn(async (items: unknown[]) => items.map((_, index) => featureOf(index)));
    renderHook([ITEM_A], SCOPE, fetchOutlines)();
    await settle();

    const second = renderHook([ITEM_A, ITEM_B], SCOPE, fetchOutlines);
    second();
    await settle();
    const ready = second();

    expect(fetchOutlines).toHaveBeenNthCalledWith(2, [ITEM_B]);
    expect(ready.status).toBe(MapLoadStatus.READY);
    expect(ready.features.map((feature) => feature.itemIndex)).toEqual([0, 1]);
  });

  it("should report the error message and fetch again after a retry", async () => {
    runtime.reset();
    const fetchOutlines = vi
      .fn<FetchOutlines<typeof ITEM_A>>()
      .mockRejectedValueOnce(new Error("sin conexión"))
      .mockResolvedValueOnce([featureOf(0, "old")]);
    const render = renderHook([ITEM_A], SCOPE, fetchOutlines);

    render();
    await settle();
    const failed = render();

    expect(failed.status).toBe(MapLoadStatus.ERROR);
    expect(failed.message).toBe("sin conexión");

    failed.retry();
    render();
    await settle();
    const ready = render();

    expect(fetchOutlines).toHaveBeenCalledTimes(2);
    expect(ready.status).toBe(MapLoadStatus.READY);
  });

  it("should never reuse an outline cached under another scope", async () => {
    runtime.reset();
    const fetchOutlines = vi.fn(async () => [featureOf(0, "old")]);
    renderHook([ITEM_A], SCOPE, fetchOutlines)();
    await settle();

    const other = renderHook([ITEM_A], "other|5432|gis|user", fetchOutlines);

    expect(other().status).toBe(MapLoadStatus.LOADING);
    await settle();
    expect(fetchOutlines).toHaveBeenCalledTimes(2);
  });
});
