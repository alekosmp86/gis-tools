import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndicatorsPlan, LoadResult } from "@/modules/coverage-loads/indicators/client";
import {
  downloadReport,
  IndicatorsRequestError,
  requestLoad,
  requestPlan,
} from "@/modules/coverage-loads/indicators/ui/indicatorsClient";
import { downloadBlob } from "@/modules/coverage-loads/shared/ui/downloadBlob";

vi.mock("@/modules/coverage-loads/shared/ui/downloadBlob", () => ({ downloadBlob: vi.fn() }));

const CONNECTION = { host: "h", port: "5432", db_name: "d", user: "u", password: "secret" };
const FILES = [new File(["a"], "IndicadoresLTE_20260901.csv"), new File(["b"], "IndicadoresLTE_20260801.csv")];

const PLAN: IndicatorsPlan = {
  cuts: [],
  fileErrors: [],
  privilegeShortfalls: [],
  canLoad: true,
  requiresAcceptShrink: false,
  hasIncompleteCut: false,
  blockers: [],
};
const RESULT: LoadResult = { cuts: [], totalInserted: 1, totalReplaced: 0, hasIncompleteCut: false, rejectedRows: [] };

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(downloadBlob).mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("indicatorsClient (AC-22..28)", () => {
  describe("requestPlan", () => {
    it("should POST a multipart form with the connection JSON and every file, and no confirmation", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, plan: PLAN }));

      // Act
      const plan = await requestPlan(CONNECTION, FILES);

      // Assert
      const { url, init } = lastCall();
      const form = init.body as FormData;
      expect(plan).toEqual(PLAN);
      expect(url).toBe("/api/m/coverage-loads/indicators/plan");
      expect(init.method).toBe("POST");
      expect(JSON.parse(form.get("connection") as string)).toEqual(CONNECTION);
      expect(form.getAll("files").map((entry) => (entry as File).name)).toEqual(FILES.map((file) => file.name));
      expect(form.has("confirm")).toBe(false);
      expect(form.has("acceptShrink")).toBe(false);
    });

    it("should leave the Content-Type to the browser so the multipart boundary is set", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, plan: PLAN }));

      // Act
      await requestPlan(CONNECTION, FILES);

      // Assert
      expect(lastCall().init.headers).toBeUndefined();
    });
  });

  describe("requestLoad", () => {
    it("should POST confirm=true and no acceptShrink by default", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, result: RESULT }));

      // Act
      const result = await requestLoad(CONNECTION, FILES, false);

      // Assert
      const { url, init } = lastCall();
      const form = init.body as FormData;
      expect(result).toEqual(RESULT);
      expect(url).toBe("/api/m/coverage-loads/indicators/load");
      expect(form.get("confirm")).toBe("true");
      expect(form.has("acceptShrink")).toBe(false);
      expect(JSON.parse(form.get("connection") as string)).toEqual(CONNECTION);
      expect(form.getAll("files")).toHaveLength(2);
    });

    it("should POST acceptShrink=true when the reduction was accepted", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, result: RESULT }));

      // Act
      await requestLoad(CONNECTION, FILES, true);

      // Assert
      const form = lastCall().init.body as FormData;
      expect(form.get("acceptShrink")).toBe("true");
      expect(form.get("confirm")).toBe("true");
    });
  });

  describe("errors", () => {
    it("should throw the server message and carry the plan of a 409 refusal", async () => {
      // Arrange
      const refusal = { ...PLAN, canLoad: false, requiresAcceptShrink: true };
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "hay que aceptar la reducción", plan: refusal }, 409));

      // Act
      const error = await requestLoad(CONNECTION, FILES, false).catch((caught: unknown) => caught);

      // Assert
      expect(error).toBeInstanceOf(IndicatorsRequestError);
      expect((error as IndicatorsRequestError).message).toBe("hay que aceptar la reducción");
      expect((error as IndicatorsRequestError).plan).toEqual(refusal);
      expect((error as IndicatorsRequestError).name).toBe("IndicatorsRequestError");
    });

    it("should throw the server message without a plan for a plain 400", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "Seleccione al menos un archivo." }, 400));

      // Act
      const error = await requestPlan(CONNECTION, []).catch((caught: unknown) => caught);

      // Assert
      expect((error as IndicatorsRequestError).message).toBe("Seleccione al menos un archivo.");
      expect((error as IndicatorsRequestError).plan).toBeUndefined();
    });

    it.each([
      ["plan", () => requestPlan(CONNECTION, FILES), "No se pudo preparar el plan de carga (HTTP 502)."],
      ["load", () => requestLoad(CONNECTION, FILES, false), "No se pudo completar la carga (HTTP 502)."],
      ["reports", () => downloadReport(CONNECTION, "localidad"), "No se pudo generar el reporte (HTTP 502)."],
    ])("should fall back to an HTTP message when the %s error body is not JSON", async (_label, call, message) => {
      // Arrange
      fetchMock.mockImplementation(async () => new Response("<html>Bad gateway</html>", { status: 502 }));

      // Act
      const error = await call().catch((caught: unknown) => caught);

      // Assert
      expect(error).toBeInstanceOf(IndicatorsRequestError);
      expect((error as IndicatorsRequestError).message).toBe(message);
    });

    it("should fall back to an HTTP message when the JSON error body has no error text", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: false }, 500));

      // Act
      const error = await requestPlan(CONNECTION, FILES).catch((caught: unknown) => caught);

      // Assert
      expect((error as IndicatorsRequestError).message).toBe("No se pudo preparar el plan de carga (HTTP 500).");
    });

    it("should report a network failure with the underlying message", async () => {
      // Arrange
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      // Act
      const error = await requestPlan(CONNECTION, FILES).catch((caught: unknown) => caught);

      // Assert
      expect(error).toBeInstanceOf(IndicatorsRequestError);
      expect((error as IndicatorsRequestError).message).toBe("No se pudo contactar con el servidor: Failed to fetch");
    });

    it("should report a network failure that is not an Error", async () => {
      // Arrange
      fetchMock.mockRejectedValue("offline");

      // Act
      const error = await requestLoad(CONNECTION, FILES, false).catch((caught: unknown) => caught);

      // Assert
      expect((error as IndicatorsRequestError).message).toBe("No se pudo contactar con el servidor.");
    });
  });

  describe("downloadReport", () => {
    it("should POST JSON {connection, kind} with a JSON content type", async () => {
      // Arrange
      fetchMock.mockResolvedValue(new Response("a;b\n", { headers: { "Content-Disposition": 'attachment; filename="x.csv"' } }));

      // Act
      await downloadReport(CONNECTION, "mayor50");

      // Assert
      const { url, init } = lastCall();
      expect(url).toBe("/api/m/coverage-loads/indicators/reports");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body as string)).toEqual({ connection: CONNECTION, kind: "mayor50" });
    });

    it("should hand the blob to the browser under the server's file name and return its size", async () => {
      // Arrange
      const body = "departamento;localidad;fecha_novedad\nA;B;01-09-2026\n";
      fetchMock.mockResolvedValue(
        new Response(body, {
          headers: { "Content-Disposition": 'attachment; filename="reporte_cobertura_lte_localidad_mayor50__20261009.csv"' },
        })
      );

      // Act
      const download = await downloadReport(CONNECTION, "mayor50");

      // Assert
      expect(download).toEqual({
        fileName: "reporte_cobertura_lte_localidad_mayor50__20261009.csv",
        sizeBytes: body.length,
      });
      expect(downloadBlob).toHaveBeenCalledTimes(1);
      const [blob, fileName] = vi.mocked(downloadBlob).mock.calls[0];
      expect(fileName).toBe("reporte_cobertura_lte_localidad_mayor50__20261009.csv");
      expect(blob.size).toBe(body.length);
    });

    it("should report a size of 0 for an empty report", async () => {
      // Arrange
      fetchMock.mockResolvedValue(new Response("", { headers: { "Content-Disposition": 'attachment; filename="novedad.csv"' } }));

      // Act
      const download = await downloadReport(CONNECTION, "novedad");

      // Assert
      expect(download).toEqual({ fileName: "novedad.csv", sizeBytes: 0 });
    });

    it("should name the file after the kind when the server sends no file name", async () => {
      // Arrange
      fetchMock.mockResolvedValue(new Response("x"));

      // Act
      const download = await downloadReport(CONNECTION, "localidad");

      // Assert
      expect(download.fileName).toBe("reporte_localidad.csv");
    });

    it("should not download anything when the server refuses", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "La contraseña es obligatoria." }, 400));

      // Act
      const error = await downloadReport(CONNECTION, "localidad").catch((caught: unknown) => caught);

      // Assert
      expect((error as IndicatorsRequestError).message).toBe("La contraseña es obligatoria.");
      expect(downloadBlob).not.toHaveBeenCalled();
    });
  });
});
