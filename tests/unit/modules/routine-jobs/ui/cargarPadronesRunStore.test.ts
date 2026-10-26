import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import {
  createCargarPadronesRunStore,
  getCargarPadronesRunStore,
} from "@/modules/routine-jobs/ui/cargarPadronesRunStore";
import type { JobStatusView, StartRequest } from "@/modules/routine-jobs/ui/clientTypes";

const PASSWORD = "s3cret-pw";

const apiError = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const POLL_MS = 2000;
const GIVE_UP_MS = 60_000;

const request: StartRequest = {
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD },
  schema: "carto",
  ruralTable: "rural",
  urbanoTable: "urbano",
  targetTable: "destino",
  options: { repair: true, clearMode: "delete", resetSequences: true },
  dryRun: false,
  confirm: true,
};

const job = (changes: Partial<JobStatusView> = {}): JobStatusView =>
  ({
    jobId: "job-1",
    state: "RUNNING",
    step: null,
    dryRun: false,
    startedAt: 1,
    ...changes,
  }) as JobStatusView;

interface FakeClient {
  start: Mock<(request: StartRequest) => Promise<{ jobId: string }>>;
  readStatus: Mock<(jobId: string) => Promise<JobStatusView>>;
}

const makeClient = (): FakeClient => ({
  start: vi.fn<(request: StartRequest) => Promise<{ jobId: string }>>(),
  readStatus: vi.fn<(jobId: string) => Promise<JobStatusView>>(),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  for (let tick = 0; tick < 30; tick++) await Promise.resolve();
};

function makeHarness(options: { pollMs?: number; giveUpMs?: number } = {}) {
  const client = makeClient();
  const clock = { now: 0 };
  let nextHandle = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const setTimer = vi.fn((fn: () => void, ms: number): unknown => {
    const handle = nextHandle++;
    pending.set(handle, { fn, ms });
    return handle;
  });
  const clearTimer = vi.fn((handle: unknown): void => {
    pending.delete(handle as number);
  });
  const store = createCargarPadronesRunStore({
    client,
    setTimer,
    clearTimer,
    now: () => clock.now,
    ...options,
  });
  const poll = async (advanceMs = 0): Promise<void> => {
    clock.now += advanceMs;
    const due = Array.from(pending.entries());
    for (const [handle, timer] of due) {
      pending.delete(handle);
      timer.fn();
    }
    await flush();
  };
  const startRunning = async (): Promise<void> => {
    client.start.mockResolvedValue({ jobId: "job-1" });
    await store.start(request);
    await flush();
  };
  return { client, clock, pending, setTimer, clearTimer, store, poll, startRunning };
}

describe("cargarPadronesRunStore", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
  });

  describe("initial state", () => {
    it("AC-29: should start idle with no job, error or id", () => {
      const snapshot = h.store.getSnapshot();

      expect(snapshot.phase).toBe("idle");
      expect(snapshot.jobId).toBeUndefined();
      expect(snapshot.job).toBeUndefined();
      expect(snapshot.error).toBeUndefined();
      expect(h.setTimer).not.toHaveBeenCalled();
    });
  });

  describe("start", () => {
    it("AC-29: should be starting synchronously, then running with the jobId", async () => {
      const started = deferred<{ jobId: string }>();
      h.client.start.mockReturnValue(started.promise);

      const run = h.store.start(request);
      expect(h.store.getSnapshot().phase).toBe("starting");

      started.resolve({ jobId: "job-1" });
      await run;

      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-1" });
    });

    it("AC-29: should pass the request to the client and record the start time from now()", async () => {
      h.clock.now = 123_456;

      await h.startRunning();

      expect(h.client.start).toHaveBeenCalledOnce();
      expect(h.client.start).toHaveBeenCalledWith(request);
      expect(h.store.getSnapshot().startedAt).toBe(123_456);
    });

    it("AC-29: should schedule exactly one poll every pollMs (default 2000) once running", async () => {
      await h.startRunning();

      expect(h.pending.size).toBe(1);
      expect(Array.from(h.pending.values())[0].ms).toBe(POLL_MS);
      expect(h.client.readStatus).not.toHaveBeenCalled();
    });

    it("AC-29: should honour a custom pollMs", async () => {
      const custom = makeHarness({ pollMs: 500 });
      custom.client.start.mockResolvedValue({ jobId: "job-1" });

      await custom.store.start(request);

      expect(Array.from(custom.pending.values())[0].ms).toBe(500);
    });

    it("AC-29: should fail with the Spanish message when start is refused with 409", async () => {
      const message = "Ya hay una carga en curso para esta tabla.";
      h.client.start.mockRejectedValue(apiError(409, message));

      await h.store.start(request);

      expect(h.store.getSnapshot()).toMatchObject({ phase: "failed", error: message });
      expect(h.pending.size).toBe(0);
      expect(h.client.readStatus).not.toHaveBeenCalled();
    });

    it("AC-29: should fail with the error message when start rejects with a plain Error", async () => {
      h.client.start.mockRejectedValue(new Error("No se pudo conectar con el servidor."));

      await h.store.start(request);

      expect(h.store.getSnapshot()).toMatchObject({
        phase: "failed",
        error: "No se pudo conectar con el servidor.",
      });
    });

    it("AC-29: should fail with a non-empty fallback message when start rejects with a non-Error", async () => {
      h.client.start.mockRejectedValue("boom");

      await h.store.start(request);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("failed");
      expect((snapshot.error ?? "").trim().length).toBeGreaterThan(0);
      expect(snapshot.error).not.toBe("boom");
    });

    it("AC-29: should ignore a second start while starting without calling the client again", async () => {
      const started = deferred<{ jobId: string }>();
      h.client.start.mockReturnValue(started.promise);

      const first = h.store.start(request);
      await h.store.start(request);
      started.resolve({ jobId: "job-1" });
      await first;

      expect(h.client.start).toHaveBeenCalledOnce();
    });

    it("AC-29: should ignore a second start while running without calling the client again", async () => {
      await h.startRunning();

      await h.store.start(request);

      expect(h.client.start).toHaveBeenCalledOnce();
      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-1" });
    });

    it("AC-29: should allow a new run after the previous one is done", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "DONE" }));
      await h.poll(POLL_MS);
      h.client.start.mockResolvedValue({ jobId: "job-2" });

      await h.store.start(request);

      expect(h.client.start).toHaveBeenCalledTimes(2);
      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-2" });
    });

    it("AC-29: should allow a new run after the previous one failed to start", async () => {
      h.client.start.mockRejectedValueOnce(apiError(409, "Ya hay una carga en curso para esta tabla."));
      await h.store.start(request);
      h.client.start.mockResolvedValue({ jobId: "job-2" });

      await h.store.start(request);

      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-2" });
    });
  });

  describe("polling", () => {
    it("AC-29: should poll the status of the active job and keep polling while RUNNING", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "RUNNING", step: "Cargando rurales", current: 2, total: 7 }));

      await h.poll(POLL_MS);
      await h.poll(POLL_MS);

      expect(h.client.readStatus).toHaveBeenCalledTimes(2);
      expect(h.client.readStatus).toHaveBeenCalledWith("job-1");
      expect(h.pending.size).toBe(1);
      expect(Array.from(h.pending.values())[0].ms).toBe(POLL_MS);
    });

    it("AC-29: should store the latest step, current and total of a RUNNING job", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValueOnce(job({ step: "Preparando", current: 1, total: 7 }));
      h.client.readStatus.mockResolvedValueOnce(job({ step: "Cargando urbanos", current: 4, total: 7 }));

      await h.poll(POLL_MS);
      expect(h.store.getSnapshot().job).toMatchObject({ step: "Preparando", current: 1, total: 7 });
      await h.poll(POLL_MS);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("running");
      expect(snapshot.job).toMatchObject({ step: "Cargando urbanos", current: 4, total: 7 });
    });

    it("AC-29: should finish as done and stop polling when the job is DONE", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "DONE", finishedAt: 5 }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot()).toMatchObject({ phase: "done", jobId: "job-1" });
      expect(h.store.getSnapshot().job?.state).toBe("DONE");
      expect(h.pending.size).toBe(0);
    });

    it("AC-29: should not call readStatus again after the job is DONE", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "DONE" }));
      await h.poll(POLL_MS);
      const calls = h.client.readStatus.mock.calls.length;

      await h.poll(POLL_MS * 5);

      expect(h.client.readStatus.mock.calls.length).toBe(calls);
    });

    it("AC-29: should keep outcomeUnknown from a DONE job in the stored job", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "DONE", outcomeUnknown: true }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().phase).toBe("done");
      expect(h.store.getSnapshot().job?.outcomeUnknown).toBe(true);
    });

    it("AC-29: should fail with the job error and stop polling when the job is FAILED", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "FAILED", error: "Tabla bloqueada por otro proceso." }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot()).toMatchObject({ phase: "failed", error: "Tabla bloqueada por otro proceso." });
      expect(h.pending.size).toBe(0);
    });

    it("AC-29: should fail with a non-empty message when a FAILED job carries no error", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "FAILED" }));

      await h.poll(POLL_MS);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("failed");
      expect((snapshot.error ?? "").trim().length).toBeGreaterThan(0);
    });
  });

  describe("poll failures", () => {
    it("AC-29: should stay running after a single failed poll and keep polling", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValueOnce(new Error("socket hang up"));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().phase).toBe("running");
      expect(h.pending.size).toBe(1);
    });

    it("AC-29: should stay running when failures span one millisecond less than giveUpMs", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));

      await h.poll(0);
      await h.poll(GIVE_UP_MS - 1);

      expect(h.store.getSnapshot().phase).toBe("running");
      expect(h.pending.size).toBe(1);
    });

    it("AC-29: should report an unknown outcome naming the job id when failures span exactly giveUpMs", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));

      await h.poll(0);
      await h.poll(GIVE_UP_MS);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("unknown");
      expect(snapshot.jobId).toBe("job-1");
      expect(snapshot.error).toContain("job-1");
    });

    it("AC-29: should report an unknown outcome when failures span more than giveUpMs", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));

      await h.poll(0);
      await h.poll(GIVE_UP_MS + 1);

      expect(h.store.getSnapshot().phase).toBe("unknown");
    });

    it("AC-29: should stop polling after giving up", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));
      await h.poll(0);
      await h.poll(GIVE_UP_MS);
      const calls = h.client.readStatus.mock.calls.length;

      await h.poll(POLL_MS * 5);

      expect(h.pending.size).toBe(0);
      expect(h.client.readStatus.mock.calls.length).toBe(calls);
    });

    it("AC-29: should restart the failure window after a successful poll", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValueOnce(new Error("a"));
      await h.poll(0);
      h.client.readStatus.mockRejectedValueOnce(new Error("b"));
      await h.poll(50_000);
      h.client.readStatus.mockResolvedValueOnce(job({ step: "Cargando", current: 1, total: 7 }));
      await h.poll(0);
      h.client.readStatus.mockRejectedValue(new Error("c"));
      await h.poll(0);

      await h.poll(GIVE_UP_MS - 1);
      expect(h.store.getSnapshot().phase).toBe("running");

      await h.poll(1);
      expect(h.store.getSnapshot().phase).toBe("unknown");
    });

    it("AC-29: should accept a DONE answer after earlier failed polls", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValueOnce(new Error("a"));
      await h.poll(0);
      h.client.readStatus.mockResolvedValueOnce(job({ state: "DONE" }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().phase).toBe("done");
    });

    it("AC-29: should honour a custom giveUpMs", async () => {
      const custom = makeHarness({ giveUpMs: 5000 });
      custom.client.start.mockResolvedValue({ jobId: "job-1" });
      await custom.store.start(request);
      await flush();
      custom.client.readStatus.mockRejectedValue(new Error("down"));

      await custom.poll(0);
      await custom.poll(4999);
      expect(custom.store.getSnapshot().phase).toBe("running");
      await custom.poll(1);

      expect(custom.store.getSnapshot().phase).toBe("unknown");
    });
  });

  describe("reset", () => {
    it("AC-29: should return to idle and clear the pending timer", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ step: "Cargando", current: 1, total: 7 }));
      await h.poll(POLL_MS);

      h.store.reset();

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("idle");
      expect(snapshot.jobId).toBeUndefined();
      expect(snapshot.job).toBeUndefined();
      expect(snapshot.error).toBeUndefined();
      expect(h.clearTimer).toHaveBeenCalled();
      expect(h.pending.size).toBe(0);
    });

    it("AC-29: should return to idle after a finished run", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(job({ state: "DONE" }));
      await h.poll(POLL_MS);

      h.store.reset();

      expect(h.store.getSnapshot().phase).toBe("idle");
    });

    it("AC-29: should be harmless while idle", () => {
      expect(() => h.store.reset()).not.toThrow();
      expect(h.store.getSnapshot().phase).toBe("idle");
    });

    it("AC-29: should ignore a poll answer that arrives after reset", async () => {
      await h.startRunning();
      const slow = deferred<JobStatusView>();
      h.client.readStatus.mockReturnValue(slow.promise);
      await h.poll(POLL_MS);

      h.store.reset();
      slow.resolve(job({ state: "DONE" }));
      await flush();

      expect(h.store.getSnapshot().phase).toBe("idle");
      expect(h.pending.size).toBe(0);
    });

    it("AC-29: should ignore a start answer that arrives after reset", async () => {
      const started = deferred<{ jobId: string }>();
      h.client.start.mockReturnValue(started.promise);
      const run = h.store.start(request);

      h.store.reset();
      started.resolve({ jobId: "job-1" });
      await run;
      await flush();

      expect(h.store.getSnapshot().phase).toBe("idle");
      expect(h.pending.size).toBe(0);
    });

    it("AC-29: should allow starting again after reset", async () => {
      await h.startRunning();
      h.store.reset();
      h.client.start.mockResolvedValue({ jobId: "job-2" });

      await h.store.start(request);

      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-2" });
    });
  });

  describe("subscribe and snapshot identity", () => {
    it("AC-29: should return the same snapshot reference until something changes", () => {
      const before = h.store.getSnapshot();

      expect(h.store.getSnapshot()).toBe(before);
    });

    it("AC-29: should notify listeners on every state change", async () => {
      const listener = vi.fn();
      h.store.subscribe(listener);
      h.client.start.mockResolvedValue({ jobId: "job-1" });

      await h.store.start(request);
      const afterStart = listener.mock.calls.length;
      h.client.readStatus.mockResolvedValue(job({ step: "Cargando", current: 1, total: 7 }));
      await h.poll(POLL_MS);

      expect(afterStart).toBeGreaterThanOrEqual(2);
      expect(listener.mock.calls.length).toBeGreaterThan(afterStart);
    });

    it("AC-29: should notify on reset and publish a new snapshot", async () => {
      await h.startRunning();
      const listener = vi.fn();
      h.store.subscribe(listener);
      const before = h.store.getSnapshot();

      h.store.reset();

      expect(listener).toHaveBeenCalled();
      expect(h.store.getSnapshot()).not.toBe(before);
    });

    it("AC-29: should not call an unsubscribed listener", async () => {
      const listener = vi.fn();
      const unsubscribe = h.store.subscribe(listener);
      unsubscribe();
      h.client.start.mockResolvedValue({ jobId: "job-1" });

      await h.store.start(request);
      h.store.reset();

      expect(listener).not.toHaveBeenCalled();
    });

    it("AC-29: should keep notifying the other listeners when one unsubscribes", async () => {
      const kept = vi.fn();
      const dropped = vi.fn();
      h.store.subscribe(kept);
      h.store.subscribe(dropped)();
      h.client.start.mockResolvedValue({ jobId: "job-1" });

      await h.store.start(request);

      expect(kept).toHaveBeenCalled();
      expect(dropped).not.toHaveBeenCalled();
    });

    it("AC-29: should tolerate unsubscribing twice", () => {
      const unsubscribe = h.store.subscribe(() => undefined);

      unsubscribe();

      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("password", () => {
    it("AC-29: should never keep the password in any snapshot across a whole run", async () => {
      const seen: string[] = [];
      h.store.subscribe(() => seen.push(JSON.stringify(h.store.getSnapshot())));
      const started = deferred<{ jobId: string }>();
      h.client.start.mockReturnValue(started.promise);

      const run = h.store.start(request);
      seen.push(JSON.stringify(h.store.getSnapshot()));
      started.resolve({ jobId: "job-1" });
      await run;
      h.client.readStatus.mockResolvedValueOnce(job({ step: "Cargando", current: 1, total: 7 }));
      await h.poll(POLL_MS);
      h.client.readStatus.mockResolvedValueOnce(job({ state: "DONE" }));
      await h.poll(POLL_MS);
      seen.push(JSON.stringify(h.store.getSnapshot()));

      expect(seen.length).toBeGreaterThan(3);
      for (const serialized of seen) expect(serialized).not.toContain(PASSWORD);
    });

    it("AC-29: should never keep the password after a start rejection", async () => {
      h.client.start.mockRejectedValue(apiError(409, "Ya hay una carga en curso para esta tabla."));

      await h.store.start(request);

      expect(JSON.stringify(h.store.getSnapshot())).not.toContain(PASSWORD);
    });

    it("AC-29: should never keep the password after giving up", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("down"));
      await h.poll(0);
      await h.poll(GIVE_UP_MS);

      expect(h.store.getSnapshot().phase).toBe("unknown");
      expect(JSON.stringify(h.store.getSnapshot())).not.toContain(PASSWORD);
    });
  });

  describe("getCargarPadronesRunStore", () => {
    it("AC-29: should return one module-level singleton", () => {
      const first = getCargarPadronesRunStore();
      const second = getCargarPadronesRunStore();

      expect(first).toBe(second);
      expect(typeof first.start).toBe("function");
      expect(typeof first.subscribe).toBe("function");
      expect(typeof first.getSnapshot).toBe("function");
      expect(typeof first.reset).toBe("function");
    });

    it("AC-29: should start the singleton idle", () => {
      expect(getCargarPadronesRunStore().getSnapshot().phase).toBe("idle");
    });

    it("AC-29: should survive a module re-evaluation through globalThis", async () => {
      const before = getCargarPadronesRunStore();

      vi.resetModules();
      const reloaded = await import("@/modules/routine-jobs/ui/cargarPadronesRunStore");

      expect(reloaded.getCargarPadronesRunStore()).toBe(before);
    });
  });
});
