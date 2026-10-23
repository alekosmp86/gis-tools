import { beforeEach, describe, expect, it } from "vitest";
import {
  handleStart,
  handleStatus,
  handleUpload,
  type ShpReplaceHandlerDeps,
} from "@/core/services/server/shpReplace/shpReplaceHandlers";
import { ShpJobState, createShpJobStore, type ShpJobStore } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import { SHP_GEOMETRY_SOURCE, type OpenShapefile } from "@/core/services/server/shpReplace/shpRecordSource";
import type { PgShpConfig } from "@/core/services/server/shpReplace/pgShpSession";
import {
  ShpCommitUncertainError,
  ShpProcessingBlockedError,
  type RunShpReplaceParams,
  type ShpReplaceResult,
  type ShpReplaceSession,
} from "@/core/services/server/shpReplace/shpReplaceTypes";
import { UploadInvalidError, UploadNotFoundError, UploadTooLargeError } from "@/core/services/server/shpReplace/shpUploadStore";
import { AnalyzeStatus } from "@/core/types/replace";
import type { GeometryProcessingReport } from "@/core/types/geometryProcessing";

const SHP_URL = "http://localhost/api/db/shp-replace";
const UPLOAD_ID = "123e4567-e89b-42d3-a456-426614174000";
const PASSWORD = "s3cret-pass";
const TABLE_KEY = "gis|public|parcelas";
const SPANISH_MARKER = /\b(el|la|los|las|de|del|no|que|con|para|se|una|un|en)\b|[áéíóúñ¿¡]/i;
const ZIP_BYTES = Uint8Array.of(1, 2, 3);

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

const DRY_RUN_RESULT: ShpReplaceResult = {
  ...RESULT,
  dryRun: true,
  targetModified: false,
  insertedRows: 0,
};

const PROCESSING_BODY = {
  repair: { enabled: true },
  unify: { enabled: true, keyFields: ["NOMBRE"] },
  overlaps: { enabled: true, policy: "report", minAreaM2: 1 },
};

const PARSED_PROCESSING = {
  repair: { enabled: true },
  unify: { enabled: true, keyFields: ["NOMBRE"] },
  overlaps: { enabled: true, policy: "report", minAreaM2: 1 },
};

const DISABLED_PROCESSING = {
  repair: { enabled: false },
  unify: { enabled: false, keyFields: [] },
  overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
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
  overlapCount: 3,
  overlapSamples: [],
  overlapSkippedInvalid: 0,
  insertedInvalid: 0,
  incompatibleGeometryRows: 0,
  incompatibleTargetType: null,
  wouldBlock: false,
  stepTimings: [],
  processingMs: 0,
};

const BLOCKED_REPORT: GeometryProcessingReport = { ...GEOMETRY_REPORT, overlapCount: 3, wouldBlock: true };

const BLOCKED_MESSAGE = "No se puede reemplazar: se detectaron 3 solapes entre geometrías.";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface RunCall {
  open: () => Promise<ShpReplaceSession>;
  params: RunShpReplaceParams;
}

interface Harness {
  store: ShpJobStore;
  files: Map<string, Uint8Array>;
  deleted: string[];
  savedBytes: Array<{ fileName: string; bytes: Uint8Array | null }>;
  zipsOpened: Uint8Array[];
  sessionsOpened: PgShpConfig[];
  runCalls: RunCall[];
  pending: Array<Deferred<ShpReplaceResult>>;
  shapefile: OpenShapefile;
  deps: ShpReplaceHandlerDeps;
}

