import { describe, expect, it } from "vitest";
import {
  ShpJobState,
  createShpJobStore,
  getShpJobStore,
  type ShpJobSnapshot,
  type ShpJobStore,
} from "@/core/services/server/shpReplace/shpReplaceJobStore";
import type { ShpReplaceResult } from "@/core/services/server/shpReplace/shpReplaceTypes";
import { AnalyzeStatus } from "@/core/types/replace";
import type { GeometryProcessingReport } from "@/core/types/geometryProcessing";

const TABLE_KEY = "gis|public|parcelas";
const OTHER_TABLE_KEY = "gis|public|otra";
const HOUR_MS = 60 * 60 * 1000;

const RESULT: ShpReplaceResult = {
  sourceRows: 3,
  stagedRows: 3,
  previousRows: 7,
  insertedRows: 3,
  dryRun: false,
  targetModified: true,
  sequencesAdjusted: [],
  analyze: { status: AnalyzeStatus.OK },
};

const REPORT: GeometryProcessingReport = {
  invalidBefore: 1,
  repaired: 1,
  emptyAfterRepair: 0,
  groups: 2,
  rowsMerged: 1,
  nullKeyRows: 0,
  largestGroups: [],
  attributeConflicts: 0,
  attributeConflictSamples: [],
  overlapCount: 2,
  overlapSamples: [],
  overlapSkippedInvalid: 0,
  insertedInvalid: 0,
  incompatibleGeometryRows: 0,
  wouldBlock: true,
};

function startOrFail(store: ShpJobStore, tableKey: string): ShpJobSnapshot {
  const snapshot = store.tryStart(tableKey);
  if (!snapshot) throw new Error(`expected a job to start for ${tableKey}`);
  return snapshot;
}

