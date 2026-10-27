import { describe, it, expect, vi } from "vitest";
import {
  JobState,
  createJobStore,
  getJobStore,
} from "@/modules/routine-jobs/jobs/shared/jobStore";

const STORE_MODULE = "@/modules/routine-jobs/jobs/shared/jobStore";
const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const KEY = "db.local:5432|gis|cat|padron_trabajo";
const OTHER_KEY = "db.local:5432|gis|cat|otra_tabla";

interface TestResult {
  label: string;
  outcomeUnknown: boolean;
}

const resultFixture = (overrides: Partial<TestResult> = {}): TestResult => ({
  label: "ok",
  outcomeUnknown: false,
  ...overrides,
});

describe("shared routine-jobs job store", () => {
  describe("createJobStore tryStart", () => {
    it("should grant a RUNNING job with an id, the key, a null step, dryRun false and the clock as startedAt", () => {
      const store = createJobStore<TestResult>(() => NOW);

      const job = store.tryStart(KEY);

      expect(job).toEqual({
        jobId: expect.any(String),
        tableKey: KEY,
        state: JobState.RUNNING,
        step: null,
        dryRun: false,
        steps: [],
        startedAt: NOW,
      });
    });

    it("should return null for a second start of the same key while the first is RUNNING", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart(KEY);

      expect(store.tryStart(KEY)).toBeNull();
    });

    it("should record the dryRun flag and the planned steps on the granted job", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const steps = ["Validar", "Cargar", "Revertir"];

      const job = store.tryStart(KEY, true, steps);

      expect(job?.dryRun).toBe(true);
      expect(job?.steps).toEqual(steps);
    });

    it("should refuse a dry run start while a real run of the same key is RUNNING", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart(KEY, false);

      expect(store.tryStart(KEY, true)).toBeNull();
    });

    it("should grant the key again once the job finishes", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const first = store.tryStart(KEY);
      store.finish(first?.jobId ?? "", resultFixture());

      expect(store.tryStart(KEY)).not.toBeNull();
    });

    it("should grant the key again once the job fails", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const first = store.tryStart(KEY);
      store.fail(first?.jobId ?? "", "error");

      expect(store.tryStart(KEY)).not.toBeNull();
    });

    it("should release the lock when the job finishes with outcomeUnknown true", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const first = store.tryStart(KEY);

      store.finish(first?.jobId ?? "", resultFixture({ outcomeUnknown: true }));

      expect(store.tryStart(KEY)).not.toBeNull();
    });

    it("should keep different keys independent", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart(KEY);

      expect(store.tryStart(OTHER_KEY)).not.toBeNull();
    });

    it("should keep the lock of the other key after one job finishes", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const first = store.tryStart(KEY);
      store.tryStart(OTHER_KEY);

      store.finish(first?.jobId ?? "", resultFixture());

      expect(store.tryStart(OTHER_KEY)).toBeNull();
    });

    it("should hand out distinct job ids", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const first = store.tryStart(KEY);
      const second = store.tryStart(OTHER_KEY);

      expect(first?.jobId).not.toBe(second?.jobId);
    });

    it("should return a copy so mutating the granted job does not release the lock", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);
      if (job) job.state = JobState.DONE;

      expect(store.tryStart(KEY)).toBeNull();
    });
  });

  describe("progress", () => {
    it("should store the step label, current and total on the snapshot", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);

      store.progress(job?.jobId ?? "", { label: "Cargar tabla de trabajo", current: 3, total: 8 });

      expect(store.get(job?.jobId ?? "")).toMatchObject({
        step: "Cargar tabla de trabajo",
        current: 3,
        total: 8,
        state: JobState.RUNNING,
      });
    });

    it("should keep the latest progress when it is reported several times", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);
      store.progress(job?.jobId ?? "", { label: "Uno", current: 1, total: 8 });

      store.progress(job?.jobId ?? "", { label: "Dos", current: 2, total: 8 });

      expect(store.get(job?.jobId ?? "")).toMatchObject({ step: "Dos", current: 2, total: 8 });
    });

    it("should keep the RUNNING lock while progress is reported", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);

      store.progress(job?.jobId ?? "", { label: "Uno", current: 1, total: 2 });

      expect(store.tryStart(KEY)).toBeNull();
    });

    it("should ignore progress for an unknown job id without throwing", () => {
      const store = createJobStore<TestResult>(() => NOW);

      expect(() => store.progress("missing", { label: "x", current: 1, total: 1 })).not.toThrow();
    });
  });

  describe("finish and fail", () => {
    it("should mark the job DONE with its result and finishedAt", () => {
      const store = createJobStore<TestResult>(() => NOW + 5);
      const job = store.tryStart(KEY);
      const result = resultFixture({ label: "listo" });

      store.finish(job?.jobId ?? "", result);

      expect(store.get(job?.jobId ?? "")).toMatchObject({
        state: JobState.DONE,
        result,
        finishedAt: NOW + 5,
        outcomeUnknown: false,
      });
    });

    it("should keep the state DONE and copy outcomeUnknown to the snapshot when the result has it", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);

      store.finish(job?.jobId ?? "", resultFixture({ outcomeUnknown: true }));

      expect(store.get(job?.jobId ?? "")).toMatchObject({ state: JobState.DONE, outcomeUnknown: true });
    });

    it("should mark the job FAILED with the error and finishedAt", () => {
      const store = createJobStore<TestResult>(() => NOW + 9);
      const job = store.tryStart(KEY);

      store.fail(job?.jobId ?? "", "Fallo de conexión");

      expect(store.get(job?.jobId ?? "")).toMatchObject({
        state: JobState.FAILED,
        error: "Fallo de conexión",
        finishedAt: NOW + 9,
      });
    });

    it("should release the lock when the job fails", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);

      store.fail(job?.jobId ?? "", "error");

      expect(store.tryStart(KEY)).not.toBeNull();
    });

    it("should ignore finish and fail for an unknown job id without throwing", () => {
      const store = createJobStore<TestResult>(() => NOW);

      expect(() => store.finish("missing", resultFixture())).not.toThrow();
      expect(() => store.fail("missing", "error")).not.toThrow();
    });
  });

  describe("get", () => {
    it("should return undefined for an unknown job id", () => {
      const store = createJobStore<TestResult>(() => NOW);

      expect(store.get("missing")).toBeUndefined();
    });

    it("should return a copy so mutating a snapshot does not change the store", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart(KEY);
      const snapshot = store.get(job?.jobId ?? "");
      if (snapshot) snapshot.step = "alterado";

      expect(store.get(job?.jobId ?? "")?.step).toBeNull();
    });
  });

  describe("sweep", () => {
    it("should remove only finished jobs older than the max age and return the count", () => {
      let clock = NOW;
      const store = createJobStore<TestResult>(() => clock);
      const old = store.tryStart(KEY);
      store.finish(old?.jobId ?? "", resultFixture());
      clock = NOW + HOUR_MS;
      const recent = store.tryStart(OTHER_KEY);
      store.finish(recent?.jobId ?? "", resultFixture());
      clock = NOW + HOUR_MS + 1;

      const removed = store.sweep(HOUR_MS);

      expect(removed).toBe(1);
      expect(store.get(old?.jobId ?? "")).toBeUndefined();
      expect(store.get(recent?.jobId ?? "")).toBeDefined();
    });

    it("should never remove a RUNNING job however old it is", () => {
      let clock = NOW;
      const store = createJobStore<TestResult>(() => clock);
      const job = store.tryStart(KEY);
      clock = NOW + 10 * HOUR_MS;

      expect(store.sweep(HOUR_MS)).toBe(0);
      expect(store.get(job?.jobId ?? "")?.state).toBe(JobState.RUNNING);
    });

    it("should measure age from finishedAt and not from startedAt", () => {
      let clock = NOW;
      const store = createJobStore<TestResult>(() => clock);
      const job = store.tryStart(KEY);
      clock = NOW + 2 * HOUR_MS;
      store.finish(job?.jobId ?? "", resultFixture());

      expect(store.sweep(HOUR_MS)).toBe(0);
    });

    it("should return 0 when the store is empty", () => {
      const store = createJobStore<TestResult>(() => NOW);

      expect(store.sweep(HOUR_MS)).toBe(0);
    });
  });

  describe("createJobStore instances", () => {
    it("should give each created store its own isolated state", () => {
      const first = createJobStore<TestResult>(() => NOW);
      const second = createJobStore<TestResult>(() => NOW);
      first.tryStart(KEY);

      expect(second.tryStart(KEY)).not.toBeNull();
    });
  });

  describe("getJobStore namespaces", () => {
    it("should return the same instance for the same namespace on repeated calls", () => {
      expect(getJobStore<TestResult>("ns-same-instance")).toBe(getJobStore<TestResult>("ns-same-instance"));
    });

    it("should return different instances for different namespaces", () => {
      expect(getJobStore<TestResult>("ns-distinct-first")).not.toBe(getJobStore<TestResult>("ns-distinct-second"));
    });

    it("should not let a RUNNING job in one namespace answer 409 for the same key in another", () => {
      const first = getJobStore<TestResult>("ns-independence-a");
      const second = getJobStore<TestResult>("ns-independence-b");
      const running = first.tryStart(KEY);

      const granted = second.tryStart(KEY);

      expect(running).not.toBeNull();
      expect(granted).not.toBeNull();
      first.fail(running?.jobId ?? "", "cleanup");
      second.fail(granted?.jobId ?? "", "cleanup");
    });

    it("should not find a job of one namespace through another namespace", () => {
      const first = getJobStore<TestResult>("ns-lookup-a");
      const second = getJobStore<TestResult>("ns-lookup-b");
      const running = first.tryStart(KEY);

      expect(second.get(running?.jobId ?? "")).toBeUndefined();
      first.fail(running?.jobId ?? "", "cleanup");
    });

    it("should keep a RUNNING lock of a namespace across module re-evaluation and free it on finish", async () => {
      const store = getJobStore<TestResult>("ns-reload");
      const job = store.tryStart(KEY);
      vi.resetModules();

      const reloaded = await import(STORE_MODULE);
      const reloadedStore = reloaded.getJobStore("ns-reload");

      expect(reloadedStore.tryStart(KEY)).toBeNull();
      store.finish(job?.jobId ?? "", resultFixture());
      const again = reloadedStore.tryStart(KEY);
      expect(again).not.toBeNull();
      reloadedStore.fail(again?.jobId ?? "", "cleanup");
    });

    it("should return the same namespace instance across module re-evaluation", async () => {
      const original = getJobStore<TestResult>("ns-reload-instance");
      vi.resetModules();

      const reloaded = await import(STORE_MODULE);

      expect(reloaded.getJobStore("ns-reload-instance")).toBe(original);
    });
  });
});
