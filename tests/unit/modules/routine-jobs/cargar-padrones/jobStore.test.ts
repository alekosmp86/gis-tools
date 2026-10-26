import { describe, it, expect, vi } from "vitest";
import {
  JobState,
  createCargarPadronesJobStore,
  getCargarPadronesJobStore,
} from "@/modules/routine-jobs/jobs/cargar-padrones/services/jobStore";
import type { CargarPadronesResult, TypeReport } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { AnalyzeStatus } from "@/core/types/replace";

const STORE_MODULE = "@/modules/routine-jobs/jobs/cargar-padrones/services/jobStore";
const HOUR_MS = 60 * 60 * 1000;

const typeReport = (overrides: Partial<TypeReport> = {}): TypeReport => ({
  rowsRead: 10,
  groups: 8,
  rowsMerged: 2,
  repaired: 0,
  insertedInvalid: 0,
  repairedInUnion: 0,
  noGeometry: 0,
  nullKeyRows: 0,
  attributeConflicts: 0,
  attributeConflictSamples: [],
  inserted: 8,
  ...overrides,
});

const resultFixture = (overrides: Partial<CargarPadronesResult> = {}): CargarPadronesResult => ({
  dryRun: false,
  targetModified: true,
  outcomeUnknown: false,
  report: { rural: typeReport(), urbano: typeReport() },
  totals: { rowsRead: 20, groups: 16, rowsMerged: 4, inserted: 16 },
  ambiguousLocalityCodes: [],
  warnings: [],
  stepTimings: [],
  analyze: { status: AnalyzeStatus.OK },
  ...overrides,
});

function createClockedStore(start = 1_000) {
  const clock = { value: start };
  const store = createCargarPadronesJobStore(() => clock.value);
  return { store, clock };
}

function startJob(store: ReturnType<typeof createCargarPadronesJobStore>, key: string, dryRun?: boolean) {
  const job = store.tryStart(key, dryRun);
  if (!job) throw new Error(`expected tryStart(${key}) to grant a job`);
  return job;
}

