import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleCsvStart,
  handleCsvUpload,
  type CsvReplaceHandlerDeps,
} from "@/core/services/server/csvReplace/csvReplaceHandlers";
import { ShpJobState, createShpJobStore, type ShpJobStore } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import type { ReplaceRecordSource } from "@/core/services/server/shpReplace/replaceRecordSource";
import type { PgShpConfig } from "@/core/services/server/shpReplace/pgShpSession";
import {
  ShpCommitUncertainError,
  type RunShpReplaceParams,
  type ShpReplaceResult,
  type ShpReplaceSession,
} from "@/core/services/server/shpReplace/shpReplaceTypes";
import {
  UploadInvalidError,
  UploadNotFoundError,
  UploadTooLargeError,
} from "@/core/services/server/shpReplace/shpUploadStore";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import { AnalyzeStatus } from "@/core/types/replace";

const BASE_URL = "http://localhost/api/db/csv-replace";
const UPLOAD_ID = "123e4567-e89b-42d3-a456-426614174000";
const FILE_PATH = "C:\\tmp\\gis-tools-csv-replace\\123e4567.csv";
const PASSWORD = "s3cret-pass";
const SPANISH_MARKER = /\b(el|la|los|las|de|del|no|que|con|para|se|una|un|en)\b|[áéíóúñ¿¡]/i;

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
  files: Set<string>;
  deleted: string[];
  saved: Array<{ fileName: string; bytes: Uint8Array | null }>;
  opened: string[];
  sessionsOpened: PgShpConfig[];
  runCalls: RunCall[];
  pending: Array<Deferred<ShpReplaceResult>>;
  source: ReplaceRecordSource;
  sweep: ReturnType<typeof vi.fn>;
  openCsvImpl: { current: (filePath: string) => ReplaceRecordSource };
  deleteImpl: { current: (uploadId: string) => Promise<void> };
  deps: CsvReplaceHandlerDeps;
}

function createHarness(): Harness {
  const store = createShpJobStore(() => 0);
  const files = new Set<string>([UPLOAD_ID]);
  const deleted: string[] = [];
  const saved: Harness["saved"] = [];
  const opened: string[] = [];
  const sessionsOpened: PgShpConfig[] = [];
  const runCalls: RunCall[] = [];
  const pending: Array<Deferred<ShpReplaceResult>> = [];
  const source: ReplaceRecordSource = {
    fieldNames: ["nombre"],
    recordCount: 3,
    hasGeometry: false,
    records: () => [],
  };
  const sweep = vi.fn(async () => 0);
  const openCsvImpl: Harness["openCsvImpl"] = { current: () => source };
  const deleteImpl = {
    current: async (uploadId: string): Promise<void> => {
      deleted.push(uploadId);
      files.delete(uploadId);
    },
  };
  const session: ShpReplaceSession = {
    query: async () => ({ rows: [], rowCount: 0 }),
    copyIn: async () => 0,
    close: async () => undefined,
  };

  const deps: CsvReplaceHandlerDeps = {
    store,
    uploads: {
      save: async (body, fileName) => {
        const bytes = body ? new Uint8Array(await new Response(body).arrayBuffer()) : null;
        saved.push({ fileName, bytes });
        if (!/\.(csv|txt)$/i.test(fileName)) throw new UploadInvalidError("Solo se admiten archivos .csv o .txt.");
        if (bytes === null) throw new UploadInvalidError("La petición no contiene datos.");
        return { uploadId: UPLOAD_ID, size: bytes.length };
      },
      locate: async (uploadId) => {
        if (!files.has(uploadId)) throw new UploadNotFoundError("No existe la subida solicitada.");
        return FILE_PATH;
      },
      delete: (uploadId) => deleteImpl.current(uploadId),
      sweep,
    },
    openCsv: (filePath) => {
      opened.push(filePath);
      return openCsvImpl.current(filePath);
    },
    openSession: async (config) => {
      sessionsOpened.push(config);
      return session;
    },
    runReplace: (open, params) => {
      runCalls.push({ open, params });
      const deferred = createDeferred<ShpReplaceResult>();
      pending.push(deferred);
      return deferred.promise;
    },
  };

  return { store, files, deleted, saved, opened, sessionsOpened, runCalls, pending, source, sweep, openCsvImpl, deleteImpl, deps };
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
    mapping: { sourceByTarget: { nombre: "nombre", geom: SHP_GEOMETRY_SOURCE }, defaults: {} },
    sourceSrid: 32721,
    resetSequences: true,
    confirm: true,
    ...overrides,
  };
}

