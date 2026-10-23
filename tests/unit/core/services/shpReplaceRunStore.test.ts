import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { ShpReplaceRunClient } from "@/core/services/shpReplaceRunStore";
import type { DbConfig } from "@/core/types/db";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { ShpJobSnapshot } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import type { ShpReplaceResult } from "@/core/services/server/shpReplace/shpReplaceTypes";

import type { GeometryProcessingOptions, GeometryProcessingReport } from "@/core/types/geometryProcessing";

type Store = typeof import("@/core/services/shpReplaceRunStore");

const PROCESSING: GeometryProcessingOptions = {
  repair: { enabled: true },
  unify: { enabled: true, keyFields: ["NOMBRE"] },
  overlaps: { enabled: true, policy: "report", minAreaM2: 1 },
};

const GEOMETRY_REPORT: GeometryProcessingReport = {
  invalidBefore: 2,
  repaired: 2,
  emptyAfterRepair: 1,
  groups: 2,
  rowsMerged: 1,
  nullKeyRows: 0,
  largestGroups: [],
  attributeConflicts: 0,
  attributeConflictSamples: [],
  overlapCount: 0,
  overlapSamples: [],
  overlapSkippedInvalid: 0,
  insertedInvalid: 0,
  incompatibleGeometryRows: 0,
  wouldBlock: false,
};

interface FakeClient {
  upload: Mock<ShpReplaceRunClient["upload"]>;
  start: Mock<ShpReplaceRunClient["start"]>;
  status: Mock<ShpReplaceRunClient["status"]>;
}

type BeforeUnloadListener = (event: { preventDefault: () => void }) => void;

const PASSWORD = "s3cret-pw";
const POLL_MS = 2000;

const connection: DbConfig = {
  host: "tgt",
  port: "6543",
  db_name: "tdb",
  user: "u",
  password: PASSWORD,
  schema_name: "geo",
  table_name: "parcelas",
};

const mapping: ReplaceColumnMapping = {
  sourceByTarget: { nombre: "NOMBRE", geom: "__geometry__" },
  defaults: {},
};

const doneResult: ShpReplaceResult = {
  sourceRows: 3,
  stagedRows: 3,
  previousRows: 2,
  insertedRows: 3,
  dryRun: false,
  targetModified: true,
  sequencesAdjusted: [],
  analyze: { status: "ok" },
};

const job = (changes: Partial<ShpJobSnapshot> = {}): ShpJobSnapshot => ({
  jobId: "job-1",
  tableKey: "tgt:6543/tdb|geo|parcelas",
  state: "running",
  phase: null,
  detail: null,
  startedAt: 1,
  dryRun: false,
  ...changes,
});

const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeClient = (): FakeClient => ({
  upload: vi.fn<ShpReplaceRunClient["upload"]>(),
  start: vi.fn<ShpReplaceRunClient["start"]>(),
  status: vi.fn<ShpReplaceRunClient["status"]>(),
});

const runParams = (client: FakeClient, changes: Record<string, unknown> = {}) => ({
  file: new Blob(["zip-bytes"]),
  fileName: "Parcelas.zip",
  connection,
  mapping,
  sourceSrid: 32721,
  resetSequences: true,
  pollIntervalMs: POLL_MS,
  client,
  ...changes,
});

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
};

