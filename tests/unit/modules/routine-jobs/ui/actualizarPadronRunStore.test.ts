import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import {
  createActualizarPadronRunStore,
  getActualizarPadronRunStore,
  type ActualizarPadronRunSnapshot,
} from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import { getCargarPadronesRunStore } from "@/modules/routine-jobs/ui/cargarPadronesRunStore";
import type { ActualizarJobStatusView, ActualizarStartRequest } from "@/modules/routine-jobs/ui/clientTypes";
import { actualizarJobOf, actualizarRequestOf, actualizarResultOf, ACTUALIZAR_SECRET } from "../wizard/actualizarFixtures";

const POLL_MS = 2000;
const GIVE_UP_MS = 60_000;

const apiError = (status: number, message: string): Error => Object.assign(new Error(message), { status });

interface FakeClient {
  start: Mock<(request: ActualizarStartRequest) => Promise<{ jobId: string }>>;
  readStatus: Mock<(jobId: string) => Promise<ActualizarJobStatusView>>;
}

const makeClient = (): FakeClient => ({
  start: vi.fn<(request: ActualizarStartRequest) => Promise<{ jobId: string }>>(),
  readStatus: vi.fn<(jobId: string) => Promise<ActualizarJobStatusView>>(),
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
  const store = createActualizarPadronRunStore({
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
  const startRunning = async (request: ActualizarStartRequest = actualizarRequestOf()): Promise<void> => {
    client.start.mockResolvedValue({ jobId: "job-1" });
    await store.start(request);
    await flush();
  };
  return { client, clock, pending, setTimer, clearTimer, store, poll, startRunning };
}

describe("actualizarPadronRunStore", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
  });

  describe("initial state", () => {
    it("AP-33: should start idle with no job, error, id or plan", () => {
      expect(h.store.getSnapshot()).toEqual({ phase: "idle" });
    });
  });

  describe("start", () => {
    it("AP-33: should be starting synchronously, then running with the jobId", async () => {
      h.client.start.mockResolvedValue({ jobId: "job-1" });

      const run = h.store.start(actualizarRequestOf());

      expect(h.store.getSnapshot().phase).toBe("starting");
      await run;
      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-1" });
    });

    it("AP-33: should pass the request to the client unchanged", async () => {
      const request = actualizarRequestOf({ dryRun: true, confirm: false });
      await h.startRunning(request);

      expect(h.client.start).toHaveBeenCalledWith(request);
    });

    it("AP-33: should record the start time from now() and the plan of the run", async () => {
      h.clock.now = 5000;
      await h.startRunning(actualizarRequestOf({ dryRun: true, options: { clearMode: "truncate" }, confirm: false }));

      expect(h.store.getSnapshot().startedAt).toBe(5000);
      expect(h.store.getSnapshot().plan).toEqual({ dryRun: true, clearMode: "truncate" });
    });

    it("AP-33: should schedule exactly one poll every 2000 ms by default once running", async () => {
      await h.startRunning();

      expect(h.setTimer).toHaveBeenCalledTimes(1);
      expect(h.setTimer.mock.calls[0][1]).toBe(POLL_MS);
    });

    it("AP-33: should honour a custom pollMs", async () => {
      const custom = makeHarness({ pollMs: 500 });
      await custom.startRunning();

      expect(custom.setTimer.mock.calls[0][1]).toBe(500);
    });

    it("AP-33: should fail with the Spanish server message when start is refused with 409", async () => {
      h.client.start.mockRejectedValue(apiError(409, "Ya hay una actualización en curso para esta tabla."));

      await h.store.start(actualizarRequestOf());

      expect(h.store.getSnapshot()).toMatchObject({
        phase: "failed",
        error: "Ya hay una actualización en curso para esta tabla.",
      });
    });

    it("AP-33: should fail with a non-empty fallback message when start rejects with a non-Error", async () => {
      h.client.start.mockRejectedValue("boom");

      await h.store.start(actualizarRequestOf());

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("failed");
      expect(snapshot.error?.trim().length).toBeGreaterThan(0);
    });

    it("AP-33: should ignore a second start while starting without calling the client again", async () => {
      h.client.start.mockReturnValue(new Promise<{ jobId: string }>(() => undefined));

      void h.store.start(actualizarRequestOf());
      await h.store.start(actualizarRequestOf());

      expect(h.client.start).toHaveBeenCalledTimes(1);
    });

    it("AP-33: should ignore a second start while running without calling the client again", async () => {
      await h.startRunning();

      await h.store.start(actualizarRequestOf());

      expect(h.client.start).toHaveBeenCalledTimes(1);
    });

    it("AP-33: should allow a new run after the previous one failed to start", async () => {
      h.client.start.mockRejectedValueOnce(new Error("sin red"));
      await h.store.start(actualizarRequestOf());
      h.client.start.mockResolvedValueOnce({ jobId: "job-2" });

      await h.store.start(actualizarRequestOf());

      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-2" });
    });
  });

  describe("polling", () => {
    it("AP-33: should poll the status of the active job and keep polling while RUNNING", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ state: "RUNNING", step: "Cargar tabla de trabajo", current: 2, total: 9 }));

      await h.poll(POLL_MS);
      await h.poll(POLL_MS);

      expect(h.client.readStatus).toHaveBeenCalledTimes(2);
      expect(h.client.readStatus).toHaveBeenCalledWith("job-1");
      expect(h.pending.size).toBe(1);
    });

    it("AP-33: should store the server planned steps and the latest step of a RUNNING job", async () => {
      await h.startRunning();
      const steps = ["Validar tablas y columnas", "Contar filas de staging", "Vaciar tabla de trabajo"];
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ step: "Contar filas de staging", steps }));

      await h.poll(POLL_MS);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("running");
      expect(snapshot.job?.steps).toEqual(steps);
      expect(snapshot.job?.step).toBe("Contar filas de staging");
    });

    it("AP-33: should finish as done with the report and stop polling when the job is DONE", async () => {
      await h.startRunning();
      const result = actualizarResultOf();
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ state: "DONE", result }));

      await h.poll(POLL_MS);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("done");
      expect(snapshot.job?.result).toEqual(result);
      expect(h.pending.size).toBe(0);
    });

    it("AP-33: should not call readStatus again after the job is DONE", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ state: "DONE", result: actualizarResultOf() }));
      await h.poll(POLL_MS);

      await h.poll(POLL_MS);

      expect(h.client.readStatus).toHaveBeenCalledTimes(1);
    });

    it("AP-33: should keep the plan of the run after the job is DONE", async () => {
      await h.startRunning(actualizarRequestOf({ dryRun: true, confirm: false }));
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ state: "DONE", dryRun: true, result: actualizarResultOf({ dryRun: true }) }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().plan).toEqual({ dryRun: true, clearMode: "delete" });
    });

    it("AP-19: should keep the DONE phase and the outcomeUnknown flag of the report", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(
        actualizarJobOf({ state: "DONE", result: actualizarResultOf({ outcomeUnknown: true, tempModified: false }) }),
      );

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().phase).toBe("done");
      expect(h.store.getSnapshot().job?.result?.outcomeUnknown).toBe(true);
    });

    it("AP-33: should fail with the job error and stop polling when the job is FAILED", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ state: "FAILED", error: "La tabla de trabajo tiene columnas NOT NULL." }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot()).toMatchObject({ phase: "failed", error: "La tabla de trabajo tiene columnas NOT NULL." });
      expect(h.pending.size).toBe(0);
    });

    it("AP-33: should fail with a non-empty message when a FAILED job carries no error", async () => {
      await h.startRunning();
      h.client.readStatus.mockResolvedValue(actualizarJobOf({ state: "FAILED", error: undefined }));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().phase).toBe("failed");
      expect(h.store.getSnapshot().error?.trim().length).toBeGreaterThan(0);
    });
  });

  describe("poll failures", () => {
    it("AP-33: should stay running after a single failed poll and keep polling", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValueOnce(new Error("network down"));

      await h.poll(POLL_MS);

      expect(h.store.getSnapshot().phase).toBe("running");
      expect(h.pending.size).toBe(1);
    });

    it("AP-33: should stay running when failures span one millisecond less than 60 s", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));

      await h.poll(0);
      await h.poll(GIVE_UP_MS - 1);

      expect(h.store.getSnapshot().phase).toBe("running");
    });

    it("AP-33: should report an unknown outcome naming the job id when failures span exactly 60 s", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));

      await h.poll(0);
      await h.poll(GIVE_UP_MS);

      const snapshot = h.store.getSnapshot();
      expect(snapshot.phase).toBe("unknown");
      expect(snapshot.jobId).toBe("job-1");
      expect(snapshot.error).toContain("job-1");
    });

    it("AP-33: should stop polling after giving up", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));
      await h.poll(0);
      await h.poll(GIVE_UP_MS);

      await h.poll(POLL_MS);

      expect(h.pending.size).toBe(0);
    });

    it("AP-33: should restart the failure window after a successful poll", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValueOnce(new Error("a"));
      await h.poll(0);
      h.client.readStatus.mockResolvedValueOnce(actualizarJobOf({ step: "Contar filas de staging" }));
      await h.poll(GIVE_UP_MS - 1000);
      h.client.readStatus.mockRejectedValueOnce(new Error("b"));

      await h.poll(GIVE_UP_MS - 1000);

      expect(h.store.getSnapshot().phase).toBe("running");
    });

    it("AP-33: should honour a custom giveUpMs", async () => {
      const custom = makeHarness({ giveUpMs: 4000 });
      await custom.startRunning();
      custom.client.readStatus.mockRejectedValue(new Error("network down"));

      await custom.poll(0);
      await custom.poll(4000);

      expect(custom.store.getSnapshot().phase).toBe("unknown");
    });
  });

  describe("reset", () => {
    it("AP-33: should return to idle and clear the pending timer", async () => {
      await h.startRunning();

      h.store.reset();

      expect(h.store.getSnapshot()).toEqual({ phase: "idle" });
      expect(h.clearTimer).toHaveBeenCalled();
      expect(h.pending.size).toBe(0);
    });

    it("AP-33: should be harmless while idle", () => {
      expect(() => h.store.reset()).not.toThrow();
      expect(h.store.getSnapshot()).toEqual({ phase: "idle" });
    });

    it("AP-33: should ignore a poll answer that arrives after reset", async () => {
      await h.startRunning();
      const answer = deferred<ActualizarJobStatusView>();
      h.client.readStatus.mockReturnValue(answer.promise);
      await h.poll(POLL_MS);

      h.store.reset();
      answer.resolve(actualizarJobOf({ state: "DONE", result: actualizarResultOf() }));
      await flush();

      expect(h.store.getSnapshot().phase).toBe("idle");
    });

    it("AP-33: should ignore a start answer that arrives after reset", async () => {
      const answer = deferred<{ jobId: string }>();
      h.client.start.mockReturnValue(answer.promise);
      void h.store.start(actualizarRequestOf());

      h.store.reset();
      answer.resolve({ jobId: "job-late" });
      await flush();

      expect(h.store.getSnapshot()).toEqual({ phase: "idle" });
      expect(h.pending.size).toBe(0);
    });

    it("AP-33: should allow starting again after reset", async () => {
      await h.startRunning();
      h.store.reset();
      h.client.start.mockResolvedValueOnce({ jobId: "job-2" });

      await h.store.start(actualizarRequestOf());

      expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-2" });
    });
  });

  describe("subscribe and snapshot identity", () => {
    it("AP-33: should return the same snapshot reference until something changes", () => {
      expect(h.store.getSnapshot()).toBe(h.store.getSnapshot());
    });

    it("AP-33: should notify listeners on every state change", async () => {
      const listener = vi.fn();
      h.store.subscribe(listener);

      await h.startRunning();

      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("AP-33: should notify on reset", async () => {
      await h.startRunning();
      const listener = vi.fn();
      h.store.subscribe(listener);

      h.store.reset();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("AP-33: should not call an unsubscribed listener", async () => {
      const listener = vi.fn();
      const unsubscribe = h.store.subscribe(listener);
      unsubscribe();

      await h.startRunning();

      expect(listener).not.toHaveBeenCalled();
    });

    it("AP-33: should tolerate unsubscribing twice", () => {
      const unsubscribe = h.store.subscribe(vi.fn());
      unsubscribe();

      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("password", () => {
    it("AP-24: should never keep the password in any snapshot across a whole run", async () => {
      const seen: string[] = [];
      h.store.subscribe(() => seen.push(JSON.stringify(h.store.getSnapshot())));
      const started = deferred<{ jobId: string }>();
      h.client.start.mockReturnValue(started.promise);

      const run = h.store.start(actualizarRequestOf());
      seen.push(JSON.stringify(h.store.getSnapshot()));
      started.resolve({ jobId: "job-1" });
      await run;
      h.client.readStatus.mockResolvedValueOnce(actualizarJobOf({ step: "Cargar tabla de trabajo", current: 1, total: 9 }));
      await h.poll(POLL_MS);
      h.client.readStatus.mockResolvedValueOnce(actualizarJobOf({ state: "DONE", result: actualizarResultOf() }));
      await h.poll(POLL_MS);
      seen.push(JSON.stringify(h.store.getSnapshot()));

      expect(seen.length).toBeGreaterThan(3);
      for (const serialized of seen) expect(serialized).not.toContain(ACTUALIZAR_SECRET);
    });

    it("AP-24: should never keep the password after a start rejection", async () => {
      h.client.start.mockRejectedValue(new Error("fallo"));

      await h.store.start(actualizarRequestOf());

      expect(JSON.stringify(h.store.getSnapshot())).not.toContain(ACTUALIZAR_SECRET);
    });

    it("AP-33: should never keep the password after giving up", async () => {
      await h.startRunning();
      h.client.readStatus.mockRejectedValue(new Error("network down"));
      await h.poll(0);
      await h.poll(GIVE_UP_MS);

      expect(JSON.stringify(h.store.getSnapshot())).not.toContain(ACTUALIZAR_SECRET);
    });
  });

  describe("getActualizarPadronRunStore", () => {
    it("AP-33: should return one module-level singleton", () => {
      expect(getActualizarPadronRunStore()).toBe(getActualizarPadronRunStore());
    });

    it("AP-33: should start the singleton idle", () => {
      const snapshot: ActualizarPadronRunSnapshot = getActualizarPadronRunStore().getSnapshot();

      expect(snapshot.phase).toBe("idle");
    });

    it("AP-33: should not share state with the Cargar padrones run store", () => {
      expect(getActualizarPadronRunStore()).not.toBe(getCargarPadronesRunStore());
    });
  });
});
