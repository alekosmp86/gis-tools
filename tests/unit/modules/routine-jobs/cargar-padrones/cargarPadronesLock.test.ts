import { describe, it, expect, vi } from "vitest";
import { acquireLock } from "@/modules/routine-jobs/jobs/cargar-padrones/services/cargarPadronesLock";

describe("cargarPadronesLock", () => {
  it("AC-19: should grant the lock when the key is free", () => {
    const release = acquireLock("lock-free:5432|gis|cat|padron");

    expect(release).toBeTypeOf("function");
    release?.();
  });

  it("AC-19: should refuse a second acquire of the same key while it is held", () => {
    const key = "lock-held:5432|gis|cat|padron";
    const release = acquireLock(key);

    const second = acquireLock(key);

    expect(second).toBeNull();
    release?.();
  });

  it("AC-19: should free the key once the lock is released", () => {
    const key = "lock-release:5432|gis|cat|padron";
    acquireLock(key)?.();

    const again = acquireLock(key);

    expect(again).toBeTypeOf("function");
    again?.();
  });

  it("AC-19: should keep locks of different targets independent", () => {
    const first = acquireLock("lock-ind:5432|gis|cat|padron_a");

    const other = acquireLock("lock-ind:5432|gis|cat|padron_b");

    expect(other).toBeTypeOf("function");
    first?.();
    other?.();
  });

  it("AC-19: should keep a held lock across module re-evaluation and free it on release", async () => {
    const key = "lock-reload:5432|gis|cat|padron";
    const release = acquireLock(key);
    vi.resetModules();

    const reloaded = await import("@/modules/routine-jobs/jobs/cargar-padrones/services/cargarPadronesLock");

    expect(reloaded.acquireLock(key)).toBeNull();
    release?.();
    const again = reloaded.acquireLock(key);
    expect(again).toBeTypeOf("function");
    again?.();
  });

  it("AC-19: should keep the lock held for the other key after one is released", () => {
    const keyA = "lock-two:5432|gis|cat|a";
    const keyB = "lock-two:5432|gis|cat|b";
    const releaseA = acquireLock(keyA);
    const releaseB = acquireLock(keyB);

    releaseA?.();

    expect(acquireLock(keyB)).toBeNull();
    releaseB?.();
  });
});