describe("createShpJobStore", () => {
  describe("tryStart", () => {
    it("should return a RUNNING snapshot with the table key, a null phase and startedAt from the clock when no job holds the key", () => {
      const clock = 1_000;
      const store = createShpJobStore(() => clock);

      const snapshot = store.tryStart(TABLE_KEY);

      expect(snapshot).not.toBeNull();
      expect(snapshot?.state).toBe(ShpJobState.RUNNING);
      expect(snapshot?.tableKey).toBe(TABLE_KEY);
      expect(snapshot?.phase).toBeNull();
      expect(snapshot?.startedAt).toBe(1_000);
      expect(snapshot?.finishedAt).toBeUndefined();
      expect(typeof snapshot?.jobId).toBe("string");
      expect(snapshot?.jobId.length).toBeGreaterThan(0);
    });

    it("should return a RUNNING snapshot with a null step detail when no job holds the key", () => {
      const store = createShpJobStore(() => 0);

      expect(store.tryStart(TABLE_KEY)?.detail).toBeNull();
    });

    it("should return null when a RUNNING job already holds the same table key", () => {
      const store = createShpJobStore(() => 0);
      startOrFail(store, TABLE_KEY);

      expect(store.tryStart(TABLE_KEY)).toBeNull();
    });

    it("should return a snapshot when a RUNNING job holds a different table key", () => {
      const store = createShpJobStore(() => 0);
      startOrFail(store, TABLE_KEY);

      expect(store.tryStart(OTHER_TABLE_KEY)).not.toBeNull();
    });

    it("should return a snapshot for the same key once the previous job has finished", () => {
      const store = createShpJobStore(() => 0);
      const first = startOrFail(store, TABLE_KEY);
      store.finish(first.jobId, RESULT);

      expect(store.tryStart(TABLE_KEY)).not.toBeNull();
    });

    it("should return a snapshot for the same key once the previous job has failed", () => {
      const store = createShpJobStore(() => 0);
      const first = startOrFail(store, TABLE_KEY);
      store.fail(first.jobId, "fallo");

      expect(store.tryStart(TABLE_KEY)).not.toBeNull();
    });

    it("should return distinct jobIds when two different tables start", () => {
      const store = createShpJobStore(() => 0);

      const first = startOrFail(store, TABLE_KEY);
      const second = startOrFail(store, OTHER_TABLE_KEY);

      expect(first.jobId).not.toBe(second.jobId);
    });
  });

  describe("progress", () => {
    it("should update phase, current and total of a running job when progress is reported", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);

      store.progress(job.jobId, { phase: "staging", current: 2, total: 3 });

      expect(store.get(job.jobId)).toMatchObject({ state: ShpJobState.RUNNING, phase: "staging", current: 2, total: 3 });
    });

    it("should store the step detail on the running job when progress carries a detail", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);

      store.progress(job.jobId, { phase: "processing", current: 2, total: 6, detail: "Reparando geometrías" });

      expect(store.get(job.jobId)).toMatchObject({
        phase: "processing",
        current: 2,
        total: 6,
        detail: "Reparando geometrías",
      });
    });

    it("should set the step detail to null when progress carries no detail after a step was reported", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);
      store.progress(job.jobId, { phase: "processing", current: 2, total: 6, detail: "Reparando geometrías" });

      store.progress(job.jobId, { phase: "staging", current: 2, total: 3 });

      expect(store.get(job.jobId)?.detail).toBeNull();
    });

    it("should ignore progress for an unknown jobId without throwing", () => {
      const store = createShpJobStore(() => 0);

      expect(() => store.progress("no-such-job", { phase: "staging", current: 1, total: 1 })).not.toThrow();
      expect(store.get("no-such-job")).toBeUndefined();
    });
  });

  describe("finish", () => {
    it("should mark the job DONE with its result and finishedAt from the clock when finish is called", () => {
      let clock = 100;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      clock = 250;

      store.finish(job.jobId, RESULT);

      expect(store.get(job.jobId)).toMatchObject({ state: ShpJobState.DONE, result: RESULT, finishedAt: 250 });
    });

    it("should set the step detail to null when the job finishes after reporting a step", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);
      store.progress(job.jobId, { phase: "finalizing", current: 3, total: 3, detail: "Actualizando estadísticas" });

      store.finish(job.jobId, RESULT);

      expect(store.get(job.jobId)?.detail).toBeNull();
    });

    it("should do nothing without throwing when finish is called with an unknown jobId", () => {
      const store = createShpJobStore(() => 0);

      expect(() => store.finish("no-such-job", RESULT)).not.toThrow();
      expect(store.get("no-such-job")).toBeUndefined();
    });
  });

  describe("fail", () => {
    it("should record outcomeUnknown false on the snapshot when fail is called without the flag", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);

      store.fail(job.jobId, "fallo");

      expect(store.get(job.jobId)?.outcomeUnknown).toBe(false);
    });

    it("should record outcomeUnknown true on the snapshot when fail is called with outcomeUnknown true", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);

      store.fail(job.jobId, "No se pudo confirmar el reemplazo.", true);

      expect(store.get(job.jobId)).toMatchObject({
        state: ShpJobState.FAILED,
        error: "No se pudo confirmar el reemplazo.",
        outcomeUnknown: true,
      });
    });

    it("should keep outcomeUnknown true on the snapshot when the clock advances after the failure", () => {
      let clock = 0;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      store.fail(job.jobId, "No se pudo confirmar el reemplazo.", true);
      clock = 10;

      expect(store.get(job.jobId)?.outcomeUnknown).toBe(true);
    });

    it("should mark the job FAILED with the error message and finishedAt when fail is called", () => {
      let clock = 10;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      clock = 40;

      store.fail(job.jobId, "No se pudo completar el reemplazo.");

      expect(store.get(job.jobId)).toMatchObject({
        state: ShpJobState.FAILED,
        error: "No se pudo completar el reemplazo.",
        finishedAt: 40,
      });
    });

    it("should set the step detail to null when the job fails after reporting a step", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);
      store.progress(job.jobId, { phase: "swapping", current: 1, total: 3, detail: "Bloqueando la tabla destino" });

      store.fail(job.jobId, "fallo");

      expect(store.get(job.jobId)?.detail).toBeNull();
    });

    it("should do nothing without throwing when fail is called with an unknown jobId", () => {
      const store = createShpJobStore(() => 0);

      expect(() => store.fail("no-such-job", "error")).not.toThrow();
      expect(store.get("no-such-job")).toBeUndefined();
    });
  });

  describe("get", () => {
    it("should return undefined when the jobId is unknown", () => {
      const store = createShpJobStore(() => 0);

      expect(store.get("no-such-job")).toBeUndefined();
    });

    it("should return the snapshot with the same jobId and table key when the jobId is known", () => {
      const store = createShpJobStore(() => 0);
      const job = startOrFail(store, TABLE_KEY);

      expect(store.get(job.jobId)).toMatchObject({ jobId: job.jobId, tableKey: TABLE_KEY, state: ShpJobState.RUNNING });
    });
  });

  describe("sweep", () => {
    it("should remove a DONE job finished more than maxAgeMs ago and return one", () => {
      let clock = 0;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      store.finish(job.jobId, RESULT);
      clock = HOUR_MS + 1;

      const removed = store.sweep(HOUR_MS);

      expect(removed).toBe(1);
      expect(store.get(job.jobId)).toBeUndefined();
    });

    it("should remove a FAILED job finished more than maxAgeMs ago", () => {
      let clock = 0;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      store.fail(job.jobId, "fallo");
      clock = HOUR_MS + 1;

      expect(store.sweep(HOUR_MS)).toBe(1);
      expect(store.get(job.jobId)).toBeUndefined();
    });

    it("should keep a finished job whose age equals maxAgeMs exactly", () => {
      let clock = 0;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      store.finish(job.jobId, RESULT);
      clock = HOUR_MS;

      expect(store.sweep(HOUR_MS)).toBe(0);
      expect(store.get(job.jobId)).toBeDefined();
    });

    it("should keep a finished job that finished recently", () => {
      let clock = 0;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      store.finish(job.jobId, RESULT);
      clock = 60_000;

      expect(store.sweep(HOUR_MS)).toBe(0);
      expect(store.get(job.jobId)).toBeDefined();
    });

    it("should keep a RUNNING job even when it started more than maxAgeMs ago", () => {
      let clock = 0;
      const store = createShpJobStore(() => clock);
      const job = startOrFail(store, TABLE_KEY);
      clock = 5 * HOUR_MS;

      expect(store.sweep(HOUR_MS)).toBe(0);
      expect(store.get(job.jobId)?.state).toBe(ShpJobState.RUNNING);
    });

    it("should return zero when the store holds no jobs", () => {
      const store = createShpJobStore(() => 0);

      expect(store.sweep(HOUR_MS)).toBe(0);
    });
  });
});

