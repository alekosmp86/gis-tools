import { afterEach, describe, expect, it, vi } from "vitest";
import { installFatalGuard } from "@/modules/coverage-loads/shp/job/fatalGuard.ts";
import { createScrubber } from "@/modules/coverage-loads/shp/job/scrub.ts";
import type { Guard } from "@/modules/coverage-loads/shp/job/fatalGuard.ts";

type Handler = (error: unknown) => void;

/**
 * Captures the guard's handlers instead of emitting real process events (which vitest would
 * report as errors). `process.on/off` are spied for the duration of one test.
 */
function captureProcessHooks() {
  const handlers = new Map<string, Handler>();
  const on = vi.spyOn(process, "on").mockImplementation(((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return process;
  }) as never);
  const off = vi.spyOn(process, "off").mockImplementation(((event: string, handler: Handler) => {
    if (handlers.get(event) === handler) handlers.delete(event);
    return process;
  }) as never);
  return { handlers, on, off };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("installFatalGuard", () => {
  it("should register uncaughtException and unhandledRejection handlers", () => {
    const hooks = captureProcessHooks();

    const guard = installFatalGuard(createScrubber([]));

    expect([...hooks.handlers.keys()].sort()).toEqual(["uncaughtException", "unhandledRejection"]);
    guard.dispose();
  });

  it("should resolve a FAILED JOB_UNCAUGHT outcome on an uncaught exception", async () => {
    const hooks = captureProcessHooks();
    const guard = installFatalGuard(createScrubber([]));

    hooks.handlers.get("uncaughtException")!(new Error("kaboom"));

    await expect(guard.promise).resolves.toEqual({ kind: "FAILED", error: { code: "JOB_UNCAUGHT", message: "kaboom" } });
    guard.dispose();
  });

  it("should resolve a FAILED outcome on an unhandled rejection with an Error", async () => {
    const hooks = captureProcessHooks();
    const guard = installFatalGuard(createScrubber([]));

    hooks.handlers.get("unhandledRejection")!(new Error("rejected"));

    await expect(guard.promise).resolves.toMatchObject({ kind: "FAILED", error: { code: "JOB_UNCAUGHT", message: "rejected" } });
    guard.dispose();
  });

  it("should use a Spanish fallback message when the reason is not an Error", async () => {
    const hooks = captureProcessHooks();
    const guard = installFatalGuard(createScrubber([]));

    hooks.handlers.get("unhandledRejection")!("plain string");

    await expect(guard.promise).resolves.toEqual({
      kind: "FAILED",
      error: { code: "JOB_UNCAUGHT", message: "Error no controlado en el proceso de carga." },
    });
    guard.dispose();
  });

  it("should scrub secrets out of the failure message", async () => {
    const hooks = captureProcessHooks();
    const guard = installFatalGuard(createScrubber(["s3cr3t"]));

    hooks.handlers.get("uncaughtException")!(new Error("login failed with s3cr3t"));

    const outcome = await guard.promise;
    expect(outcome).toEqual({ kind: "FAILED", error: { code: "JOB_UNCAUGHT", message: "login failed with ***" } });
    guard.dispose();
  });

  it("should keep the first outcome when several errors arrive", async () => {
    const hooks = captureProcessHooks();
    const guard = installFatalGuard(createScrubber([]));

    hooks.handlers.get("uncaughtException")!(new Error("first"));
    hooks.handlers.get("unhandledRejection")!(new Error("second"));

    await expect(guard.promise).resolves.toMatchObject({ error: { message: "first" } });
    guard.dispose();
  });

  it("should remove both handlers on dispose", () => {
    const hooks = captureProcessHooks();
    const guard: Guard = installFatalGuard(createScrubber([]));

    guard.dispose();

    expect(hooks.handlers.size).toBe(0);
    expect(hooks.off).toHaveBeenCalledTimes(2);
  });

  it("should leave the real process listener counts unchanged after dispose", () => {
    const before = [process.listenerCount("uncaughtException"), process.listenerCount("unhandledRejection")];

    installFatalGuard(createScrubber([])).dispose();

    expect([process.listenerCount("uncaughtException"), process.listenerCount("unhandledRejection")]).toEqual(before);
  });
});
