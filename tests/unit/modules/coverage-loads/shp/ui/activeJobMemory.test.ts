import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeJobMemory } from "@/modules/coverage-loads/shp/ui/shpBrowserAlerts.ts";

function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    ...overrides,
  } as unknown as Storage;
}

describe("activeJobMemory", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should read null when nothing was remembered", () => {
    expect(activeJobMemory.read()).toBeNull();
  });

  it("should remember and then forget the active job", () => {
    activeJobMemory.remember("job-1");
    expect(activeJobMemory.read()).toBe("job-1");

    activeJobMemory.forget();

    expect(activeJobMemory.read()).toBeNull();
  });

  it("should track the notified job independently of the active one", () => {
    activeJobMemory.remember("job-1");
    activeJobMemory.markNotified("job-2");

    expect(activeJobMemory.wasNotified("job-2")).toBe(true);
    expect(activeJobMemory.wasNotified("job-1")).toBe(false);
    expect(activeJobMemory.read()).toBe("job-1");
  });

  it("should degrade silently when storage throws", () => {
    const boom = (): never => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", { localStorage: fakeStorage({ getItem: boom, setItem: boom, removeItem: boom }) });

    expect(() => activeJobMemory.remember("job-1")).not.toThrow();
    expect(() => activeJobMemory.forget()).not.toThrow();
    expect(activeJobMemory.read()).toBeNull();
    expect(activeJobMemory.wasNotified("job-1")).toBe(false);
  });
});