describe("shpReplaceRunStore", () => {
  let store: Store;
  let client: FakeClient;
  let windowListeners: Set<BeforeUnloadListener>;

  beforeEach(async () => {
    vi.resetModules();
    windowListeners = new Set();
    vi.stubGlobal("window", {
      addEventListener: (_type: string, listener: BeforeUnloadListener) => windowListeners.add(listener),
      removeEventListener: (_type: string, listener: BeforeUnloadListener) => windowListeners.delete(listener),
    });
    store = await import("@/core/services/shpReplaceRunStore");
    client = makeClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("initial state", () => {
    it("should start idle with empty fields and equal the server snapshot", () => {
      expect(store.getSnapshot()).toEqual({
        status: "idle",
        uploadPct: 0,
        phase: null,
        current: 0,
        total: 0,
        result: null,
        error: null,
        context: null,
        jobId: null,
        outcomeUnknown: false,
        uploadId: null,
        dryRun: false,
        report: null,
        detail: null,
      });
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });
  });

  describe("start while uploading", () => {
    it("should set UPLOADING and context synchronously before the upload resolves", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("uploading");
      expect(snapshot.uploadPct).toBe(0);
      expect(snapshot.context).toEqual({
        targetLabel: "geo.parcelas",
        targetServer: "tgt:6543/tdb",
        fileName: "Parcelas.zip",
        startedAt: expect.any(Number),
      });
    });

    it("should pass the file and an onProgress callback to the upload client", () => {
      client.upload.mockReturnValue(neverSettles());
      const params = runParams(client);
      void store.start(params);
      expect(client.upload).toHaveBeenCalledOnce();
      expect(client.upload.mock.calls[0][0]).toBe(params.file);
      expect(typeof client.upload.mock.calls[0][1]).toBe("function");
    });

    it("should map upload progress to an integer percentage", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      const onProgress = client.upload.mock.calls[0][1] as (loaded: number, total: number) => void;
      onProgress(50, 200);
      expect(store.getSnapshot().uploadPct).toBe(25);
      onProgress(1, 3);
      expect(store.getSnapshot().uploadPct).toBe(33);
      onProgress(200, 200);
      expect(store.getSnapshot().uploadPct).toBe(100);
    });

    it("should keep the step detail null while uploading", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      expect(store.getSnapshot().detail).toBeNull();
    });

    it("should not call start on the server before the upload resolves", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      expect(client.start).not.toHaveBeenCalled();
      expect(client.status).not.toHaveBeenCalled();
    });

    it("should ignore a second start while uploading", async () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      await store.start(runParams(client));
      expect(client.upload).toHaveBeenCalledOnce();
      expect(store.getSnapshot().status).toBe("uploading");
    });
  });

  describe("start: run phase", () => {
    it("should move to RUNNING with the jobId once upload and start both resolve", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client));
      await settle();
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("running");
      expect(snapshot.jobId).toBe("job-1");
      expect(snapshot.error).toBeNull();
    });

    it("should send the start body with uploadId, mapping, SRID, sequences flag and confirm", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client));
      await settle();
      expect(client.start).toHaveBeenCalledOnce();
      expect(client.start.mock.calls[0][0]).toEqual({
        host: "tgt",
        port: "6543",
        db_name: "tdb",
        user: "u",
        password: PASSWORD,
        schema_name: "geo",
        table_name: "parcelas",
        uploadId: "up-1",
        mapping,
        sourceSrid: 32721,
        resetSequences: true,
        confirm: true,
        geometryProcessing: {
          repair: { enabled: false },
          unify: { enabled: false, keyFields: [] },
          overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
        },
        dryRun: false,
      });
    });

    it("should poll status only after pollIntervalMs has elapsed", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client, { pollIntervalMs: 500 }));
      await settle();
      await vi.advanceTimersByTimeAsync(499);
      expect(client.status).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(client.status).toHaveBeenCalledOnce();
      expect(client.status).toHaveBeenCalledWith("job-1");
    });

    it("should default to a 2000 ms poll interval when none is given", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client, { pollIntervalMs: undefined }));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS - 1);
      expect(client.status).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(client.status).toHaveBeenCalledOnce();
    });

    it("should copy phase, current and total from the polled job", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running", phase: "staging", current: 500, total: 1000 }));
      void store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("running");
      expect(snapshot.phase).toBe("staging");
      expect(snapshot.current).toBe(500);
      expect(snapshot.total).toBe(1000);
    });

    it("should copy the step detail from the polled job", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(
        job({ state: "running", phase: "swapping", current: 1, total: 3, detail: "Bloqueando la tabla destino" })
      );
      void store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(store.getSnapshot().detail).toBe("Bloqueando la tabla destino");
    });

    it("should clear the step detail once the run settles as done", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status
        .mockResolvedValueOnce(
          job({ state: "running", phase: "finalizing", current: 1, total: 3, detail: "Ajustando secuencias" })
        )
        .mockResolvedValueOnce(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(store.getSnapshot().detail).toBe("Ajustando secuencias");
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(store.getSnapshot()).toMatchObject({ status: "done", detail: null });
    });

    it("should resolve to DONE with the result when the job state is done", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult, finishedAt: 5 }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("done");
      expect(snapshot.result).toEqual(doneResult);
      expect(snapshot.error).toBeNull();
    });

    it("should stop polling once the run is DONE", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      const callsAtDone = client.status.mock.calls.length;
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(client.status.mock.calls.length).toBe(callsAtDone);
    });

    it("should resolve to FAILED with the job error when the job state is failed", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "failed", error: "Tabla bloqueada por otro proceso." }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("failed");
      expect(snapshot.error).toBe("Tabla bloqueada por otro proceso.");
      expect(snapshot.result).toBeNull();
    });

    it("should resolve to FAILED with the upload error message when the upload rejects", async () => {
      client.upload.mockRejectedValue(new Error("El archivo supera el límite de 1 GiB."));
      await store.start(runParams(client));
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("failed");
      expect(snapshot.error).toBe("El archivo supera el límite de 1 GiB.");
      expect(client.start).not.toHaveBeenCalled();
    });

    it("should resolve to FAILED with the start error message when start rejects", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockRejectedValue(new Error("Ya hay una carga en curso para esta tabla."));
      await store.start(runParams(client));
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("failed");
      expect(snapshot.error).toBe("Ya hay una carga en curso para esta tabla.");
      expect(client.status).not.toHaveBeenCalled();
    });

    it("should use a non-empty fallback message when a non-Error rejection occurs", async () => {
      client.upload.mockRejectedValue("boom");
      await store.start(runParams(client));
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("failed");
      expect(typeof snapshot.error).toBe("string");
      expect(snapshot.error?.trim().length).toBeGreaterThan(0);
      expect(snapshot.error).not.toBe("boom");
    });
  });

  describe("transient status failures", () => {
    beforeEach(() => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
    });

    it("should stay RUNNING after a single failed status poll", async () => {
      client.status
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce(job({ state: "running", phase: "swapping" }));
      void store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(store.getSnapshot().status).toBe("running");
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(store.getSnapshot().status).toBe("running");
      expect(store.getSnapshot().phase).toBe("swapping");
    });

    it("should fail once consecutive status failures span pollFailureGraceMs with a message naming the job id", async () => {
      client.status.mockRejectedValue(new Error("network down"));
      void store.start(runParams(client, { pollIntervalMs: 1000, pollFailureGraceMs: 5000 }));
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      const snapshot = store.getSnapshot();
      expect(snapshot.status).toBe("failed");
      expect(snapshot.error).toContain("job-1");
      expect(snapshot.error).toMatch(/servidor/i);
    });

    it("should mark outcomeUnknown true when the run fails from status failures spanning pollFailureGraceMs", async () => {
      client.status.mockRejectedValue(new Error("network down"));
      void store.start(runParams(client, { pollIntervalMs: 1000, pollFailureGraceMs: 5000 }));
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(store.getSnapshot()).toMatchObject({ status: "failed", outcomeUnknown: true });
    });

    it("should stop polling after the run fails from status failures spanning pollFailureGraceMs", async () => {
      client.status.mockRejectedValue(new Error("network down"));
      void store.start(runParams(client, { pollIntervalMs: 1000, pollFailureGraceMs: 5000 }));
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(store.getSnapshot().status).toBe("failed");
      const callsAtFailure = client.status.mock.calls.length;
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(client.status.mock.calls.length).toBe(callsAtFailure);
    });

    it("should stay RUNNING with outcomeUnknown false while status failures span less than pollFailureGraceMs", async () => {
      client.status
        .mockRejectedValueOnce(new Error("a"))
        .mockRejectedValueOnce(new Error("b"))
        .mockRejectedValueOnce(new Error("c"))
        .mockRejectedValueOnce(new Error("d"))
        .mockResolvedValue(job({ state: "running", phase: "swapping" }));
      void store.start(runParams(client, { pollIntervalMs: 1000, pollFailureGraceMs: 5000 }));
      await settle();
      await vi.advanceTimersByTimeAsync(4000);
      expect(store.getSnapshot().status).toBe("running");
      await vi.advanceTimersByTimeAsync(5000);
      expect(store.getSnapshot().status).toBe("running");
      expect(store.getSnapshot().phase).toBe("swapping");
      expect(store.getSnapshot().outcomeUnknown).toBe(false);
    });

    it("should restart the grace window after a successful poll so that the run fails only after a new full grace period", async () => {
      client.status
        .mockRejectedValueOnce(new Error("a"))
        .mockRejectedValueOnce(new Error("b"))
        .mockRejectedValueOnce(new Error("c"))
        .mockRejectedValueOnce(new Error("d"))
        .mockResolvedValueOnce(job({ state: "running" }))
        .mockRejectedValue(new Error("network down"));
      void store.start(runParams(client, { pollIntervalMs: 1000, pollFailureGraceMs: 5000 }));
      await settle();
      await vi.advanceTimersByTimeAsync(8000);
      expect(store.getSnapshot().status).toBe("running");
      await vi.advanceTimersByTimeAsync(2000);
      expect(store.getSnapshot().status).toBe("running");
      await vi.advanceTimersByTimeAsync(2000);
      expect(store.getSnapshot().status).toBe("failed");
      expect(store.getSnapshot().outcomeUnknown).toBe(true);
    });

    it("should reset the failure count after a successful poll", async () => {
      client.status
        .mockRejectedValueOnce(new Error("a"))
        .mockRejectedValueOnce(new Error("b"))
        .mockResolvedValueOnce(job({ state: "running" }))
        .mockRejectedValueOnce(new Error("c"))
        .mockRejectedValueOnce(new Error("d"))
        .mockResolvedValueOnce(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(store.getSnapshot().status).toBe("running");
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(store.getSnapshot().status).toBe("done");
      expect(store.getSnapshot().result).toEqual(doneResult);
    });
  });

  describe("outcomeUnknown", () => {
    beforeEach(() => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
    });

    it("should copy outcomeUnknown true from a server-reported failed job", async () => {
      client.status.mockResolvedValue(
        job({ state: "failed", error: "No se pudo confirmar el reemplazo.", outcomeUnknown: true })
      );
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(store.getSnapshot()).toMatchObject({
        status: "failed",
        error: "No se pudo confirmar el reemplazo.",
        outcomeUnknown: true,
      });
    });

    it("should set outcomeUnknown false for a server-reported failed job that does not carry the flag", async () => {
      client.status.mockResolvedValue(job({ state: "failed", error: "Tabla bloqueada por otro proceso." }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(store.getSnapshot().outcomeUnknown).toBe(false);
    });

    it("should keep outcomeUnknown false when the run is DONE", async () => {
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(store.getSnapshot().outcomeUnknown).toBe(false);
    });

    it("should clear outcomeUnknown back to false when reset is called after a failure that set it", async () => {
      client.status.mockResolvedValue(job({ state: "failed", error: "x", outcomeUnknown: true }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(store.getSnapshot().outcomeUnknown).toBe(true);

      store.reset();

      expect(store.getSnapshot().outcomeUnknown).toBe(false);
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });
  });

  describe("password and secrets", () => {
    it("should never keep the password in any snapshot across the whole run", async () => {
      const upload = deferred<{ uploadId: string; size: number }>();
      client.upload.mockReturnValue(upload.promise);
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
      upload.resolve({ uploadId: "up-1", size: 9 });
      await settle();
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
    });

    it("should never keep the password after a start rejection", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockRejectedValue(new Error("Contraseña incorrecta."));
      await store.start(runParams(client));
      expect(store.getSnapshot().status).toBe("failed");
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
    });

    it("should never keep the password in the context", async () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      expect(JSON.stringify(store.getSnapshot().context)).not.toContain(PASSWORD);
    });
  });

  describe("busy guards and reset", () => {
    it("should ignore a second start while running", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client));
      await settle();
      expect(store.getSnapshot().status).toBe("running");
      await store.start(runParams(client));
      expect(client.upload).toHaveBeenCalledOnce();
      expect(client.start).toHaveBeenCalledOnce();
    });

    it("should allow a new run after a finished run is reset", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const first = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await first;
      store.reset();
      await store.start(runParams(client));
      expect(client.upload).toHaveBeenCalledTimes(2);
    });

    it("should be a no-op when reset is called while idle", () => {
      const before = store.getSnapshot();
      const listener = vi.fn();
      store.subscribe(listener);
      store.reset();
      expect(store.getSnapshot()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
    });

    it("should be a no-op when reset is called while uploading", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      const before = store.getSnapshot();
      store.reset();
      expect(store.getSnapshot()).toBe(before);
      expect(store.getSnapshot().status).toBe("uploading");
    });

    it("should be a no-op when reset is called while running", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client));
      await settle();
      const before = store.getSnapshot();
      store.reset();
      expect(store.getSnapshot()).toBe(before);
      expect(store.getSnapshot().status).toBe("running");
    });

    it("should return to idle when reset is called after done", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      store.reset();
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });

    it("should return to idle when reset is called after failed", async () => {
      client.upload.mockRejectedValue(new Error("x"));
      await store.start(runParams(client));
      store.reset();
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });
  });

  describe("subscribe and snapshot identity", () => {
    it("should return the same snapshot reference until the state changes", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      const before = store.getSnapshot();
      expect(store.getSnapshot()).toBe(before);
    });

    it("should notify listeners when the run state changes", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const listener = vi.fn();
      store.subscribe(listener);
      const run = store.start(runParams(client));
      expect(listener).toHaveBeenCalled();
      const callsAfterStart = listener.mock.calls.length;
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(listener.mock.calls.length).toBeGreaterThan(callsAfterStart);
    });

    it("should stop notifying a listener after unsubscribe", () => {
      client.upload.mockReturnValue(neverSettles());
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      unsubscribe();
      void store.start(runParams(client));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("beforeunload guard", () => {
    it("should register exactly one warning listener while uploading", () => {
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      expect(windowListeners.size).toBe(1);
      const [listener] = Array.from(windowListeners);
      const preventDefault = vi.fn();
      listener({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    });

    it("should remove the warning once the upload finishes and the job is running", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client));
      await settle();
      expect(store.getSnapshot().status).toBe("running");
      expect(windowListeners.size).toBe(0);
    });

    it("should not hold a warning listener after the run is done", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
      expect(windowListeners.size).toBe(0);
    });

    it("should not hold a warning listener after the run fails on upload", async () => {
      client.upload.mockRejectedValue(new Error("x"));
      await store.start(runParams(client));
      expect(windowListeners.size).toBe(0);
    });

    it("should work without window (SSR guard)", async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal("window", undefined);
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await expect(run).resolves.toBeUndefined();
      expect(store.getSnapshot().status).toBe("done");
    });
  });

  describe("reused upload", () => {
    it("should skip the upload and send the start with the given uploadId when uploadId is provided", async () => {
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      void store.start(runParams(client, { uploadId: "up-existing" }));
      await settle();

      expect(client.upload).not.toHaveBeenCalled();
      expect(client.start).toHaveBeenCalledOnce();
      expect(client.start.mock.calls[0][0].uploadId).toBe("up-existing");
    });

    it("should move straight to RUNNING with the jobId after start when uploadId is provided", async () => {
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      void store.start(runParams(client, { uploadId: "up-existing" }));
      await settle();

      expect(store.getSnapshot()).toMatchObject({ status: "running", jobId: "job-1", uploadPct: 100 });
    });

    it("should record the reused uploadId in the state", async () => {
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      void store.start(runParams(client, { uploadId: "up-existing" }));
      await settle();

      expect(store.getSnapshot().uploadId).toBe("up-existing");
    });
  });

  describe("uploadId retention", () => {
    it("should record the uploadId returned by a successful upload", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      void store.start(runParams(client));
      await settle();

      expect(store.getSnapshot().uploadId).toBe("up-1");
    });

    it("should keep the uploadId when the run finishes DONE", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      expect(store.getSnapshot()).toMatchObject({ status: "done", uploadId: "up-1" });
    });

    it("should keep the uploadId when the run finishes FAILED", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "failed", error: "Tabla bloqueada por otro proceso." }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      expect(store.getSnapshot()).toMatchObject({ status: "failed", uploadId: "up-1" });
    });

    it("should clear the uploadId when reset is called without options", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      store.reset();

      expect(store.getSnapshot().uploadId).toBeNull();
    });

    it("should keep the uploadId and return every other field to idle when reset is called with keepUpload true", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      store.reset({ keepUpload: true });

      expect(store.getSnapshot()).toEqual({ ...store.getServerSnapshot(), uploadId: "up-1" });
    });

    it("should start the real run without uploading again when an analysis kept its upload", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const analysis = store.start(runParams(client, { dryRun: true }));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await analysis;
      store.reset({ keepUpload: true });

      await store.start(runParams(client, { uploadId: store.getSnapshot().uploadId ?? undefined }));

      expect(client.upload).toHaveBeenCalledOnce();
      expect(client.start.mock.calls[1][0].uploadId).toBe("up-1");
    });
  });

  describe("dry run and geometry report", () => {
    it("should send dryRun true and the processing options in the start body when they are given", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      await store.start(runParams(client, { dryRun: true, processing: PROCESSING }));

      expect(client.start.mock.calls[0][0]).toMatchObject({ dryRun: true, geometryProcessing: PROCESSING });
    });

    it("should report dryRun true in the state while a dry run is running", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      await store.start(runParams(client, { dryRun: true }));

      expect(store.getSnapshot()).toMatchObject({ status: "running", dryRun: true });
    });

    it("should default dryRun to false in the state when the run does not set it", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));

      await store.start(runParams(client));

      expect(store.getSnapshot().dryRun).toBe(false);
    });

    it("should resolve to DONE with dryRun true and targetModified false when a dry run job is done", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(
        job({
          state: "done",
          dryRun: true,
          result: { ...doneResult, dryRun: true, targetModified: false, insertedRows: 0 },
        })
      );
      const run = store.start(runParams(client, { dryRun: true }));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      expect(store.getSnapshot()).toMatchObject({
        status: "done",
        dryRun: true,
        result: { dryRun: true, targetModified: false },
      });
    });

    it("should copy the geometry report from a done job into the state", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult, report: GEOMETRY_REPORT }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      expect(store.getSnapshot().report).toEqual(GEOMETRY_REPORT);
    });

    it("should copy the geometry report from a failed job blocked by overlaps into the state", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(
        job({
          state: "failed",
          error: "Se detectaron 2 solapes.",
          outcomeUnknown: false,
          report: { ...GEOMETRY_REPORT, overlapCount: 2, wouldBlock: true },
        })
      );
      const run = store.start(runParams(client, { processing: PROCESSING }));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      expect(store.getSnapshot()).toMatchObject({
        status: "failed",
        error: "Se detectaron 2 solapes.",
        report: { overlapCount: 2, wouldBlock: true },
      });
    });

    it("should set the state report to null when the job carries no report", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;

      expect(store.getSnapshot().report).toBeNull();
    });
  });

  describe("rerun", () => {
    const NEW_PASSWORD = "nueva-clave-2";

    const finishFirstRun = async (changes: Record<string, unknown> = {}) => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));
      const run = store.start(runParams(client, changes));
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await run;
    };

    it("should reuse the last start parameters and the stored uploadId without uploading again", async () => {
      await finishFirstRun();
      store.reset({ keepUpload: true });

      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });

      expect(client.upload).toHaveBeenCalledOnce();
      expect(client.start).toHaveBeenCalledTimes(2);
      expect(client.start.mock.calls[1][0]).toMatchObject({
        host: "tgt",
        port: "6543",
        db_name: "tdb",
        user: "u",
        schema_name: "geo",
        table_name: "parcelas",
        uploadId: "up-1",
        mapping,
        sourceSrid: 32721,
        resetSequences: true,
      });
    });

    it("should send the new password, processing options and dryRun given to rerun in the start body", async () => {
      await finishFirstRun();
      store.reset({ keepUpload: true });

      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: true });

      expect(client.start.mock.calls[1][0]).toMatchObject({
        password: NEW_PASSWORD,
        geometryProcessing: PROCESSING,
        dryRun: true,
      });
    });

    it("should never keep the password in any state snapshot during and after the rerun", async () => {
      await finishFirstRun();
      store.reset({ keepUpload: true });
      client.start.mockClear();
      client.status.mockResolvedValue(job({ state: "done", result: doneResult }));

      const rerun = store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });
      expect(JSON.stringify(store.getSnapshot())).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
      await settle();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await rerun;

      expect(JSON.stringify(store.getSnapshot())).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
      expect(JSON.stringify(store.getSnapshot().context)).not.toContain(NEW_PASSWORD);
    });

    it("should be a no-op when the store is uploading", async () => {
      await finishFirstRun();
      store.reset({ keepUpload: true });
      client.start.mockClear();
      client.upload.mockReturnValue(neverSettles());
      void store.start(runParams(client));
      expect(store.getSnapshot().status).toBe("uploading");

      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });

      expect(client.start).not.toHaveBeenCalled();
      expect(client.upload).toHaveBeenCalledTimes(2);
      expect(store.getSnapshot().status).toBe("uploading");
    });

    it("should be a no-op when the store is running", async () => {
      client.upload.mockResolvedValue({ uploadId: "up-1", size: 9 });
      client.start.mockResolvedValue({ jobId: "job-1" });
      client.status.mockResolvedValue(job({ state: "running" }));
      void store.start(runParams(client));
      await settle();
      expect(store.getSnapshot().status).toBe("running");

      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });

      expect(client.start).toHaveBeenCalledOnce();
      expect(client.upload).toHaveBeenCalledOnce();
      expect(store.getSnapshot().status).toBe("running");
    });

    it("should be a no-op when no run was ever started", async () => {
      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });

      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
      expect(client.upload).not.toHaveBeenCalled();
      expect(client.start).not.toHaveBeenCalled();
    });

    it("should be a no-op after reset without keepUpload clears the stored parameters", async () => {
      await finishFirstRun();
      store.reset();
      client.start.mockClear();

      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });

      expect(client.start).not.toHaveBeenCalled();
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
    });

    it("should keep the stored parameters so rerun still starts after reset with keepUpload true", async () => {
      await finishFirstRun();
      store.reset({ keepUpload: true });
      client.start.mockClear();

      await store.rerun({ password: NEW_PASSWORD, processing: PROCESSING, dryRun: false });

      expect(client.start).toHaveBeenCalledOnce();
      expect(client.start.mock.calls[0][0].uploadId).toBe("up-1");
    });
  });
});
