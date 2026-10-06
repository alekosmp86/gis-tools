import { describe, it, expect, vi } from "vitest";
import type { ColumnMappingConfig } from "@/core/types/comparison";
import { useWizardMappingState } from "@/components/tools/db-sync-common/useWizardMappingState";

/** No DOM/renderHook lib installed: react hooks are replaced by a minimal slot-based shim. */
const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  let idx = 0;
  let dirty = false;
  return {
    reset() {
      slots.length = 0;
      idx = 0;
      dirty = false;
    },
    begin() {
      idx = 0;
      dirty = false;
    },
    isDirty: () => dirty,
    useState<T>(init: T | (() => T)) {
      const i = idx++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => T)() : init;
      const set = (v: T | ((p: T) => T)) => {
        slots[i] = typeof v === "function" ? (v as (p: T) => T)(slots[i] as T) : v;
        dirty = true;
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

const cfg = (o: Record<string, unknown>) => o as unknown as ColumnMappingConfig;

describe("useWizardMappingState", () => {
  it("should start at step 1 with no mapping config and mapping ready", () => {
    const { result } = renderHook(() => useWizardMappingState());
    expect(result.current.currentStep).toBe(1);
    expect(result.current.mappingConfig).toBeNull();
    expect(result.current.isMappingReady).toBe(true);
  });

  it("should start with null refs that stay stable across renders", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    const { suidMappingRef, syncParametersRef } = result.current;
    expect(suidMappingRef.current).toBeNull();
    expect(syncParametersRef.current).toBeNull();
    act(() => result.current.setCurrentStep(3));
    expect(result.current.suidMappingRef).toBe(suidMappingRef);
    expect(result.current.syncParametersRef).toBe(syncParametersRef);
  });

  it("should move to step 4 and store config when mapping succeeds with no previous config", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    act(() => result.current.handleMappingSuccess(cfg({ suid: "a" })));
    expect(result.current.mappingConfig).toEqual({ suid: "a" });
    expect(result.current.currentStep).toBe(4);
  });

  it("should merge previous config with new one, new keys winning, on mapping success", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    act(() => result.current.handleMappingSuccess(cfg({ suid: "a", keep: 1 })));
    act(() => result.current.handleMappingSuccess(cfg({ suid: "b", extra: 2 })));
    expect(result.current.mappingConfig).toEqual({ suid: "b", keep: 1, extra: 2 });
    expect(result.current.currentStep).toBe(4);
  });

  it("should replace config rather than merge and move to step 5 on sync parameters success", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    act(() => result.current.handleMappingSuccess(cfg({ suid: "a", keep: 1 })));
    act(() => result.current.handleSyncParametersSuccess(cfg({ only: true })));
    expect(result.current.mappingConfig).toEqual({ only: true });
    expect(result.current.currentStep).toBe(5);
  });

  it("should move backwards on step click", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    act(() => result.current.setCurrentStep(4));
    act(() => result.current.handleStepClick(2));
    expect(result.current.currentStep).toBe(2);
  });

  it("should ignore step click for equal or greater step ids", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    act(() => result.current.setCurrentStep(3));
    act(() => result.current.handleStepClick(3));
    expect(result.current.currentStep).toBe(3);
    act(() => result.current.handleStepClick(5));
    expect(result.current.currentStep).toBe(3);
  });

  it("should update step and mapping readiness through their setters", () => {
    const { result, act } = renderHook(() => useWizardMappingState());
    act(() => result.current.setCurrentStep(2));
    act(() => result.current.setIsMappingReady(false));
    expect(result.current.currentStep).toBe(2);
    expect(result.current.isMappingReady).toBe(false);
  });
});