const startRequest = (body: unknown): Request =>
  new Request(`${BASE_URL}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function uploadRequest(options: { fileName?: string; body?: Uint8Array | null }): Request {
  const headers: Record<string, string> = {};
  if (options.fileName !== undefined) headers["x-file-name"] = options.fileName;
  return new Request(`${BASE_URL}/upload`, {
    method: "POST",
    headers,
    body: (options.body === undefined ? Uint8Array.of(105, 100) : options.body) as BodyInit | null,
  });
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function settle(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const expectSpanishFailure = (body: Record<string, unknown>): void => {
  expect(body.success).toBe(false);
  expect(typeof body.error).toBe("string");
  expect(body.error as string).toMatch(SPANISH_MARKER);
};

describe("csvReplaceHandlers", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("CR-2: handleCsvUpload", () => {
    it("should respond 200 with uploadId and size when the csv body is accepted", async () => {
      const { status, body } = await readJson(
        await handleCsvUpload(uploadRequest({ fileName: "datos.csv" }), harness.deps)
      );

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, uploadId: UPLOAD_ID, size: 2 });
    });

    it("should pass the x-file-name header and the raw bytes to save", async () => {
      await handleCsvUpload(uploadRequest({ fileName: "datos.txt" }), harness.deps);

      expect(harness.saved).toHaveLength(1);
      expect(harness.saved[0].fileName).toBe("datos.txt");
      expect(Array.from(harness.saved[0].bytes ?? [])).toEqual([105, 100]);
    });

    it("should respond 400 with a Spanish error when the file is a zip", async () => {
      const { status, body } = await readJson(
        await handleCsvUpload(uploadRequest({ fileName: "datos.zip" }), harness.deps)
      );

      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 400 when the x-file-name header is missing", async () => {
      const { status, body } = await readJson(await handleCsvUpload(uploadRequest({}), harness.deps));

      expect(status).toBe(400);
      expectSpanishFailure(body);
    });

    it("should respond 400 when the request has no body", async () => {
      const { status } = await readJson(
        await handleCsvUpload(uploadRequest({ fileName: "datos.csv", body: null }), harness.deps)
      );

      expect(status).toBe(400);
    });

    it("should respond 413 with the Spanish limit message when save rejects with UploadTooLargeError", async () => {
      const deps = {
        uploads: {
          ...harness.deps.uploads,
          save: async () => {
            throw new UploadTooLargeError("El archivo supera el límite de 1 GiB.");
          },
        },
      };

      const { status, body } = await readJson(await handleCsvUpload(uploadRequest({ fileName: "datos.csv" }), deps));

      expect(status).toBe(413);
      expect(body).toEqual({ success: false, error: "El archivo supera el límite de 1 GiB." });
    });

    it("should respond 500 with a generic message when save fails unexpectedly", async () => {
      const deps = {
        uploads: {
          ...harness.deps.uploads,
          save: async () => {
            throw new Error("EACCES: permission denied, open 'C:\\secret\\path'");
          },
        },
      };

      const { status, body } = await readJson(await handleCsvUpload(uploadRequest({ fileName: "datos.csv" }), deps));

      expect(status).toBe(500);
      expect(JSON.stringify(body)).not.toContain("secret");
    });

    it("should sweep stale uploads before saving and still succeed when the sweep fails", async () => {
      harness.sweep.mockRejectedValueOnce(new Error("disco lleno"));

      const { status } = await readJson(await handleCsvUpload(uploadRequest({ fileName: "datos.csv" }), harness.deps));

      expect(harness.sweep).toHaveBeenCalledTimes(1);
      expect(status).toBe(200);
    });
  });

  describe("CR-3: handleCsvStart validation", () => {
    it.each<[string, string | Record<string, unknown>]>([
      ["the body is not JSON", "{no es json"],
      ["confirm is missing", validStartBody({ confirm: undefined })],
      ["confirm is false", validStartBody({ confirm: false })],
      ["db_name is missing", validStartBody({ db_name: undefined })],
      ["password is empty", validStartBody({ password: "" })],
      ["table_name is missing", validStartBody({ table_name: undefined })],
      ["uploadId is missing", validStartBody({ uploadId: undefined })],
      ["mapping is missing", validStartBody({ mapping: undefined })],
      ["sourceSrid is zero", validStartBody({ sourceSrid: 0 })],
      ["sourceSrid is not an integer", validStartBody({ sourceSrid: 25830.5 })],
    ])("should respond 400 with a Spanish error and no side effect when %s", async (_label, payload) => {
      const { status, body } = await readJson(await handleCsvStart(startRequest(payload), harness.deps));

      expect(status).toBe(400);
      expectSpanishFailure(body);
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
      expect(harness.runCalls).toHaveLength(0);
      expect(harness.opened).toEqual([]);
      expect(harness.deleted).toEqual([]);
      expect(harness.store.tryStart("localhost:5432|gis|public|parcelas")).not.toBeNull();
    });
  });

  describe("CR-3: handleCsvStart upload lookup", () => {
    it("should respond 404 with a Spanish error when the uploadId is unknown and never open the csv", async () => {
      harness.files.clear();

      const { status, body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(404);
      expectSpanishFailure(body);
      expect(harness.runCalls).toHaveLength(0);
      expect(harness.opened).toEqual([]);
    });

    it("should release the table lock after a 404 so that a later valid start succeeds", async () => {
      harness.files.clear();
      await handleCsvStart(startRequest(validStartBody()), harness.deps);
      harness.files.add(UPLOAD_ID);

      const { status } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
    });

    it("should respond 404 when the uploadId is not a well-formed id", async () => {
      harness.deps.uploads.locate = async () => {
        throw new UploadNotFoundError("No existe la subida solicitada.");
      };

      const { status } = await readJson(
        await handleCsvStart(startRequest(validStartBody({ uploadId: "../../etc/passwd" })), harness.deps)
      );

      expect(status).toBe(404);
    });
  });

  describe("CR-3: handleCsvStart table lock", () => {
    it("should respond 409 with a Spanish error and keep the upload when the same table already has a running job", async () => {
      await handleCsvStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.pending.length === 1);

      const { status, body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(409);
      expectSpanishFailure(body);
      expect(harness.runCalls).toHaveLength(1);
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
    });

    it("should respond 200 when a different table of the same database is running", async () => {
      await handleCsvStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.pending.length === 1);

      const { status } = await readJson(
        await handleCsvStart(startRequest(validStartBody({ table_name: "otra" })), harness.deps)
      );

      expect(status).toBe(200);
    });

    it("should share the lock with a running job of the shapefile flow when the store is the same", async () => {
      harness.store.tryStart("localhost:5432|gis|public|parcelas");

      const { status } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(409);
    });
  });

  describe("CR-3: handleCsvStart background run", () => {
    it("should respond 200 with a jobId at once and leave the job RUNNING while runReplace has not settled", async () => {
      const { status, body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, jobId: expect.any(String) });
      expect(harness.store.get(body.jobId as string)?.state).toBe(ShpJobState.RUNNING);
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
    });

    it("should open the csv from the located upload path and pass that source to runReplace", async () => {
      await handleCsvStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      expect(harness.opened).toEqual([FILE_PATH]);
      expect(harness.runCalls[0].params.shapefile).toBe(harness.source);
    });

    it("should pass target, mapping, sourceSrid and resetSequences of the request to runReplace", async () => {
      await handleCsvStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      const params = harness.runCalls[0].params;
      expect(params.target).toEqual({ schema_name: "public", table_name: "parcelas" });
      expect(params.mapping).toEqual({
        sourceByTarget: { nombre: "nombre", geom: SHP_GEOMETRY_SOURCE },
        defaults: {},
      });
      expect(params.sourceSrid).toBe(32721);
      expect(params.resetSequences).toBe(true);
    });

    it("should force a real run and ignore geometry processing even when the body asks for a dry run", async () => {
      const body = validStartBody({
        dryRun: true,
        geometryProcessing: { repair: { enabled: true }, unify: { enabled: false, keyFields: [] } },
      });

      await handleCsvStart(startRequest(body), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      expect(harness.runCalls[0].params.dryRun).toBe(false);
      expect(harness.runCalls[0].params.processing).toBeUndefined();
      expect(harness.runCalls[0].params.sequences).toBeUndefined();
    });

    it("should open the session with the connection config when the runner calls its opener", async () => {
      await handleCsvStart(startRequest(validStartBody()), harness.deps);
      await settle(() => harness.runCalls.length === 1);

      await harness.runCalls[0].open();

      expect(harness.sessionsOpened).toEqual([
        { host: "localhost", port: 5432, db_name: "gis", user: "app", password: PASSWORD },
      ]);
    });

    it("should record progress on the job when runReplace reports it", async () => {
      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.runCalls.length === 1);

      harness.runCalls[0].params.onProgress?.({ phase: "staging", current: 2, total: 3, detail: "Cargando" });

      expect(harness.store.get(body.jobId as string)).toMatchObject({
        phase: "staging",
        current: 2,
        total: 3,
        detail: "Cargando",
      });
    });

    it("should mark the job DONE with the result, delete the upload and release the lock when runReplace resolves", async () => {
      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].resolve(RESULT);
      await settle(() => harness.deleted.length === 1);

      expect(harness.store.get(body.jobId as string)).toMatchObject({ state: ShpJobState.DONE, result: RESULT });
      expect(harness.deleted).toEqual([UPLOAD_ID]);
      expect(harness.files.has(UPLOAD_ID)).toBe(false);
      expect(harness.store.tryStart("localhost:5432|gis|public|parcelas")).not.toBeNull();
    });

    it("should still mark the job DONE when deleting the upload fails", async () => {
      harness.deleteImpl.current = async () => {
        throw new Error("EBUSY");
      };
      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].resolve(RESULT);
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.DONE);

      expect(harness.store.get(body.jobId as string)?.state).toBe(ShpJobState.DONE);
    });

    it("should mark the job FAILED, keep the upload and release the lock when runReplace rejects", async () => {
      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error("La geometría de la fila 3 no se pudo interpretar."));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      const job = harness.store.get(body.jobId as string);
      expect(job).toMatchObject({ state: ShpJobState.FAILED, outcomeUnknown: false });
      expect(job?.error).toContain("fila 3");
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
      expect(harness.store.tryStart("localhost:5432|gis|public|parcelas")).not.toBeNull();
    });

    it("should replace every occurrence of the password with *** in the failure message", async () => {
      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new Error(`fallo con ${PASSWORD} y otra vez ${PASSWORD}`));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      const job = harness.store.get(body.jobId as string);
      expect(job?.error).toBe("fallo con *** y otra vez ***");
      expect(JSON.stringify(job)).not.toContain(PASSWORD);
    });

    it("should flag outcomeUnknown when the commit outcome is uncertain", async () => {
      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);

      harness.pending[0].reject(new ShpCommitUncertainError("No se pudo confirmar el COMMIT."));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      expect(harness.store.get(body.jobId as string)?.outcomeUnknown).toBe(true);
    });

    it("should fail the job without opening a session when the csv cannot be opened, keeping the upload and the lock free", async () => {
      harness.openCsvImpl.current = () => {
        throw new Error("El archivo no está codificado en UTF-8. Guárdelo como CSV UTF-8 e inténtelo de nuevo.");
      };

      const { status, body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      expect(status).toBe(200);
      expect(harness.store.get(body.jobId as string)).toMatchObject({ state: ShpJobState.FAILED, outcomeUnknown: false });
      expect(harness.store.get(body.jobId as string)?.error).toContain("UTF-8");
      expect(harness.runCalls).toHaveLength(0);
      expect(harness.sessionsOpened).toEqual([]);
      expect(harness.deleted).toEqual([]);
      expect(harness.files.has(UPLOAD_ID)).toBe(true);
      expect(harness.store.tryStart("localhost:5432|gis|public|parcelas")).not.toBeNull();
    });

    it("should scrub the password from a csv opening error", async () => {
      harness.openCsvImpl.current = () => {
        throw new Error(`error raro ${PASSWORD}`);
      };

      const { body } = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.store.get(body.jobId as string)?.state === ShpJobState.FAILED);

      expect(harness.store.get(body.jobId as string)?.error).toBe("error raro ***");
    });

    it("should allow a retry with the same upload after a failure", async () => {
      const first = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));
      await settle(() => harness.pending.length === 1);
      harness.pending[0].reject(new Error("fallo"));
      await settle(() => harness.store.get(first.body.jobId as string)?.state === ShpJobState.FAILED);

      const second = await readJson(await handleCsvStart(startRequest(validStartBody()), harness.deps));

      expect(second.status).toBe(200);
      expect(second.body.jobId).not.toBe(first.body.jobId);
    });

    it("should not leak the password in the success response", async () => {
      const response = await handleCsvStart(startRequest(validStartBody()), harness.deps);

      expect(await response.text()).not.toContain(PASSWORD);
    });
  });
});