describe("getShpJobStore", () => {
  it("should return the same store instance on every call", () => {
    expect(getShpJobStore()).toBe(getShpJobStore());
  });

  it("should expose a job started through one reference through the other reference", () => {
    const first = getShpJobStore();
    const job = startOrFail(first, "singleton|public|job-visibility");

    expect(getShpJobStore().get(job.jobId)?.tableKey).toBe("singleton|public|job-visibility");

    first.fail(job.jobId, "limpieza del test");
  });
});

describe("createShpJobStore geometry report", () => {
  it("should expose the result geometry as the snapshot report when finish is called with a geometry", () => {
    const store = createShpJobStore(() => 0);
    const job = startOrFail(store, TABLE_KEY);

    store.finish(job.jobId, { ...RESULT, geometry: REPORT });

    expect(store.get(job.jobId)).toMatchObject({ state: ShpJobState.DONE, report: REPORT });
  });

  it("should leave the snapshot report undefined when finish is called with a result without geometry", () => {
    const store = createShpJobStore(() => 0);
    const job = startOrFail(store, TABLE_KEY);

    store.finish(job.jobId, RESULT);

    expect(store.get(job.jobId)?.report).toBeUndefined();
  });

  it("should store the report on the FAILED snapshot with outcomeUnknown false when fail is called with a report", () => {
    const store = createShpJobStore(() => 0);
    const job = startOrFail(store, TABLE_KEY);

    store.fail(job.jobId, "Se detectaron 2 solapes.", false, REPORT);

    expect(store.get(job.jobId)).toMatchObject({
      state: ShpJobState.FAILED,
      error: "Se detectaron 2 solapes.",
      outcomeUnknown: false,
      report: REPORT,
    });
  });

  it("should leave the snapshot report undefined when fail is called without a report", () => {
    const store = createShpJobStore(() => 0);
    const job = startOrFail(store, TABLE_KEY);

    store.fail(job.jobId, "fallo");

    expect(store.get(job.jobId)?.report).toBeUndefined();
  });
});