async function readAllBytes(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function createHarness(): Harness {
  const store = createShpJobStore(() => 0);
  const files = new Map<string, Uint8Array>([[UPLOAD_ID, ZIP_BYTES]]);
  const deleted: string[] = [];
  const savedBytes: Harness["savedBytes"] = [];
  const zipsOpened: Uint8Array[] = [];
  const sessionsOpened: PgShpConfig[] = [];
  const runCalls: RunCall[] = [];
  const pending: Array<Deferred<ShpReplaceResult>> = [];
  const shapefile: OpenShapefile = {
    fieldNames: ["NOMBRE", "AREA"],
    recordCount: 3,
    shapeRecordCount: 3,
    prjText: null,
    *records() {
      yield* [];
    },
  };
  const session: ShpReplaceSession = {
    query: async () => ({ rows: [], rowCount: 0 }),
    copyIn: async () => 0,
    close: async () => undefined,
  };

  const deps: ShpReplaceHandlerDeps = {
    store,
    uploads: {
      read: async (id: string) => {
        const bytes = files.get(id);
        if (!bytes) throw new UploadNotFoundError(`No existe la subida ${id}.`);
        return bytes;
      },
      delete: async (id: string) => {
        deleted.push(id);
        files.delete(id);
      },
      save: async (body, fileName) => {
        const bytes = body ? await readAllBytes(body) : null;
        savedBytes.push({ fileName, bytes });
        if (!/\.zip$/i.test(fileName ?? "")) throw new UploadInvalidError("Solo se admiten archivos .zip.");
        if (bytes === null) throw new UploadInvalidError("La petición no contiene datos.");
        return { uploadId: UPLOAD_ID, size: bytes.length };
      },
    },
    openShapefile: async (zip: Uint8Array) => {
      zipsOpened.push(zip);
      return shapefile;
    },
    openSession: async (config: PgShpConfig) => {
      sessionsOpened.push(config);
      return session;
    },
    runReplace: (open: () => Promise<ShpReplaceSession>, params: RunShpReplaceParams) => {
      runCalls.push({ open, params });
      const deferred = createDeferred<ShpReplaceResult>();
      pending.push(deferred);
      return deferred.promise;
    },
  };

  return { store, files, deleted, savedBytes, zipsOpened, sessionsOpened, runCalls, pending, shapefile, deps };
}

function validStartBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "localhost",
    port: 5432,
    db_name: "gis",
    user: "app",
    password: PASSWORD,
    schema_name: "public",
    table_name: "parcelas",
    uploadId: UPLOAD_ID,
    mapping: { sourceByTarget: { nombre: "NOMBRE", geom: SHP_GEOMETRY_SOURCE }, defaults: {} },
    sourceSrid: 25830,
    resetSequences: false,
    confirm: true,
    ...overrides,
  };
}

