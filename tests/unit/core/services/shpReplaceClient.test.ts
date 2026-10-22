import { describe, it, expect, vi } from "vitest";
import {
  SHP_UPLOAD_FILE_NAME,
  fetchShpReplaceStatus,
  startShpReplace,
  uploadShapefileZip,
  type ShpStartBody,
} from "@/core/services/shpReplaceClient";
import type { ShpJobSnapshot } from "@/core/services/server/shpReplace/shpReplaceJobStore";

type Listener = (event: unknown) => void;

interface EventSource {
  addEventListener(type: string, listener: Listener): void;
  dispatch(type: string, event?: unknown): void;
}

const createEventSource = (): EventSource => {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatch(type, event = {}) {
      (listeners.get(type) ?? []).forEach((listener) => listener(event));
    },
  };
};

const bindHandlerProperty = (target: object, source: EventSource, type: string): void => {
  Object.defineProperty(target, `on${type}`, {
    configurable: true,
    enumerable: true,
    get: () => undefined,
    set: (listener: Listener) => source.addEventListener(type, listener),
  });
};

interface FakeXhrHarness {
  createXhr: () => XMLHttpRequest;
  open: ReturnType<typeof vi.fn>;
  setRequestHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  headers: () => Record<string, string>;
  respond: (status: number, body: string) => void;
  fire: (type: string, event?: unknown) => void;
  fireProgress: (loaded: number, total: number) => void;
}

function createFakeXhr(): FakeXhrHarness {
  const requestEvents = createEventSource();
  const uploadEvents = createEventSource();
  const requestHeaders: Record<string, string> = {};
  const open = vi.fn();
  const setRequestHeader = vi.fn((name: string, value: string) => {
    requestHeaders[name] = value;
  });
  const send = vi.fn();
  const xhr = {
    status: 0,
    responseText: "",
    response: "",
    open,
    setRequestHeader,
    send,
    abort: vi.fn(() => requestEvents.dispatch("abort")),
    upload: {} as object,
  };
  bindHandlerProperty(xhr, requestEvents, "load");
  bindHandlerProperty(xhr, requestEvents, "error");
  bindHandlerProperty(xhr, requestEvents, "abort");
  bindHandlerProperty(xhr.upload, uploadEvents, "progress");

  return {
    createXhr: () => xhr as unknown as XMLHttpRequest,
    open,
    setRequestHeader,
    send,
    headers: () => ({ ...requestHeaders }),
    respond: (status, body) => {
      xhr.status = status;
      xhr.responseText = body;
      xhr.response = body;
      requestEvents.dispatch("load");
    },
    fire: (type, event) => requestEvents.dispatch(type, event),
    fireProgress: (loaded, total) =>
      uploadEvents.dispatch("progress", { lengthComputable: true, loaded, total }),
  };
}

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const START_BODY: ShpStartBody = {
  host: "tgt",
  port: "6543",
  db_name: "tdb",
  user: "u",
  password: "s3cret-pw",
  schema_name: "geo",
  table_name: "parcelas",
  uploadId: "up-1",
  mapping: { sourceByTarget: { nombre: "NOMBRE", geom: "__geometry__" }, defaults: {} },
  sourceSrid: 32721,
  resetSequences: true,
  confirm: true,
};

const SNAPSHOT: ShpJobSnapshot = {
  jobId: "job-1",
  tableKey: "tgt:6543/tdb|geo|parcelas",
  state: "running",
  phase: "staging",
  current: 500,
  total: 1000,
  startedAt: 1,
};

