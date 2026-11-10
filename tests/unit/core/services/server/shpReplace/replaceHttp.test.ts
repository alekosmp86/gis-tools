import { describe, expect, it, vi } from "vitest";
import {
  CONFLICT_MESSAGE,
  errorResponse,
  errorTextOf,
  failureResponse,
  readJsonBody,
  scrubSecret,
  sweepJobsStale,
  sweepUploadsStale,
  tableKeyOf,
} from "@/core/services/server/shpReplace/replaceHttp";
import { GeometryOptionsInvalidError } from "@/core/services/geometryProcessingOptions";
import { ShpRequestInvalidError, parseStartRequest } from "@/core/services/server/shpReplace/shpReplaceRequest";
import {
  UploadInvalidError,
  UploadNotFoundError,
  UploadTooLargeError,
} from "@/core/services/server/shpReplace/shpUploadStore";
import { createShpJobStore } from "@/core/services/server/shpReplace/shpReplaceJobStore";

const readBody = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe("replaceHttp", () => {
  describe("CR-3: failureResponse status mapping", () => {
    it.each<[string, Error, number]>([
      ["UploadTooLargeError", new UploadTooLargeError("El archivo supera el límite de 1 GiB."), 413],
      ["UploadNotFoundError", new UploadNotFoundError("No existe la subida solicitada."), 404],
      ["UploadInvalidError", new UploadInvalidError("Solo se admiten archivos .csv o .txt."), 400],
      ["ShpRequestInvalidError", new ShpRequestInvalidError("El campo db_name es obligatorio."), 400],
      ["GeometryOptionsInvalidError", new GeometryOptionsInvalidError("Opciones inválidas."), 400],
    ])("should respond %s with status %i and its own message", async (_name, error, status) => {
      const response = failureResponse(error);

      expect(response.status).toBe(status);
      expect(await readBody(response)).toEqual({ success: false, error: error.message });
    });

    it("should respond 500 with a generic Spanish message and hide the detail when the error is unexpected", async () => {
      const response = failureResponse(new Error("password authentication failed for user app at 10.0.0.5"));

      const body = await readBody(response);
      expect(response.status).toBe(500);
      expect(body.error).toBe("Error interno al procesar la solicitud.");
      expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    });

    it("should respond 500 when a non-Error value is thrown", async () => {
      const response = failureResponse("boom");

      expect(response.status).toBe(500);
      expect((await readBody(response)).success).toBe(false);
    });

    it("should respond 500 when null is thrown", () => {
      expect(failureResponse(null).status).toBe(500);
    });
  });

  describe("CR-3: helpers", () => {
    it("should build a JSON error response with the given status", async () => {
      const response = errorResponse(409, CONFLICT_MESSAGE);

      expect(response.status).toBe(409);
      expect(await readBody(response)).toEqual({ success: false, error: "Ya hay un reemplazo en curso para esta tabla." });
    });

    it("should read the message of an Error and fall back to a Spanish text otherwise", () => {
      expect(errorTextOf(new Error("x"))).toBe("x");
      expect(errorTextOf(42)).toBe("Error desconocido.");
      expect(errorTextOf(undefined)).toBe("Error desconocido.");
    });

    it("should replace every occurrence of the secret when scrubbing", () => {
      expect(scrubSecret("pw=abc and again abc", "abc")).toBe("pw=*** and again ***");
    });

    it("should leave the text unchanged when it does not contain the secret", () => {
      expect(scrubSecret("sin secreto", "abc")).toBe("sin secreto");
    });

    it("should read a valid JSON body", async () => {
      const request = new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ a: 1 }) });

      expect(await readJsonBody(request)).toEqual({ a: 1 });
    });

    it("should throw ShpRequestInvalidError with a Spanish message when the body is not JSON", async () => {
      const request = new Request("http://localhost/x", { method: "POST", body: "{no" });

      await expect(readJsonBody(request)).rejects.toBeInstanceOf(ShpRequestInvalidError);
    });

    it("should build the table key from host, port, database, schema and table", () => {
      const start = parseStartRequest({
        host: "srv",
        port: 5433,
        db_name: "gis",
        user: "u",
        password: "p",
        schema_name: "geo",
        table_name: "t",
        uploadId: "x",
        mapping: { sourceByTarget: { a: "A" }, defaults: {} },
        sourceSrid: 4326,
        resetSequences: false,
        confirm: true,
      });

      expect(tableKeyOf(start)).toBe("srv:5433|gis|geo|t");
    });

    it("should sweep uploads with a two hour age and swallow a sweep failure", async () => {
      const sweep = vi.fn().mockRejectedValue(new Error("disco"));

      await expect(sweepUploadsStale({ sweep })).resolves.toBeUndefined();
      expect(sweep).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
    });

    it("should do nothing when the uploads object has no sweep", async () => {
      await expect(sweepUploadsStale({})).resolves.toBeUndefined();
    });

    it("should sweep finished jobs older than one hour", () => {
      let now = 0;
      const store = createShpJobStore(() => now);
      const job = store.tryStart("k");
      store.finish(job!.jobId, {
        sourceRows: 1,
        stagedRows: 1,
        previousRows: 0,
        insertedRows: 1,
        dryRun: false,
        targetModified: true,
        sequencesAdjusted: [],
        analyze: { status: "ok" },
      });
      now = 60 * 60 * 1000 + 1;

      sweepJobsStale(store);

      expect(store.get(job!.jobId)).toBeUndefined();
    });
  });
});