describe("cargarPadronesJobStore", () => {
  describe("tryStart", () => {
    it("AC-26: should grant a RUNNING job with an id, the table key, a null step and the clock as startedAt", () => {
      const { store } = createClockedStore(5_000);

      const job = store.tryStart("host:5432|gis|cat|padron");

      expect(job).not.toBeNull();
      expect(job?.jobId).toBeTypeOf("string");
      expect(job?.jobId.length).toBeGreaterThan(0);
      expect(job).toMatchObject({
        tableKey: "host:5432|gis|cat|padron",
        state: JobState.RUNNING,
        step: null,
        dryRun: false,
        startedAt: 5_000,
      });
      expect(job?.finishedAt).toBeUndefined();
    });

    it("AC-26: should record the dryRun flag when it is passed", () => {
      const { store } = createClockedStore();

      const job = store.tryStart("host:5432|gis|cat|dry", true);

      expect(job?.dryRun).toBe(true);
    });

    it("AC-19/AC-26: should return null for a second start of the same key while the first is RUNNING", () => {
      const { store } = createClockedStore();
      startJob(store, "host:5432|gis|cat|padron");

      const second = store.tryStart("host:5432|gis|cat|padron");

      expect(second).toBeNull();
    });

    it("AC-19/AC-26: should refuse a dry run start while a real run of the same key is RUNNING", () => {
      const { store } = createClockedStore();
      startJob(store, "host:5432|gis|cat|padron", false);

      expect(store.tryStart("host:5432|gis|cat|padron", true)).toBeNull();
    });

    it("AC-19/AC-26: should grant the key again once the job finishes", () => {
      const { store } = createClockedStore();
      const first = startJob(store, "host:5432|gis|cat|padron");
      store.finish(first.jobId, resultFixture());

      const again = store.tryStart("host:5432|gis|cat|padron");

      expect(again).not.toBeNull();
      expect(again?.jobId).not.toBe(first.jobId);
    });

    it("AC-19/AC-26: should grant the key again once the job fails", () => {
      const { store } = createClockedStore();
      const first = startJob(store, "host:5432|gis|cat|padron");
      store.fail(first.jobId, "boom");

      expect(store.tryStart("host:5432|gis|cat|padron")).not.toBeNull();
    });

    it("AC-19/AC-26: should keep different keys independent", () => {
      const { store } = createClockedStore();
      startJob(store, "host:5432|gis|cat|padron_a");

      const other = store.tryStart("host:5432|gis|cat|padron_b");

      expect(other).not.toBeNull();
    });

    it("AC-26: should keep the lock of the other key after one job finishes", () => {
      const { store } = createClockedStore();
      const a = startJob(store, "host:5432|gis|cat|a");
      startJob(store, "host:5432|gis|cat|b");

      store.finish(a.jobId, resultFixture());

      expect(store.tryStart("host:5432|gis|cat|b")).toBeNull();
      expect(store.tryStart("host:5432|gis|cat|a")).not.toBeNull();
    });

    it("AC-26: should hand out distinct job ids", () => {
      const { store } = createClockedStore();

      const ids = ["k1", "k2", "k3"].map((key) => startJob(store, key).jobId);

      expect(new Set(ids).size).toBe(3);
    });

    it("AC-26: should accept an empty key as an ordinary key", () => {
      const { store } = createClockedStore();

      expect(store.tryStart("")).not.toBeNull();
      expect(store.tryStart("")).toBeNull();
    });
  });

  describe("progress", () => {
    it("AC-26/AC-27: should store the step label, current and total on the snapshot", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");

      store.progress(job.jobId, { label: "Carga rural", current: 5, total: 10 });

      expect(store.get(job.jobId)).toMatchObject({ state: JobState.RUNNING, step: "Carga rural", current: 5, total: 10 });
    });

    it("AC-26: should keep the latest progress when it is reported several times", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");

      store.progress(job.jobId, { label: "Conteo de filas", current: 2, total: 10 });
      store.progress(job.jobId, { label: "Carga urbana", current: 6, total: 10 });

      expect(store.get(job.jobId)).toMatchObject({ step: "Carga urbana", current: 6, total: 10 });
    });

    it("AC-26: should store a zero total as reported", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");

      store.progress(job.jobId, { label: "Vacío", current: 0, total: 0 });

      expect(store.get(job.jobId)).toMatchObject({ step: "Vacío", current: 0, total: 0 });
    });

    it("AC-26: should ignore progress for an unknown job id without throwing", () => {
      const { store } = createClockedStore();

      expect(() => store.progress("nope", { label: "x", current: 1, total: 1 })).not.toThrow();
      expect(store.get("nope")).toBeUndefined();
    });
  });

  describe("finish", () => {
    it("AC-26: should mark the job DONE with its result and finishedAt", () => {
      const { store, clock } = createClockedStore(1_000);
      const job = startJob(store, "k");
      clock.value = 4_000;
      const result = resultFixture();

      store.finish(job.jobId, result);

      const snapshot = store.get(job.jobId);
      expect(snapshot).toMatchObject({ state: JobState.DONE, finishedAt: 4_000, startedAt: 1_000 });
      expect(snapshot?.result).toEqual(result);
      expect(snapshot?.error).toBeUndefined();
    });

    it("AC-25: should keep the state DONE and copy outcomeUnknown to the snapshot when the result has outcomeUnknown", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");

      store.finish(job.jobId, resultFixture({ outcomeUnknown: true, targetModified: false }));

      const snapshot = store.get(job.jobId);
      expect(snapshot?.state).toBe(JobState.DONE);
      expect(snapshot?.outcomeUnknown).toBe(true);
    });

    it("AC-25: should not flag outcomeUnknown on the snapshot when the result does not", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");

      store.finish(job.jobId, resultFixture({ outcomeUnknown: false }));

      expect(store.get(job.jobId)?.outcomeUnknown).toBeFalsy();
    });

    it("AC-26: should ignore finish for an unknown job id without throwing", () => {
      const { store } = createClockedStore();

      expect(() => store.finish("nope", resultFixture())).not.toThrow();
    });
  });

  describe("fail", () => {
    it("AC-26: should mark the job FAILED with the error and finishedAt", () => {
      const { store, clock } = createClockedStore(1_000);
      const job = startJob(store, "k");
      clock.value = 9_000;

      store.fail(job.jobId, "No se pudo completar la carga.");

      expect(store.get(job.jobId)).toMatchObject({
        state: JobState.FAILED,
        error: "No se pudo completar la carga.",
        finishedAt: 9_000,
      });
      expect(store.get(job.jobId)?.result).toBeUndefined();
    });

    it("AC-26: should ignore fail for an unknown job id without throwing", () => {
      const { store } = createClockedStore();

      expect(() => store.fail("nope", "x")).not.toThrow();
    });
  });

  describe("get", () => {
    it("AC-25: should return undefined for an unknown job id", () => {
      const { store } = createClockedStore();

      expect(store.get("does-not-exist")).toBeUndefined();
    });

    it("AC-26: should return a copy so mutating a snapshot does not change the store", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");
      const snapshot = store.get(job.jobId);
      if (!snapshot) throw new Error("expected a snapshot");

      snapshot.state = JobState.FAILED;
      snapshot.error = "tampered";

      expect(store.get(job.jobId)).toMatchObject({ state: JobState.RUNNING });
      expect(store.get(job.jobId)?.error).toBeUndefined();
    });

    it("AC-26: should return a copy from tryStart so mutating it does not release the lock", () => {
      const { store } = createClockedStore();
      const job = startJob(store, "k");

      job.state = JobState.DONE;

      expect(store.tryStart("k")).toBeNull();
      expect(store.get(job.jobId)?.state).toBe(JobState.RUNNING);
    });
  });

  describe("sweep", () => {
    it("AC-26: should remove only finished jobs older than the max age and return the count", () => {
      const { store, clock } = createClockedStore(0);
      const doneOld = startJob(store, "done-old");
      const failedOld = startJob(store, "failed-old");
      const running = startJob(store, "running");
      store.finish(doneOld.jobId, resultFixture());
      store.fail(failedOld.jobId, "x");
      clock.value = HOUR_MS + 1;
      const doneRecent = startJob(store, "done-recent");
      store.finish(doneRecent.jobId, resultFixture());

      const removed = store.sweep(HOUR_MS);

      expect(removed).toBe(2);
      expect(store.get(doneOld.jobId)).toBeUndefined();
      expect(store.get(failedOld.jobId)).toBeUndefined();
      expect(store.get(doneRecent.jobId)).toBeDefined();
      expect(store.get(running.jobId)?.state).toBe(JobState.RUNNING);
    });

    it("AC-26: should never remove a RUNNING job however old it is", () => {
      const { store, clock } = createClockedStore(0);
      const running = startJob(store, "running");
      clock.value = 100 * HOUR_MS;

      const removed = store.sweep(HOUR_MS);

      expect(removed).toBe(0);
      expect(store.get(running.jobId)).toBeDefined();
      expect(store.tryStart("running")).toBeNull();
    });

    it("AC-26: should keep a finished job whose age equals the max age exactly", () => {
      const { store, clock } = createClockedStore(0);
      const job = startJob(store, "k");
      store.finish(job.jobId, resultFixture());
      clock.value = HOUR_MS;

      expect(store.sweep(HOUR_MS)).toBe(0);
      expect(store.get(job.jobId)).toBeDefined();
    });

    it("AC-26: should return 0 when the store is empty", () => {
      const { store } = createClockedStore();

      expect(store.sweep(HOUR_MS)).toBe(0);
    });

    it("AC-26: should measure age from finishedAt and not from startedAt", () => {
      const { store, clock } = createClockedStore(0);
      const job = startJob(store, "k");
      clock.value = 5 * HOUR_MS;
      store.finish(job.jobId, resultFixture());
      clock.value = 5 * HOUR_MS + 1_000;

      expect(store.sweep(HOUR_MS)).toBe(0);
      expect(store.get(job.jobId)).toBeDefined();
    });
  });

  describe("singleton", () => {
    it("AC-26: should return the same instance on repeated calls", () => {
      expect(getCargarPadronesJobStore()).toBe(getCargarPadronesJobStore());
    });

    it("AC-26: should return the same instance across module re-evaluation", async () => {
      const original = getCargarPadronesJobStore();
      vi.resetModules();

      const reloaded = await import(STORE_MODULE);

      expect(reloaded.getCargarPadronesJobStore()).toBe(original);
    });

    it("AC-19/AC-26: should keep a RUNNING lock across module re-evaluation and free it on finish", async () => {
      const key = "singleton-reload:5432|gis|cat|padron";
      const store = getCargarPadronesJobStore();
      const job = startJob(store, key);
      vi.resetModules();

      const reloaded = await import(STORE_MODULE);
      const reloadedStore = reloaded.getCargarPadronesJobStore();

      expect(reloadedStore.tryStart(key)).toBeNull();
      expect(reloadedStore.get(job.jobId)?.state).toBe(JobState.RUNNING);
      store.finish(job.jobId, resultFixture());
      const again = reloadedStore.tryStart(key);
      expect(again).not.toBeNull();
      reloadedStore.fail(again?.jobId ?? "", "cleanup");
    });

    it("AC-26: should give createCargarPadronesJobStore its own isolated state", () => {
      const first = createCargarPadronesJobStore();
      const second = createCargarPadronesJobStore();
      startJob(first, "isolated");

      expect(second.tryStart("isolated")).not.toBeNull();
    });
  });
});
