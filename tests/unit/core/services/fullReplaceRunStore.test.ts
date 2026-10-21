import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DbConfig } from "@/core/types/db";

const runMock = vi.hoisted(() => vi.fn());

vi.mock("@/core/services/fullReplaceService", () => ({ runFullReplace: runMock }));

type Store = typeof import("@/core/services/fullReplaceRunStore");

const cfg = (over: Record<string, unknown>) =>
  ({ host: "h", port: 5432, db_name: "d", table_name: "t", schema_name: "geo", user: "u", ...over }) as unknown as DbConfig;

const mapping = { sourceByTarget: { id: "id" }, defaults: {} };
const params = (password = "pw") => ({
  sourceConfig: cfg({ host: "src", db_name: "sdb", table_name: "a", schema_name: "" }),
  targetConfig: cfg({ host: "tgt", port: 6543, db_name: "tdb", table_name: "b", schema_name: "geo" }),
  password,
  sourceColumns: ["id"],
  targetColumns: ["id"],
  mapping,
  sequences: [],
  resetSequences: true,
});

const outcome = { sourceRows: 3, insertedRows: 3, errorCount: 0, errors: [], ignoredSourceColumns: [], targetModified: true, sequencesAdjusted: [], analyze: { status: "ok" as const } };

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("fullReplaceRunStore", () => {
  let store: Store;
  const add = vi.fn();
  const remove = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    runMock.mockReset();
    add.mockReset();
    remove.mockReset();
    vi.stubGlobal("window", { addEventListener: add, removeEventListener: remove });
    store = await import("@/core/services/fullReplaceRunStore");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("initial state", () => {
    it("should start idle and equal the server snapshot", () => {
      expect(store.getSnapshot()).toEqual({ status: "idle", progress: null, result: null, error: null, context: null });
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });
  });

  describe("start", () => {
    it("should set RUNNING and context synchronously before the run resolves", () => {
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      void store.start(params());
      const snap = store.getSnapshot();
      expect(snap.status).toBe("running");
      expect(snap.context).toMatchObject({
        sourceLabel: "public.a",
        targetLabel: "geo.b",
        sourceServer: "src:5432/sdb",
        targetServer: "tgt:6543/tdb",
      });
      expect(typeof snap.context?.startedAt).toBe("number");
    });

    it("should resolve to DONE with the result", async () => {
      runMock.mockResolvedValue(outcome);
      await store.start(params());
      const snap = store.getSnapshot();
      expect(snap.status).toBe("done");
      expect(snap.result).toEqual(outcome);
      expect(snap.error).toBeNull();
    });

    it("should resolve to FAILED with the Error message", async () => {
      runMock.mockRejectedValue(new Error("fetch broke"));
      await store.start(params());
      const snap = store.getSnapshot();
      expect(snap.status).toBe("failed");
      expect(snap.error).toBe("fetch broke");
      expect(snap.result).toBeNull();
    });

    it("should use the default Spanish message for a non-Error rejection", async () => {
      runMock.mockRejectedValue("boom");
      await store.start(params());
      expect(store.getSnapshot().status).toBe("failed");
      expect(store.getSnapshot().error).toBe("Error desconocido durante el reemplazo completo.");
    });

    it("should ignore a second start while running", async () => {
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      const first = store.start(params());
      await store.start(params());
      expect(runMock).toHaveBeenCalledOnce();
      expect(add).toHaveBeenCalledOnce();
      d.resolve(outcome);
      await first;
    });

    it("should allow a new start after a finished run is reset", async () => {
      runMock.mockResolvedValue(outcome);
      await store.start(params());
      store.reset();
      await store.start(params());
      expect(runMock).toHaveBeenCalledTimes(2);
    });

    it("should forward the password to runFullReplace", async () => {
      runMock.mockResolvedValue(outcome);
      await store.start(params("s3cret"));
      expect(runMock).toHaveBeenCalledOnce();
      const arg = runMock.mock.calls[0][0];
      expect(arg.password).toBe("s3cret");
      expect(arg.mapping).toBe(mapping);
      expect(arg.sequences).toEqual([]);
      expect(arg.resetSequences).toBe(true);
      expect(typeof arg.onProgress).toBe("function");
    });

    it("should never keep the password in any snapshot (AC-14)", async () => {
      const secret = "ultra-secret-pw";
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      const run = store.start(params(secret));
      runMock.mock.calls[0][0].onProgress({ label: "x", current: 1, total: 2 });
      expect(JSON.stringify(store.getSnapshot())).not.toContain(secret);
      d.resolve(outcome);
      await run;
      expect(JSON.stringify(store.getSnapshot())).not.toContain(secret);
    });

    it("should never keep the password after a failure", async () => {
      runMock.mockRejectedValue(new Error("nope"));
      await store.start(params("ultra-secret-pw"));
      expect(JSON.stringify(store.getSnapshot())).not.toContain("ultra-secret-pw");
    });

    it("should work without window (SSR guard)", async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal("window", undefined);
      runMock.mockResolvedValue(outcome);
      await expect(store.start(params())).resolves.toBeUndefined();
      expect(store.getSnapshot().status).toBe("done");
    });
  });

  describe("progress and snapshot identity", () => {
    it("should reflect progress and produce a new snapshot reference per change", async () => {
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      const run = store.start(params());
      const onProgress = runMock.mock.calls[0][0].onProgress;
      const before = store.getSnapshot();
      expect(store.getSnapshot()).toBe(before);

      onProgress({ label: "Lote 1", current: 1, total: 4 });
      const afterOne = store.getSnapshot();
      expect(afterOne).not.toBe(before);
      expect(afterOne.progress).toEqual({ label: "Lote 1", current: 1, total: 4 });
      expect(store.getSnapshot()).toBe(afterOne);

      onProgress({ label: "Lote 2", current: 2, total: 4 });
      const afterTwo = store.getSnapshot();
      expect(afterTwo).not.toBe(afterOne);
      expect(afterTwo.progress?.current).toBe(2);
      expect(afterTwo.context).toBe(before.context);

      d.resolve(outcome);
      await run;
      expect(store.getSnapshot()).not.toBe(afterTwo);
      expect(store.getSnapshot().progress).toEqual({ label: "Lote 2", current: 2, total: 4 });
    });
  });

  describe("stale progress callbacks", () => {
    it("should ignore late progress after the run ended and was reset", async () => {
      runMock.mockRejectedValue(new Error("boom"));
      await store.start(params());
      const staleProgress = runMock.mock.calls[0][0].onProgress;
      expect(store.getSnapshot().status).toBe("failed");
      store.reset();
      const idle = store.getSnapshot();

      staleProgress({ phase: "fetch", label: "x", current: 1, total: 2 });

      expect(store.getSnapshot()).toBe(idle);
      expect(store.getSnapshot()).toEqual({ status: "idle", progress: null, result: null, error: null, context: null });
    });

    it("should ignore a late callback from run A once run B is running", async () => {
      runMock.mockRejectedValueOnce(new Error("A failed"));
      await store.start(params());
      const staleA = runMock.mock.calls[0][0].onProgress;
      store.reset();
      const d = deferred<typeof outcome>();
      runMock.mockReturnValueOnce(d.promise);
      const runB = store.start(params());
      const progressB = runMock.mock.calls[1][0].onProgress;
      progressB({ phase: "fetch", label: "B", current: 1, total: 4 });
      const beforeStale = store.getSnapshot();

      staleA({ phase: "fetch", label: "A", current: 9, total: 9 });

      expect(store.getSnapshot()).toBe(beforeStale);
      expect(store.getSnapshot().status).toBe("running");
      expect(store.getSnapshot().progress).toEqual({ phase: "fetch", label: "B", current: 1, total: 4 });
      d.resolve(outcome);
      await runB;
    });
  });

  describe("reset", () => {
    it("should be a no-op when idle", () => {
      const before = store.getSnapshot();
      const listener = vi.fn();
      store.subscribe(listener);
      store.reset();
      expect(store.getSnapshot()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
    });

    it("should be a no-op while running", async () => {
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      const run = store.start(params());
      const before = store.getSnapshot();
      store.reset();
      expect(store.getSnapshot()).toBe(before);
      expect(store.getSnapshot().status).toBe("running");
      d.resolve(outcome);
      await run;
    });

    it("should return to idle after done", async () => {
      runMock.mockResolvedValue(outcome);
      await store.start(params());
      store.reset();
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });

    it("should return to idle after failed", async () => {
      runMock.mockRejectedValue(new Error("x"));
      await store.start(params());
      store.reset();
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });
  });

  describe("subscribe", () => {
    it("should notify listeners on every change", async () => {
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      const listener = vi.fn();
      store.subscribe(listener);
      const run = store.start(params());
      expect(listener).toHaveBeenCalledTimes(1);
      runMock.mock.calls[0][0].onProgress({ label: "x", current: 1, total: 2 });
      expect(listener).toHaveBeenCalledTimes(2);
      d.resolve(outcome);
      await run;
      expect(listener).toHaveBeenCalledTimes(3);
      store.reset();
      expect(listener).toHaveBeenCalledTimes(4);
    });

    it("should stop notifying after unsubscribe and notify others independently", async () => {
      runMock.mockResolvedValue(outcome);
      const a = vi.fn();
      const b = vi.fn();
      const unsubscribeA = store.subscribe(a);
      store.subscribe(b);
      unsubscribeA();
      await store.start(params());
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(2);
    });
  });

  describe("beforeunload guard (AC-13)", () => {
    it("should add the listener exactly once on start and prevent default navigation", async () => {
      const d = deferred<typeof outcome>();
      runMock.mockReturnValue(d.promise);
      const run = store.start(params());
      expect(add).toHaveBeenCalledExactlyOnceWith("beforeunload", expect.any(Function));
      expect(remove).not.toHaveBeenCalled();
      const preventDefault = vi.fn();
      add.mock.calls[0][1]({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      d.resolve(outcome);
      await run;
    });

    it("should remove the same listener after done", async () => {
      runMock.mockResolvedValue(outcome);
      await store.start(params());
      expect(remove).toHaveBeenCalledExactlyOnceWith("beforeunload", add.mock.calls[0][1]);
    });

    it("should remove the same listener after failed", async () => {
      runMock.mockRejectedValue(new Error("x"));
      await store.start(params());
      expect(remove).toHaveBeenCalledExactlyOnceWith("beforeunload", add.mock.calls[0][1]);
    });
  });

  describe("describeDbServer", () => {
    it("should format host:port/db", () => {
      expect(store.describeDbServer(cfg({ host: "x", port: 1, db_name: "y" }))).toBe("x:1/y");
    });
  });
});
