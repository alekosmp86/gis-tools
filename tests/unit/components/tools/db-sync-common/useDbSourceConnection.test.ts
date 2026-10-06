import { describe, it, expect, vi } from "vitest";
import type { DbColumnMetadata, DbConfig, DbConnectionStatusPayload } from "@/core/types/db";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";

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
    useRef<T>(init: T) {
      const i = idx++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i] as { current: T };
    },
  };
});

vi.mock("react", () => ({ useState: h.useState, useRef: h.useRef }));

function renderHook<R>(fn: () => R) {
  h.reset();
  const result = { current: undefined as unknown as R };
  const render = () => {
    h.begin();
    result.current = fn();
  };
  render();
  return {
    result,
    act(cb: () => void) {
      cb();
      render();
    },
  };
}

const config = { host: "h" } as unknown as DbConfig;
const details = [{ name: "c" }] as unknown as DbColumnMetadata[];
const status = (isConnected: boolean, columns: string[]) =>
  ({ isConnected, columns }) as unknown as DbConnectionStatusPayload;

describe("useDbSourceConnection", () => {
  it("should expose empty initial state and a null form ref", () => {
    const { result } = renderHook(() => useDbSourceConnection(vi.fn()));
    expect(result.current.dbConfig).toBeNull();
    expect(result.current.dbColumns).toEqual([]);
    expect(result.current.columnDetails).toEqual([]);
    expect(result.current.isDbConnected).toBe(false);
    expect(result.current.dbFormRef.current).toBeNull();
  });

  it("should store config, columns and details and call onConnected once on success", () => {
    const onConnected = vi.fn();
    const { result, act } = renderHook(() => useDbSourceConnection(onConnected));
    act(() => result.current.handleDbSuccess(config, ["a", "b"], 10, details));
    expect(result.current.dbConfig).toBe(config);
    expect(result.current.dbColumns).toEqual(["a", "b"]);
    expect(result.current.columnDetails).toBe(details);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("should default column details to an empty array when omitted", () => {
    const { result, act } = renderHook(() => useDbSourceConnection(vi.fn()));
    act(() => result.current.handleDbSuccess(config, ["a"], 1, details));
    act(() => result.current.handleDbSuccess(config, ["a"], 1));
    expect(result.current.columnDetails).toEqual([]);
  });

  it("should mark connected only when connected with at least one column", () => {
    const { result, act } = renderHook(() => useDbSourceConnection(vi.fn()));
    act(() => result.current.handleDbStatusChange(status(true, ["a"])));
    expect(result.current.isDbConnected).toBe(true);
  });

  it("should not mark connected when connected without columns", () => {
    const { result, act } = renderHook(() => useDbSourceConnection(vi.fn()));
    act(() => result.current.handleDbStatusChange(status(true, [])));
    expect(result.current.isDbConnected).toBe(false);
  });

  it("should clear connected flag when status reports not connected", () => {
    const { result, act } = renderHook(() => useDbSourceConnection(vi.fn()));
    act(() => result.current.handleDbStatusChange(status(true, ["a"])));
    act(() => result.current.handleDbStatusChange(status(false, ["a"])));
    expect(result.current.isDbConnected).toBe(false);
  });
});
