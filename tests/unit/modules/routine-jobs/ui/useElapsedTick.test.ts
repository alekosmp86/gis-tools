import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElapsedTick } from "@/modules/routine-jobs/ui/useElapsedTick";

/** No DOM/renderHook lib installed: react hooks are replaced by a minimal slot-based shim (same pattern as the db-sync hooks). */
const shim = vi.hoisted(() => {
  const slots: unknown[] = [];
  const depSlots: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let index = 0;
  let dirty = false;
  const sameDeps = (left: readonly unknown[] | undefined, right: readonly unknown[]): boolean =>
    left !== undefined && left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
  return {
    reset() {
      slots.length = 0;
      depSlots.length = 0;
      cleanups.length = 0;
      index = 0;
      dirty = false;
    },
    begin() {
      index = 0;
    },
    takeDirty(): boolean {
      const was = dirty;
      dirty = false;
      return was;
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
    useEffect(effect: () => (() => void) | undefined, deps: readonly unknown[]) {
      const slot = index++;
      if (sameDeps(depSlots[slot], deps)) return;
      cleanups[slot]?.();
      depSlots[slot] = deps;
      cleanups[slot] = effect();
    },
  };
});

vi.mock("react", () => ({ useState: shim.useState, useEffect: shim.useEffect }));

function renderHook<R>(hook: () => R) {
  shim.reset();
  const result = { current: undefined as unknown as R };
  const render = () => {
    shim.begin();
    result.current = hook();
  };
  render();
  while (shim.takeDirty()) render();
  return {
    result,
    rerender() {
      render();
      while (shim.takeDirty()) render();
    },
  };
}

const START_MS = 1_700_000_000_000;

describe("useElapsedTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return the current time without ticking while no run is active", () => {
    const { result, rerender } = renderHook(() => useElapsedTick(false));

    vi.advanceTimersByTime(5_000);
    rerender();

    expect(result.current).toBe(START_MS);
  });

  it("should return the current time right away while a run is active", () => {
    const { result } = renderHook(() => useElapsedTick(true));

    expect(result.current).toBe(START_MS);
  });

  it("should advance the returned time by one second per tick while a run is active", () => {
    const { result, rerender } = renderHook(() => useElapsedTick(true));

    vi.advanceTimersByTime(1_000);
    rerender();
    expect(result.current).toBe(START_MS + 1_000);

    vi.advanceTimersByTime(2_000);
    rerender();
    expect(result.current).toBe(START_MS + 3_000);
  });

  it("should stop ticking once the run is no longer active", () => {
    let active = true;
    const { result, rerender } = renderHook(() => useElapsedTick(active));
    vi.advanceTimersByTime(1_000);
    rerender();
    const frozen = result.current;

    active = false;
    rerender();
    vi.advanceTimersByTime(10_000);
    rerender();

    expect(result.current).toBe(frozen);
  });
});
