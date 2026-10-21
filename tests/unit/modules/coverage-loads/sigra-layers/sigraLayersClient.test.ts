import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import {
  SigraRequestError,
  fetchSigraPlan,
  runSigraLoad,
} from "@/modules/coverage-loads/sigra-layers/ui/sigraLayersClient";
import { LayerLoadStatus, type LayerLoadResult, type SigraPlan } from "@/modules/coverage-loads/sigra-layers/types";

const CONNECTION = { host: "h", port: "5432", db_name: "d", user: "u", password: "s3cr3t-pw" };
const BASE = "/api/m/coverage-loads/sigra-layers";
const LAYERS = [SigraLayerId.ZONAS_FTTH, SigraLayerId.LIMITE_CENTRAL_FTTH];
const PLAN: SigraPlan = { layers: [], blockers: [], warnings: [], canLoad: true };
const RESULT: LayerLoadResult = {
  layerId: SigraLayerId.ZONAS_FTTH,
  status: LayerLoadStatus.LOADED,
  downloaded: 1,
  staged: 1,
  duplicatesIgnored: 0,
  previousCount: 1,
  finalCount: 1,
  elapsedMs: 1,
  step: null,
  message: "ok",
  auditWarning: null,
};

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastCall(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sigraLayersClient", () => {
  describe("fetchSigraPlan", () => {
    it("should POST the connection alone to plan as JSON and return the plan", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, plan: PLAN }));

      // Act
      const plan = await fetchSigraPlan(CONNECTION);

      // Assert
      const { url, init, body } = lastCall();
      expect(plan).toEqual(PLAN);
      expect(url).toBe(`${BASE}/plan`);
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(body).toEqual({ connection: CONNECTION });
      expect("layerIds" in body).toBe(false);
    });

    it("should include layerIds when given", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, plan: PLAN }));

      // Act
      await fetchSigraPlan(CONNECTION, LAYERS);

      // Assert
      expect(lastCall().body).toEqual({ connection: CONNECTION, layerIds: LAYERS });
    });

    it("should throw the server's message when the answer is an error", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "Conexión rechazada." }, 400));

      // Act
      const attempt = fetchSigraPlan(CONNECTION);

      // Assert
      await expect(attempt).rejects.toBeInstanceOf(SigraRequestError);
      await expect(attempt).rejects.toThrow("Conexión rechazada.");
    });

    it("should throw a generic Spanish message with the HTTP status when the error body is not JSON", async () => {
      // Arrange
      fetchMock.mockResolvedValue(new Response("<html>boom</html>", { status: 502 }));

      // Act
      const attempt = fetchSigraPlan(CONNECTION);

      // Assert
      await expect(attempt).rejects.toBeInstanceOf(SigraRequestError);
      await expect(attempt).rejects.toThrow(/502/);
    });

    it("should turn a network failure into a Spanish request error", async () => {
      // Arrange
      fetchMock.mockRejectedValue(new Error("Failed to fetch"));

      // Act
      const attempt = fetchSigraPlan(CONNECTION);

      // Assert
      await expect(attempt).rejects.toBeInstanceOf(SigraRequestError);
      await expect(attempt).rejects.toThrow(/^No se pudo contactar con el servidor/);
    });
  });

  describe("runSigraLoad", () => {
    it("should send confirm=true and dryRun=false for a real load and return results with the flag", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, dryRun: false, results: [RESULT] }));

      // Act
      const answer = await runSigraLoad(CONNECTION, LAYERS, { dryRun: false });

      // Assert
      const { url, init, body } = lastCall();
      expect(url).toBe(`${BASE}/load`);
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(body).toMatchObject({ connection: CONNECTION, layerIds: LAYERS, dryRun: false, confirm: true });
      expect(answer).toEqual({ results: [RESULT], dryRun: false });
    });

    it("should send dryRun=true without confirmation for a dry run", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, dryRun: true, results: [RESULT] }));

      // Act
      const answer = await runSigraLoad(CONNECTION, LAYERS, { dryRun: true });

      // Assert
      const { body } = lastCall();
      expect(body.dryRun).toBe(true);
      expect(body.confirm === undefined || body.confirm === false).toBe(true);
      expect(body.layerIds).toEqual(LAYERS);
      expect(answer.dryRun).toBe(true);
    });

    it.each([true, false])("should send exactly one layer id when asked to load a single layer (dryRun=%s)", async (dryRun) => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: true, dryRun, results: [RESULT] }));

      // Act
      const answer = await runSigraLoad(CONNECTION, [SigraLayerId.AREA_TFO], { dryRun });

      // Assert
      const { body } = lastCall();
      expect(body.layerIds).toEqual([SigraLayerId.AREA_TFO]);
      expect((body.layerIds as unknown[]).length).toBe(1);
      expect(body.dryRun).toBe(dryRun);
      expect(answer.results).toEqual([RESULT]);
    });

    it("should make one request per call, so a caller can load layer by layer", async () => {
      // Arrange
      fetchMock.mockImplementation(async () => jsonResponse({ success: true, dryRun: false, results: [RESULT] }));

      // Act
      await runSigraLoad(CONNECTION, [LAYERS[0]], { dryRun: false });
      await runSigraLoad(CONNECTION, [LAYERS[1]], { dryRun: false });

      // Assert
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).layerIds)).toEqual([
        [LAYERS[0]],
        [LAYERS[1]],
      ]);
    });

    it("should carry the plan of a refusal (409) on the thrown error", async () => {
      // Arrange
      const refusal: SigraPlan = { ...PLAN, canLoad: false, blockers: ["x"] };
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "bloqueado", plan: refusal }, 409));

      // Act
      const attempt = runSigraLoad(CONNECTION, LAYERS, { dryRun: false });

      // Assert
      await expect(attempt).rejects.toMatchObject({ message: "bloqueado", plan: refusal });
      await expect(attempt).rejects.toBeInstanceOf(SigraRequestError);
    });

    it("should leave plan undefined when the error answer carries none", async () => {
      // Arrange
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "falló" }, 500));

      // Act
      const failure = await runSigraLoad(CONNECTION, LAYERS, { dryRun: false }).catch((error: unknown) => error);

      // Assert
      expect(failure).toBeInstanceOf(SigraRequestError);
      expect((failure as SigraRequestError).plan).toBeUndefined();
    });

    it("should throw a message with the HTTP status when the answer is HTML", async () => {
      // Arrange
      fetchMock.mockResolvedValue(new Response("<html>", { status: 504 }));

      // Act
      const attempt = runSigraLoad(CONNECTION, LAYERS, { dryRun: false });

      // Assert
      await expect(attempt).rejects.toThrow(/504/);
    });

    it("should turn a network failure into a Spanish request error", async () => {
      // Arrange
      fetchMock.mockRejectedValue(new Error("socket hang up"));

      // Act
      const attempt = runSigraLoad(CONNECTION, LAYERS, { dryRun: true });

      // Assert
      await expect(attempt).rejects.toThrow(/^No se pudo contactar con el servidor/);
    });
  });

  describe("secrets", () => {
    it("should never put the password in a thrown message", async () => {
      // Arrange
      const failures: unknown[] = [];
      fetchMock.mockRejectedValueOnce(new Error("boom"));
      fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 500 }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: "Falló la carga" }, 500));

      // Act
      failures.push(await fetchSigraPlan(CONNECTION).catch((error: unknown) => error));
      failures.push(await fetchSigraPlan(CONNECTION).catch((error: unknown) => error));
      failures.push(await runSigraLoad(CONNECTION, LAYERS, { dryRun: false }).catch((error: unknown) => error));

      // Assert
      expect(failures).toHaveLength(3);
      for (const failure of failures) {
        expect(failure).toBeInstanceOf(SigraRequestError);
        expect((failure as Error).message).not.toContain(CONNECTION.password);
      }
    });
  });
});
