import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportKind } from "@/modules/coverage-loads/avance-ftth/constants";
import { RunMode } from "@/modules/coverage-loads/avance-ftth/domain/loadFlow";
import {
  AvanceRequestError,
  downloadReport,
  requestPlan,
  requestRun,
} from "@/modules/coverage-loads/avance-ftth/ui/avanceFtthClient";
import { downloadBlob } from "@/modules/coverage-loads/shared/ui/downloadBlob";

vi.mock("@/modules/coverage-loads/shared/ui/downloadBlob", () => ({ downloadBlob: vi.fn() }));

const CONNECTION = { host: "h", port: "5432", db_name: "d", user: "u", password: "secret" };
const FILES = [new File(["a"], "SituacionFTTH_INT_21092026.csv"), new File(["b"], "SituacionFTTH_UDPEM_21092026.csv")];
const BASE = "/api/m/coverage-loads/avance-ftth";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fileResponse(content: string, disposition: string | null): Response {
  const headers = new Headers();
  if (disposition !== null) headers.set("Content-Disposition", disposition);
  return new Response(content, { status: 200, headers });
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

describe("avanceFtthClient", () => {
  describe("downloadReport (AC-23)", () => {
    it("should POST the connection alone for the zip of all reports and save it under the server's name", async () => {
      // Arrange
      fetchMock.mockResolvedValue(fileResponse("zipbytes", 'attachment; filename="AvanceFTTH_Reportes20261009.zip"'));

      // Act
      const saved = await downloadReport(CONNECTION, null);

      // Assert
      const { url, init } = lastCall();
      expect(url).toBe(`${BASE}/reports`);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body as string)).toEqual({ connection: CONNECTION });
      expect(saved).toEqual({ fileName: "AvanceFTTH_Reportes20261009.zip", sizeBytes: 8 });
      expect(downloadBlob).toHaveBeenCalledTimes(1);
      expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe("AvanceFTTH_Reportes20261009.zip");
    });

    it("should POST the kind for a single report", async () => {
      // Arrange
      fetchMock.mockResolvedValue(fileResponse("x", 'attachment; filename="reporte_avance_duplicado_planilla_obras_20261009.txt"'));

      // Act
      const saved = await downloadReport(CONNECTION, ReportKind.DUPLICADO);

      // Assert
      expect(JSON.parse(lastCall().init.body as string)).toEqual({ connection: CONNECTION, kind: ReportKind.DUPLICADO });
      expect(saved.fileName).toBe("reporte_avance_duplicado_planilla_obras_20261009.txt");
    });

    it("should name a single report by its kind and the zip by a fixed fallback when the server sends no file name", async () => {
      // Arrange
      fetchMock.mockResolvedValueOnce(fileResponse("x", null)).mockResolvedValueOnce(fileResponse("x", null));

      // Act
      const single = await downloadReport(CONNECTION, ReportKind.FUERA_CENTRAL);
      const zip = await downloadReport(CONNECTION, null);

      // Assert
      expect(single.fileName).toBe(ReportKind.FUERA_CENTRAL);
      expect(zip.fileName).toBe("AvanceFTTH_Reportes.zip");
    });

    it("should throw the server's Spanish message and save nothing when the answer is an error", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "No se pudo generar el reporte." }, 500));

      // Act
      const attempt = downloadReport(CONNECTION, null);

      // Assert
      await expect(attempt).rejects.toThrow("No se pudo generar el reporte.");
      expect(downloadBlob).not.toHaveBeenCalled();
    });

    it("should fall back to a message with the HTTP status when the error answer is not JSON", async () => {
      // Arrange
      fetchMock.mockResolvedValue(new Response("<html>boom</html>", { status: 502 }));

      // Act
      const attempt = downloadReport(CONNECTION, null);

      // Assert
      await expect(attempt).rejects.toThrow("No se pudo generar el reporte (HTTP 502).");
    });

    it("should turn a network failure into a Spanish request error", async () => {
      // Arrange
      fetchMock.mockRejectedValue(new Error("Failed to fetch"));

      // Act
      const attempt = downloadReport(CONNECTION, null);

      // Assert
      await expect(attempt).rejects.toThrow("No se pudo contactar con el servidor: Failed to fetch");
      await expect(attempt).rejects.toBeInstanceOf(AvanceRequestError);
    });
  });

  describe("requestPlan and requestRun (AC-29)", () => {
    it("should POST the connection and both files to plan and leave the Content-Type to the browser", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, plan: { canLoad: true } }));

      // Act
      const plan = await requestPlan(CONNECTION, FILES);

      // Assert
      const { url, init } = lastCall();
      const form = init.body as FormData;
      expect(plan).toEqual({ canLoad: true });
      expect(url).toBe(`${BASE}/plan`);
      expect(init.headers).toBeUndefined();
      expect(JSON.parse(form.get("connection") as string)).toEqual(CONNECTION);
      expect(form.getAll("files").map((entry) => (entry as File).name)).toEqual(FILES.map((file) => file.name));
      expect(form.has("confirm")).toBe(false);
      expect(form.has("dryRun")).toBe(false);
    });

    it("should send confirm=true for a real load and dryRun=true for a dry run, never both", async () => {
      // Arrange
      fetchMock.mockImplementation(async () => jsonResponse({ success: true, result: { dryRun: false } }));

      // Act
      await requestRun(CONNECTION, FILES, RunMode.LOAD);
      const load = lastCall().init.body as FormData;
      await requestRun(CONNECTION, FILES, RunMode.DRY_RUN);
      const dry = lastCall().init.body as FormData;

      // Assert
      expect(load.get("confirm")).toBe("true");
      expect(load.has("dryRun")).toBe(false);
      expect(dry.get("dryRun")).toBe("true");
      expect(dry.has("confirm")).toBe(false);
    });

    it("should carry the plan of a refusal (409) on the thrown error", async () => {
      // Arrange
      const refusal = { canLoad: false, blockers: ["x"] };
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "bloqueado", plan: refusal }, 409));

      // Act
      const attempt = requestRun(CONNECTION, FILES, RunMode.LOAD);

      // Assert
      await expect(attempt).rejects.toMatchObject({ name: "AvanceRequestError", message: "bloqueado", plan: refusal });
    });

    it("should name the failed step and the status when plan or load answer with something that is not JSON", async () => {
      // Arrange
      fetchMock.mockImplementation(async () => new Response("<html>", { status: 504 }));

      // Act & Assert
      await expect(requestPlan(CONNECTION, FILES)).rejects.toThrow("No se pudo preparar el plan de carga (HTTP 504).");
      await expect(requestRun(CONNECTION, FILES, RunMode.LOAD)).rejects.toThrow("No se pudo completar la carga (HTTP 504).");
    });
  });
});