function startRequest(body: unknown): Request {
  return new Request(`${SHP_URL}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function uploadRequest(options: { fileName?: string; body?: Uint8Array | null }): Request {
  const headers: Record<string, string> = {};
  if (options.fileName !== undefined) headers["x-file-name"] = options.fileName;
  return new Request(`${SHP_URL}/upload`, {
    method: "POST",
    headers,
    body: (options.body === undefined ? ZIP_BYTES : options.body) as BodyInit | null,
  });
}

function statusRequest(jobId?: string): Request {
  const query = jobId === undefined ? "" : `?jobId=${encodeURIComponent(jobId)}`;
  return new Request(`${SHP_URL}/status${query}`, { method: "GET" });
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function settle(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function expectSpanishFailure(body: Record<string, unknown>): void {
  expect(body.success).toBe(false);
  expect(typeof body.error).toBe("string");
  expect(body.error as string).toMatch(SPANISH_MARKER);
}

describe("shpReplaceHandlers", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("handleUpload", () => {
    it("should respond 200 with uploadId and size when the zip body is accepted", async () => {
      const response = await handleUpload(uploadRequest({ fileName: "parcelas.zip" }), harness.deps);

      const { status, body } = await readJson(response);
      expect(status).toBe(200);
      expect(body).toEqual({ success: true, uploadId: UPLOAD_ID, size: 3 });
    });

    it("should pass the x-file-name header and the raw body bytes to save when the upload is valid", async () => {
      await handleUpload(uploadRequest({ fileName: "parcelas.zip" }), harness.deps);

      expect(harness.savedBytes).toHaveLength(1);
      expect(harness.savedBytes[0].fileName).toBe("parcelas.zip");
      expect(Array.from(harness.savedBytes[0].bytes ?? [])).toEqual([1, 2, 3]);
    });

    it("should respond 400 with a Spanish error when the x-file-name header is missing", async () => {
      const response = await handleUpload(uploadRequest({}), harness.deps);

      const { status, body } = await readJson(response);
      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 400 with a Spanish error when the file is not a zip", async () => {
      const response = await handleUpload(uploadRequest({ fileName: "parcelas.shp" }), harness.deps);

      const { status, body } = await readJson(response);
      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 400 with a Spanish error when the request has no body", async () => {
      const response = await handleUpload(uploadRequest({ fileName: "parcelas.zip", body: null }), harness.deps);

      const { status, body } = await readJson(response);
      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 413 with a Spanish error when save rejects with UploadTooLargeError", async () => {
      const response = await handleUpload(uploadRequest({ fileName: "parcelas.zip" }), {
        uploads: {
          ...harness.deps.uploads,
          save: async () => {
            throw new UploadTooLargeError("El archivo supera el límite de 1 GiB.");
          },
        },
      });

      const { status, body } = await readJson(response);
      expect(status).toBe(413);
      expectSpanishFailure(body);
    });
  });

  describe("handleStart validation", () => {
    it.each<[string, string | Record<string, unknown>]>([
      ["the body is not JSON", "{no es json"],
      ["confirm is missing", validStartBody({ confirm: undefined })],
      ["confirm is false", validStartBody({ confirm: false })],
      ["confirm is the string 'true'", validStartBody({ confirm: "true" })],
      ["db_name is missing", validStartBody({ db_name: undefined })],
      ["user is empty", validStartBody({ user: "" })],
      ["password is missing", validStartBody({ password: undefined })],
      ["password is empty", validStartBody({ password: "" })],
      ["table_name is missing", validStartBody({ table_name: undefined })],
      ["uploadId is missing", validStartBody({ uploadId: undefined })],
      ["mapping is missing", validStartBody({ mapping: undefined })],
      ["mapping.sourceByTarget is a string", validStartBody({ mapping: { sourceByTarget: "nombre", defaults: {} } })],
      ["a mapping source is a number", validStartBody({ mapping: { sourceByTarget: { nombre: 5 }, defaults: {} } })],
      ["mapping.defaults is missing", validStartBody({ mapping: { sourceByTarget: { nombre: "NOMBRE" } } })],
      ["sourceSrid is zero", validStartBody({ sourceSrid: 0 })],
      ["sourceSrid is above the SRID ceiling", validStartBody({ sourceSrid: 998999 + 1 })],
      ["sourceSrid is not an integer", validStartBody({ sourceSrid: 25830.5 })],
      ["sourceSrid is a string", validStartBody({ sourceSrid: "25830" })],
      ["sourceSrid is missing", validStartBody({ sourceSrid: undefined })],
    ])("should respond 400 with a Spanish error and no side effect when %s", async (_label, payload) => {
      const { status, body } = await readJson(await handleStart(startRequest(payload), harness.deps));

      expect(status).toBe(400);
      expectSpanishFailure(body);
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
      expect(harness.runCalls).toHaveLength(0);
      expect(harness.deleted).toEqual([]);
      expect(harness.store.tryStart(TABLE_KEY)).not.toBeNull();
    });
  });

  describe("handleStart upload lookup", () => {
    it("should respond 404 with a Spanish error when the uploadId is unknown", async () => {
      harness.files.clear();

      const { status, body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(404);
      expectSpanishFailure(body);
      expect(harness.runCalls).toHaveLength(0);
    });

    it("should release the table lock after a 404 so that a later valid start succeeds", async () => {
      harness.files.clear();
      await handleStart(startRequest(validStartBody()), harness.deps);
      harness.files.set(UPLOAD_ID, ZIP_BYTES);

      const { status } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
    });
  });

  describe("handleStart table lock", () => {
    async function startRunningJob(overrides: Record<string, unknown> = {}): Promise<void> {
      const { status } = await readJson(await handleStart(startRequest(validStartBody(overrides)), harness.deps));
      if (status !== 200) throw new Error(`expected the first start to succeed but got ${status}`);
      await settle(() => harness.pending.length === 1);
    }

    it("should respond 409 with a Spanish error and keep the upload when the same host, port, database and table already have a running job", async () => {
      await startRunningJob();

      const { status, body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(409);
      expectSpanishFailure(body);
      expect(harness.runCalls).toHaveLength(1);
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
    });

    it("should respond 409 when schema_name is omitted and the running job used public for the same table", async () => {
      await startRunningJob();

      const { status } = await readJson(
        await handleStart(startRequest(validStartBody({ schema_name: undefined })), harness.deps)
      );

      expect(status).toBe(409);
    });

    it("should respond 200 when a different table of the same database and host is running", async () => {
      await startRunningJob();

      const { status } = await readJson(
        await handleStart(startRequest(validStartBody({ table_name: "otra" })), harness.deps)
      );

      expect(status).toBe(200);
    });

    it("should respond 200 when the same table name is running in a different database", async () => {
      await startRunningJob();

      const { status } = await readJson(
        await handleStart(startRequest(validStartBody({ db_name: "otra" })), harness.deps)
      );

      expect(status).toBe(200);
    });

    it("should respond 200 when the same database and table are running on a different host", async () => {
      await startRunningJob();

      const { status } = await readJson(
        await handleStart(startRequest(validStartBody({ host: "otro-servidor" })), harness.deps)
      );

      expect(status).toBe(200);
    });

    it("should respond 200 when the same database and table are running on a different port of the same host", async () => {
      await startRunningJob();

      const { status } = await readJson(
        await handleStart(startRequest(validStartBody({ port: 5433 })), harness.deps)
      );

      expect(status).toBe(200);
    });
  });

  describe("handleStart background run", () => {
    it("should respond 200 with a jobId at once and leave the job RUNNING while runReplace has not settled", async () => {
      const { status, body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, jobId: expect.any(String) });
      expect(harness.store.get(body.jobId as string)?.state).toBe(ShpJobState.RUNNING);
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
    });

    it("should call runReplace with the target, mapping, sourceSrid and resetSequences of the request", async () => {
      await handleStart(startRequest(validStartBody({ resetSequences: true })), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      const params = harness.runCalls[0].params;
      expect(params.target).toEqual({ schema_name: "public", table_name: "parcelas" });
      expect(params.mapping).toEqual({ sourceByTarget: { nombre: "NOMBRE", geom: SHP_GEOMETRY_SOURCE }, defaults: {} });
      expect(params.sourceSrid).toBe(25830);
      expect(params.resetSequences).toBe(true);
    });

    it("should not pass explicit sequences so that the runner derives them from the catalog", async () => {
      await handleStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      expect(harness.runCalls[0].params.sequences).toBeUndefined();
    });

    it("should open the session with the connection config when the runner calls its opener", async () => {
      await handleStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      await harness.runCalls[0].open();

      expect(harness.sessionsOpened).toEqual([
        { host: "localhost", port: 5432, db_name: "gis", user: "app", password: PASSWORD },
      ]);
    });

    it("should pass to runReplace the shapefile opened from the stored upload bytes", async () => {
      harness.files.set(UPLOAD_ID, Uint8Array.of(9, 8));

      await handleStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      expect(Array.from(harness.zipsOpened[0])).toEqual([9, 8]);
      expect(harness.runCalls[0].params.shapefile).toBe(harness.shapefile);
    });

    it("should record progress on the job when runReplace reports it through onProgress", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.runCalls.length === 1);

      harness.runCalls[0].params.onProgress?.({ phase: "staging", current: 2, total: 3 });

      expect(harness.store.get(body.jobId as string)).toMatchObject({ phase: "staging", current: 2, total: 3 });
    });

    it("should record the step detail on the job when runReplace reports a step through onProgress", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.runCalls.length === 1);

      harness.runCalls[0].params.onProgress?.({
        phase: "swapping",
        current: 1,
        total: 3,
        detail: "Bloqueando la tabla destino",
      });

      expect(harness.store.get(body.jobId as string)).toMatchObject({
        phase: "swapping",
        current: 1,
        total: 3,
        detail: "Bloqueando la tabla destino",
      });
    });

    it("should mark the job DONE with the result and delete the upload when runReplace resolves", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].resolve(RESULT);
      await settle(() => harness.deleted.length === 1);

      const job = harness.store.get(body.jobId as string);
      expect(job?.state).toBe(ShpJobState.DONE);
      expect(job?.result).toEqual(RESULT);
      expect(job?.finishedAt).toBeDefined();
      expect(harness.deleted).toEqual([UPLOAD_ID]);
    });

    it("should mark the job FAILED with the error message and keep the upload when runReplace rejects", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error("No se pudo completar el reemplazo: columna inválida."));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      const job = harness.store.get(body.jobId as string);
      expect(job?.state).toBe(ShpJobState.FAILED);
      expect(job?.error).toBe("No se pudo completar el reemplazo: columna inválida.");
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
    });

    it("should replace every occurrence of the password with *** in the failure message", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error(`fallo con ${PASSWORD} y otra vez ${PASSWORD}`));
      await settle(() => harness.deleted.length === 1);

      expect(harness.store.get(body.jobId as string)?.error).toBe("fallo con *** y otra vez ***");
    });

    it("should keep the password out of the job snapshot after a failure", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error(`conexión rechazada para ${PASSWORD}`));
      await settle(() => harness.deleted.length === 1);

      expect(JSON.stringify(harness.store.get(body.jobId as string))).not.toContain(PASSWORD);
    });

    it("should mark the job FAILED with outcomeUnknown true when runReplace rejects with a ShpCommitUncertainError", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(
        new ShpCommitUncertainError("No se pudo confirmar el reemplazo. Revise la tabla antes de reintentar.")
      );
      await settle(() => harness.deleted.length === 1);

      expect(harness.store.get(body.jobId as string)).toMatchObject({
        state: ShpJobState.FAILED,
        outcomeUnknown: true,
      });
    });

    it("should mark the job FAILED with outcomeUnknown false when runReplace rejects with an ordinary error", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error("No se pudo completar el reemplazo: columna inválida."));
      await settle(() => harness.deleted.length === 1);

      expect(harness.store.get(body.jobId as string)).toMatchObject({
        state: ShpJobState.FAILED,
        outcomeUnknown: false,
      });
    });

    it("should mark the job DONE with outcomeUnknown false when runReplace resolves", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].resolve(RESULT);
      await settle(() => harness.deleted.length === 1);

      expect(harness.store.get(body.jobId as string)).toMatchObject({ state: ShpJobState.DONE, outcomeUnknown: false });
    });

    it("should fail the job and keep the upload without calling runReplace when the shapefile cannot be opened", async () => {
      const failingDeps: ShpReplaceHandlerDeps = {
        ...harness.deps,
        openShapefile: async () => {
          throw new Error("No se encontró el archivo .shp dentro del ZIP.");
        },
      };
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), failingDeps));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      const job = harness.store.get(body.jobId as string);
      expect(job?.state).toBe(ShpJobState.FAILED);
      expect(job?.error).toBe("No se encontró el archivo .shp dentro del ZIP.");
      expect(harness.runCalls).toHaveLength(0);
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
    });

    it("should release the table lock when the run has failed so that a new start succeeds", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);
      harness.pending[0].reject(new Error("fallo"));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);
      harness.files.set(UPLOAD_ID, ZIP_BYTES);

      const { status } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
    });

    it("should release the table lock when the run has finished so that a new start succeeds", async () => {
      await handleStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.pending.length === 1);
      harness.pending[0].resolve(RESULT);
      await settle(() => harness.deleted.length === 1);
      harness.files.set(UPLOAD_ID, ZIP_BYTES);

      const { status } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
    });
  });

  describe("handleStatus", () => {
    it("should respond 400 with a Spanish error when the jobId query parameter is missing", async () => {
      const { status, body } = await readJson(await handleStatus(statusRequest(), harness.deps));

      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 400 with a Spanish error when the jobId query parameter is empty", async () => {
      const { status, body } = await readJson(await handleStatus(statusRequest(""), harness.deps));

      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 404 with a Spanish error when the jobId is unknown", async () => {
      const { status, body } = await readJson(await handleStatus(statusRequest("no-such-job"), harness.deps));

      expect(status).toBe(404);
      expectSpanishFailure(body);
    });

    it("should respond 200 with the RUNNING job snapshot when the job is still running", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");

      const { status, body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.job).toMatchObject({ jobId: job.jobId, tableKey: TABLE_KEY, state: ShpJobState.RUNNING, phase: null });
    });

    it("should respond 200 with a null step detail in the job when the running job has reported no step", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");

      const { body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(body.job).toMatchObject({ state: ShpJobState.RUNNING, detail: null });
    });

    it("should respond 200 with the step detail in the job when the running job reports a step", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");
      harness.store.progress(job.jobId, { phase: "processing", current: 2, total: 6, detail: "Reparando geometrías" });

      const { body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(body.job).toMatchObject({ phase: "processing", current: 2, total: 6, detail: "Reparando geometrías" });
    });

    it("should respond 200 with the result in the job when the job is DONE", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");
      harness.store.finish(job.jobId, RESULT);

      const { status, body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(status).toBe(200);
      expect(body.job).toMatchObject({ state: ShpJobState.DONE, result: RESULT });
    });

    it("should respond 200 with the error in the job when the job is FAILED", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");
      harness.store.fail(job.jobId, "No se pudo completar el reemplazo.");

      const { status, body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(status).toBe(200);
      expect(body.job).toMatchObject({ state: ShpJobState.FAILED, error: "No se pudo completar el reemplazo." });
    });

    it("should respond 200 with outcomeUnknown true in the job when the run failed with a ShpCommitUncertainError", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");
      harness.store.fail(job.jobId, "No se pudo confirmar el reemplazo.", true);

      const { status, body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(status).toBe(200);
      expect(body.job).toMatchObject({ state: ShpJobState.FAILED, outcomeUnknown: true });
    });

    it("should respond 200 with outcomeUnknown false in the job when the run failed without the flag", async () => {
      const job = harness.store.tryStart(TABLE_KEY);
      if (!job) throw new Error("expected a job to start");
      harness.store.fail(job.jobId, "No se pudo completar el reemplazo.");

      const { body } = await readJson(await handleStatus(statusRequest(job.jobId), harness.deps));

      expect(body.job).toMatchObject({ state: ShpJobState.FAILED, outcomeUnknown: false });
    });

    it("should never include the password in the status body after a run failed with the password in its message", async () => {
      const { body: started } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);
      harness.pending[0].reject(new Error(`clave ${PASSWORD} rechazada`));
      await settle(() => harness.deleted.length === 1);

      const response = await handleStatus(statusRequest(started.jobId as string), harness.deps);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).not.toContain(PASSWORD);
      expect(text).toContain("***");
    });
  });

  describe("handleStart geometry processing and dry run options", () => {
    it("should pass the parsed processing options and dryRun true to runReplace when the start body sets them", async () => {
      await handleStart(startRequest(validStartBody({ geometryProcessing: PROCESSING_BODY, dryRun: true })), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      expect(harness.runCalls[0].params.processing).toEqual(PARSED_PROCESSING);
      expect(harness.runCalls[0].params.dryRun).toBe(true);
    });

    it("should pass all-disabled processing and dryRun false to runReplace when the start body omits both", async () => {
      await handleStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      expect(harness.runCalls[0].params.processing).toEqual(DISABLED_PROCESSING);
      expect(harness.runCalls[0].params.dryRun).toBe(false);
    });

    it.each<[string, unknown]>([
      ["a key field is not a DBF field", { unify: { enabled: true, keyFields: ["NO_EXISTE"] } }],
      ["unify is enabled without key fields", { unify: { enabled: true, keyFields: [] } }],
      ["the overlap policy is unknown", { overlaps: { enabled: true, policy: "merge", minAreaM2: 1 } }],
      ["the overlap minimum area is negative", { overlaps: { enabled: true, policy: "block", minAreaM2: -1 } }],
      ["geometryProcessing is a string", "repair"],
    ])(
      "should respond 400 with a Spanish error, release the lock and keep the upload when %s",
      async (_label, geometryProcessing) => {
        const { status, body } = await readJson(
          await handleStart(startRequest(validStartBody({ geometryProcessing })), harness.deps)
        );

        expect(status).toBe(400);
        expectSpanishFailure(body);
        expect(harness.runCalls).toHaveLength(0);
        expect(harness.deleted).toEqual([]);
        expect(harness.files.has(UPLOAD_ID)).toBe(true);
        expect(harness.store.tryStart(TABLE_KEY)).not.toBeNull();
      }
    );

    it("should name the offending key field in the 400 message when a key field is not a DBF field", async () => {
      const { body } = await readJson(
        await handleStart(
          startRequest(validStartBody({ geometryProcessing: { unify: { enabled: true, keyFields: ["NO_EXISTE"] } } })),
          harness.deps
        )
      );

      expect(body.error as string).toContain("NO_EXISTE");
    });

    it("should respond 400 with a Spanish error when dryRun is not a boolean", async () => {
      const { status, body } = await readJson(
        await handleStart(startRequest(validStartBody({ dryRun: "yes" })), harness.deps)
      );

      expect(status).toBe(400);
      expectSpanishFailure(body);
      expect(harness.runCalls).toHaveLength(0);
    });

    it("should respond 200 on a valid start after an invalid geometry options start was rejected", async () => {
      await handleStart(startRequest(validStartBody({ geometryProcessing: { repair: "yes" } })), harness.deps);

      const { status } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
    });
  });

  describe("upload retention", () => {
    it("should keep the upload and never delete it when a dry run ends DONE", async () => {
      const { body } = await readJson(
        await handleStart(startRequest(validStartBody({ dryRun: true })), harness.deps)
      );
      await settle(() => harness.pending.length === 1);

      harness.pending[0].resolve(DRY_RUN_RESULT);
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.DONE);

      expect(harness.store.get(body.jobId as string)?.state).toBe(ShpJobState.DONE);
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
    });

    it("should keep the upload when a dry run ends FAILED", async () => {
      const { body } = await readJson(
        await handleStart(startRequest(validStartBody({ dryRun: true })), harness.deps)
      );
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error("fallo en el análisis"));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
    });

    it("should keep the upload and the blocked report when the run is blocked by overlaps", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new ShpProcessingBlockedError(BLOCKED_MESSAGE, BLOCKED_REPORT));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      expect(harness.store.get(body.jobId as string)).toMatchObject({
        state: ShpJobState.FAILED,
        error: BLOCKED_MESSAGE,
        outcomeUnknown: false,
        report: BLOCKED_REPORT,
      });
      expect(harness.deleted).toEqual([]);
    });
  });

  describe("job snapshot dry run and report", () => {
    it("should mark the snapshot dryRun true when the start body sets dryRun true", async () => {
      const { body } = await readJson(
        await handleStart(startRequest(validStartBody({ dryRun: true })), harness.deps)
      );

      expect(harness.store.get(body.jobId as string)?.dryRun).toBe(true);
    });

    it("should mark the snapshot dryRun false when the start body omits dryRun", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));

      expect(harness.store.get(body.jobId as string)?.dryRun).toBe(false);
    });

    it("should expose the dry run flag and the geometry report in the status body when a dry run job is DONE", async () => {
      const { body } = await readJson(
        await handleStart(startRequest(validStartBody({ dryRun: true })), harness.deps)
      );
      await settle(() => harness.pending.length === 1);
      harness.pending[0].resolve({ ...DRY_RUN_RESULT, geometry: GEOMETRY_REPORT });
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.DONE);

      const { body: status } = await readJson(await handleStatus(statusRequest(body.jobId as string), harness.deps));

      expect(status.job).toMatchObject({
        state: ShpJobState.DONE,
        dryRun: true,
        report: GEOMETRY_REPORT,
        result: { dryRun: true, targetModified: false },
      });
    });

    it("should expose the blocked report in the status body when the run is blocked by overlaps", async () => {
      const { body } = await readJson(await handleStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);
      harness.pending[0].reject(new ShpProcessingBlockedError(BLOCKED_MESSAGE, BLOCKED_REPORT));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      const { body: status } = await readJson(await handleStatus(statusRequest(body.jobId as string), harness.deps));

      expect(status.job).toMatchObject({ state: ShpJobState.FAILED, error: BLOCKED_MESSAGE, report: BLOCKED_REPORT });
    });
  });
});
