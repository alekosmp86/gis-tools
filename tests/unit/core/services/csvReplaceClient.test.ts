import { describe, expect, it, vi } from "vitest";
import {
  fetchReplaceJobStatus,
  startReplaceJob,
  uploadReplaceFile,
  uploadShapefileZip,
  type ReplaceUploadTarget,
  type ShpStartBody,
} from "@/core/services/shpReplaceClient";
import { DEFAULT_GEOMETRY_PROCESSING } from "@/core/types/geometryProcessing";

type Listener = (event: unknown) => void;

function createFakeXhr() {
  const handlers = new Map<string, Listener>();
  const uploadHandlers = new Map<string, Listener>();
  const headers: Record<string, string> = {};
  const xhr = {
    status: 0,
    responseText: "",
    open: vi.fn(),
    setRequestHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    send: vi.fn(),
    upload: {} as Record<string, unknown>,
  } as Record<string, unknown> & { open: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
  for (const type of ["load", "error", "abort"]) {
    Object.defineProperty(xhr, `on${type}`, { set: (listener: Listener) => handlers.set(type, listener), get: () => undefined });
  }
  Object.defineProperty(xhr.upload, "onprogress", {
    set: (listener: Listener) => uploadHandlers.set("progress", listener),
    get: () => undefined,
  });
  return {
    createXhr: () => xhr as unknown as XMLHttpRequest,
    xhr,
    headers: () => ({ ...headers }),
    respond(status: number, body: string) {
      xhr.status = status;
      xhr.responseText = body;
      handlers.get("load")?.({});
    },
    fire: (type: string) => handlers.get(type)?.({}),
    progress: (loaded: number, total: number, lengthComputable = true) =>
      uploadHandlers.get("progress")?.({ lengthComputable, loaded, total }),
  };
}

const CSV_TARGET: ReplaceUploadTarget = { route: "/api/db/csv-replace/upload", fileName: "datos.csv" };

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const START_BODY: ShpStartBody = {
  host: "tgt",
  port: "5432",
  db_name: "db",
  user: "u",
  password: "pw",
  schema_name: "public",
  table_name: "t",
  uploadId: "up-1",
  mapping: { sourceByTarget: { a: "a" }, defaults: {} },
  sourceSrid: 4326,
  resetSequences: true,
  geometryProcessing: DEFAULT_GEOMETRY_PROCESSING,
  dryRun: false,
  confirm: true,
};

describe("shpReplaceClient generic helpers", () => {
  describe("CR-2: uploadReplaceFile", () => {
    it("should POST to the route and send the file name header of the given target", () => {
      const harness = createFakeXhr();

      void uploadReplaceFile(CSV_TARGET, new Blob(["id\n1"]), undefined, { createXhr: harness.createXhr }).catch(() => undefined);

      expect(harness.xhr.open).toHaveBeenCalledWith("POST", "/api/db/csv-replace/upload");
      expect(harness.headers()).toEqual({ "x-file-name": "datos.csv" });
    });

    it("should send the blob as the body", () => {
      const harness = createFakeXhr();
      const file = new Blob(["a,b"]);

      void uploadReplaceFile(CSV_TARGET, file, undefined, { createXhr: harness.createXhr }).catch(() => undefined);

      expect(harness.xhr.send.mock.calls[0][0]).toBe(file);
    });

    it("should resolve with the uploadId and size on a successful response", async () => {
      const harness = createFakeXhr();
      const promise = uploadReplaceFile(CSV_TARGET, new Blob(["x"]), undefined, { createXhr: harness.createXhr });

      harness.respond(200, JSON.stringify({ success: true, uploadId: "u-1", size: 12 }));

      await expect(promise).resolves.toEqual({ uploadId: "u-1", size: 12 });
    });

    it("should reject with the Spanish server message on a 400 for a wrong file type", async () => {
      const harness = createFakeXhr();
      const promise = uploadReplaceFile(CSV_TARGET, new Blob(["x"]), undefined, { createXhr: harness.createXhr });

      harness.respond(400, JSON.stringify({ success: false, error: "Solo se admiten archivos .csv o .txt." }));

      await expect(promise).rejects.toThrowError("Solo se admiten archivos .csv o .txt.");
    });

    it("should reject with the 1 GiB message on a 413", async () => {
      const harness = createFakeXhr();
      const promise = uploadReplaceFile(CSV_TARGET, new Blob(["x"]), undefined, { createXhr: harness.createXhr });

      harness.respond(413, JSON.stringify({ success: false, error: "El archivo supera el límite de 1 GiB." }));

      await expect(promise).rejects.toThrowError("El archivo supera el límite de 1 GiB.");
    });

    it("should reject with a fallback message including the HTTP code when the body is not JSON", async () => {
      const harness = createFakeXhr();
      const promise = uploadReplaceFile(CSV_TARGET, new Blob(["x"]), undefined, { createXhr: harness.createXhr });

      harness.respond(502, "<html>Bad gateway</html>");

      await expect(promise).rejects.toThrowError(/502/);
    });

    it("should forward progress events with the loaded and total bytes", () => {
      const harness = createFakeXhr();
      const onProgress = vi.fn();
      void uploadReplaceFile(CSV_TARGET, new Blob(["x"]), onProgress, { createXhr: harness.createXhr }).catch(() => undefined);

      harness.progress(10, 40);
      harness.progress(5, 0, false);

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(10, 40);
    });

    it("should reject with a Spanish network message on error and on abort", async () => {
      const failing = createFakeXhr();
      const aborted = createFakeXhr();
      const failingPromise = uploadReplaceFile(CSV_TARGET, new Blob(["x"]), undefined, { createXhr: failing.createXhr });
      const abortedPromise = uploadReplaceFile(CSV_TARGET, new Blob(["x"]), undefined, { createXhr: aborted.createXhr });

      failing.fire("error");
      aborted.fire("abort");

      await expect(failingPromise).rejects.toThrowError(/No se pudo conectar/);
      await expect(abortedPromise).rejects.toThrowError(/cancelada/);
    });

    it("should keep the shapefile upload on its own route and file name", () => {
      const harness = createFakeXhr();

      void uploadShapefileZip(new Blob(["z"]), undefined, { createXhr: harness.createXhr }).catch(() => undefined);

      expect(harness.xhr.open).toHaveBeenCalledWith("POST", "/api/db/shp-replace/upload");
      expect(harness.headers()["x-file-name"]).toBe("shapefile.zip");
    });
  });

  describe("CR-3: startReplaceJob and fetchReplaceJobStatus with CSV routes", () => {
    it("should POST the start body as JSON to the route it is given", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true, jobId: "job-9" }));

      const result = await startReplaceJob("/api/db/csv-replace/start", START_BODY, { fetchImpl });

      expect(result).toEqual({ jobId: "job-9" });
      expect(fetchImpl).toHaveBeenCalledWith("/api/db/csv-replace/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(START_BODY),
      });
    });

    it("should reject with the server message on a 409 conflict", async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(409, { success: false, error: "Ya hay un reemplazo en curso para esta tabla." })
      );

      await expect(startReplaceJob("/api/db/csv-replace/start", START_BODY, { fetchImpl })).rejects.toThrowError(
        "Ya hay un reemplazo en curso para esta tabla."
      );
    });

    it("should reject when the response has no jobId", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true }));

      await expect(startReplaceJob("/x", START_BODY, { fetchImpl })).rejects.toThrowError(/No se pudo iniciar/);
    });

    it("should reject with a Spanish message when the network fails", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });

      await expect(startReplaceJob("/x", START_BODY, { fetchImpl })).rejects.toThrowError(/No se pudo contactar/);
    });

    it("should GET the status route with the job id URL-encoded", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true, job: { jobId: "a b", state: "running" } }));

      const job = await fetchReplaceJobStatus("/api/db/csv-replace/status", "a b", { fetchImpl });

      expect(fetchImpl).toHaveBeenCalledWith("/api/db/csv-replace/status?jobId=a%20b", undefined);
      expect(job).toMatchObject({ jobId: "a b", state: "running" });
    });

    it("should reject with the server message on a 404 unknown job", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(404, { success: false, error: "No existe el trabajo." }));

      await expect(fetchReplaceJobStatus("/s", "j", { fetchImpl })).rejects.toThrowError("No existe el trabajo.");
    });
  });
});