describe("shpReplaceClient", () => {
  describe("uploadShapefileZip", () => {
    it("should POST to the upload route with the fixed ASCII file name header", () => {
      const harness = createFakeXhr();
      void uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr }).catch(() => undefined);
      expect(SHP_UPLOAD_FILE_NAME).toBe("shapefile.zip");
      expect(harness.open).toHaveBeenCalledWith("POST", "/api/db/shp-replace/upload");
      expect(harness.headers()["x-file-name"]).toBe("shapefile.zip");
    });

    it("should send the blob itself as the request body", () => {
      const harness = createFakeXhr();
      const file = new Blob(["zip-bytes"]);
      void uploadShapefileZip(file, undefined, { createXhr: harness.createXhr }).catch(() => undefined);
      expect(harness.send).toHaveBeenCalledOnce();
      expect(harness.send.mock.calls[0][0]).toBe(file);
    });

    it("should never send the user's file name in the header even when it is not ASCII", () => {
      const harness = createFakeXhr();
      const file = new File(["zip"], "Parcelas Ñandú.zip", { type: "application/zip" });
      void uploadShapefileZip(file, undefined, { createXhr: harness.createXhr }).catch(() => undefined);
      const header = harness.headers()["x-file-name"];
      expect(header).toBe("shapefile.zip");
      expect(/^[\x00-\x7F]*$/.test(header)).toBe(true);
    });

    it("should report loaded and total bytes through onProgress", () => {
      const harness = createFakeXhr();
      const onProgress = vi.fn();
      void uploadShapefileZip(new Blob(["zip"]), onProgress, { createXhr: harness.createXhr }).catch(() => undefined);
      harness.fireProgress(64, 256);
      expect(onProgress).toHaveBeenCalledExactlyOnceWith(64, 256);
    });

    it("should not fail on progress events when no onProgress callback is given", () => {
      const harness = createFakeXhr();
      void uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr }).catch(() => undefined);
      expect(() => harness.fireProgress(1, 2)).not.toThrow();
    });

    it("should resolve with the uploadId and size on a 200 success response", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.respond(200, JSON.stringify({ success: true, uploadId: "up-1", size: 1234 }));
      await expect(promise).resolves.toEqual({ uploadId: "up-1", size: 1234 });
    });

    it("should reject with the server Spanish error on a 413 response", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.respond(413, JSON.stringify({ success: false, error: "El archivo supera el límite de 1 GiB." }));
      await expect(promise).rejects.toThrow("El archivo supera el límite de 1 GiB.");
    });

    it("should reject with the server Spanish error on a 400 response for a non-zip file", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.respond(400, JSON.stringify({ success: false, error: "El archivo no es un ZIP válido." }));
      await expect(promise).rejects.toThrow("El archivo no es un ZIP válido.");
    });

    it("should reject with the server error when a 200 response reports success false", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.respond(200, JSON.stringify({ success: false, error: "Subida vacía." }));
      await expect(promise).rejects.toThrow("Subida vacía.");
    });

    it("should reject without leaking the body when a non-JSON error page is returned", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.respond(502, "<html>Bad gateway</html>");
      const rejection = await promise.then(
        () => null,
        (error: unknown) => error
      );
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).not.toContain("<html>");
      expect((rejection as Error).message.length).toBeGreaterThan(0);
    });

    it("should reject with a Spanish message on a network error", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.fire("error");
      await expect(promise).rejects.toThrow(/\S/);
    });

    it("should reject with a Spanish message when the upload is aborted", async () => {
      const harness = createFakeXhr();
      const promise = uploadShapefileZip(new Blob(["zip"]), undefined, { createXhr: harness.createXhr });
      harness.fire("abort");
      await expect(promise).rejects.toThrow(/\S/);
    });
  });

  describe("startShpReplace", () => {
    it("should POST the start body as JSON to the start route", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true, jobId: "job-1" }));
      await startShpReplace(START_BODY, { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledOnce();
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/db/shp-replace/start");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("content-type")).toContain("application/json");
      expect(JSON.parse(String(init.body))).toEqual(START_BODY);
    });

    it("should resolve with the jobId on success", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true, jobId: "job-1" }));
      await expect(startShpReplace(START_BODY, { fetchImpl })).resolves.toEqual({ jobId: "job-1" });
    });

    it("should reject with the server error text on a 409 conflict", async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(409, { success: false, error: "Ya hay una carga en curso para esta tabla." })
      );
      await expect(startShpReplace(START_BODY, { fetchImpl })).rejects.toThrow(
        "Ya hay una carga en curso para esta tabla."
      );
    });

    it("should reject with the server error text on a 404 unknown upload", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(404, { success: false, error: "La subida no existe." }));
      await expect(startShpReplace(START_BODY, { fetchImpl })).rejects.toThrow("La subida no existe.");
    });

    it("should reject with an Error when a non-JSON error body is returned", async () => {
      const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
      await expect(startShpReplace(START_BODY, { fetchImpl })).rejects.toThrow(Error);
    });

    it("should reject when the network request itself fails", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(startShpReplace(START_BODY, { fetchImpl })).rejects.toThrow();
    });
  });

  describe("fetchShpReplaceStatus", () => {
    it("should GET the status route with the job id URL-encoded", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, SNAPSHOT));
      await fetchShpReplaceStatus("job 1/a&b", { fetchImpl });
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined];
      expect(url).toBe("/api/db/shp-replace/status?jobId=job%201%2Fa%26b");
      expect(init?.method ?? "GET").toBe("GET");
    });

    it("should resolve with the job snapshot on success", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, SNAPSHOT));
      await expect(fetchShpReplaceStatus("job-1", { fetchImpl })).resolves.toEqual(SNAPSHOT);
    });

    it("should reject with the server error text on a 404 unknown job", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(404, { success: false, error: "Trabajo no encontrado." }));
      await expect(fetchShpReplaceStatus("job-x", { fetchImpl })).rejects.toThrow("Trabajo no encontrado.");
    });

    it("should reject with the server error text on a 400 missing jobId", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(400, { success: false, error: "Falta jobId." }));
      await expect(fetchShpReplaceStatus("", { fetchImpl })).rejects.toThrow("Falta jobId.");
    });

    it("should reject when the network request itself fails", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(fetchShpReplaceStatus("job-1", { fetchImpl })).rejects.toThrow();
    });
  });
});
