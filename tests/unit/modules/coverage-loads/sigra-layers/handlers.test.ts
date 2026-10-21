import { describe, expect, it } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { createSigraLayersHandlers } from "@/modules/coverage-loads/sigra-layers/api/handlers";
import { SIGRA_LAYERS } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import type { SigraLayersRepository } from "@/modules/coverage-loads/sigra-layers/services/SigraLayersRepository";
import {
  LayerLoadStatus,
  type LayerDbState,
  type LayerLoadResult,
  type SigraDbState,
  type WfsPage,
  type WfsPageFetcher,
} from "@/modules/coverage-loads/sigra-layers/types";
import type { DbConnection } from "@/modules/coverage-loads/types";

const PASSWORD = "s3cret-password";
const CONNECTION_BODY = { host: "h", port: "5432", db_name: "d", user: "u", password: PASSWORD };
const NORMALISED_CONNECTION: DbConnection = { host: "h", port: 5432, db_name: "d", user: "u", password: PASSWORD };

const ZONAS = SigraLayerId.ZONAS_FTTH;
const LIMITE = SigraLayerId.LIMITE_CENTRAL_FTTH;
const POSTES = SigraLayerId.POSTES;
const ALL_IDS = SIGRA_LAYERS.map((layer) => layer.id);

const okDbLayer = (layerId: SigraLayerId, overrides: Partial<LayerDbState> = {}): LayerDbState => ({
  layerId,
  tableExists: true,
  rowCount: 10,
  lastUpdated: "2026-01-01",
  missingPrivileges: [],
  ...overrides,
});

const resultFor = (layerId: SigraLayerId, overrides: Partial<LayerLoadResult> = {}): LayerLoadResult => ({
  layerId,
  status: LayerLoadStatus.LOADED,
  downloaded: 10,
  staged: 10,
  duplicatesIgnored: 0,
  previousCount: 10,
  finalCount: 10,
  elapsedMs: 5,
  step: null,
  message: "ok",
  auditWarning: null,
  ...overrides,
});

class FakeRepository implements SigraLayersRepository {
  public readonly inspected: Array<{ connection: DbConnection; layerIds: SigraLayerId[] }> = [];
  public readonly loads: Array<{ connection: DbConnection; layerId: SigraLayerId; dryRun: boolean }> = [];
  public active = 0;
  public maxActive = 0;
  public inspectFailure: unknown = null;
  public loadFailureFor: SigraLayerId | null = null;
  public stateOverride: ((layerIds: SigraLayerId[]) => Partial<SigraDbState> & { layers?: LayerDbState[] }) | null = null;
  public resultFor: (layerId: SigraLayerId) => LayerLoadResult = (layerId) => resultFor(layerId);

  async inspect(connection: DbConnection, layerIds: ReadonlyArray<SigraLayerId>): Promise<SigraDbState> {
    this.inspected.push({ connection, layerIds: [...layerIds] });
    if (this.inspectFailure !== null) throw this.inspectFailure;
    const base: SigraDbState = { layers: layerIds.map((id) => okDbLayer(id)), canCreateTemp: true, auditAvailable: true };
    return { ...base, ...(this.stateOverride?.([...layerIds]) ?? {}) };
  }

  async loadLayer(connection: DbConnection, layerId: SigraLayerId, options: { dryRun: boolean }): Promise<LayerLoadResult> {
    this.loads.push({ connection, layerId, dryRun: options.dryRun });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (this.loadFailureFor === layerId) throw new Error(`conexion perdida (${PASSWORD})`);
      return this.resultFor(layerId);
    } finally {
      this.active -= 1;
    }
  }
}

class FakeFetcher implements WfsPageFetcher {
  public readonly urls: string[] = [];
  public failFor: string | null = null;

  async fetchPage(url: string): Promise<WfsPage> {
    this.urls.push(url);
    const typeName = new URL(url).searchParams.get("typeName");
    if (this.failFor !== null && typeName === this.failFor) throw new Error("El WFS no responde.");
    return { features: [], numberMatched: 10 };
  }
}

function rig() {
  const repository = new FakeRepository();
  const fetcher = new FakeFetcher();
  const handlers = createSigraLayersHandlers({ repository, fetcher });
  return { repository, fetcher, handlers };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/m/coverage-loads/sigra-layers/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const withConnection = (extra: Record<string, unknown> = {}) => ({ connection: CONNECTION_BODY, ...extra });

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed response bodies keep the assertions readable */
async function bodyOf(response: Response): Promise<{ text: string; json: Record<string, any> }> {
  const text = await response.text();
  return { text, json: JSON.parse(text) as Record<string, any> };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("sigra-layers handlers", () => {
  describe("assembly", () => {
    it("should build the plan and load handlers, with no dependency injected", () => {
      // Arrange & Act
      const handlers = createSigraLayersHandlers();

      // Assert
      expect(Object.keys(handlers).sort()).toEqual(["load", "plan"]);
      expect(typeof handlers.plan).toBe("function");
      expect(typeof handlers.load).toBe("function");
    });
  });

  describe("plan (AC-1, AC-2)", () => {
    it("should plan every registry layer in registry order when layerIds is omitted", async () => {
      // Arrange
      const { handlers, repository, fetcher } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(withConnection()));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(ALL_IDS).toHaveLength(18);
      expect(repository.inspected).toHaveLength(1);
      expect(repository.inspected[0].layerIds).toEqual(ALL_IDS);
      expect(json.plan.layers.map((layer: { layerId: string }) => layer.layerId)).toEqual(ALL_IDS);
      expect(fetcher.urls).toHaveLength(18);
    });

    it("should inspect with the normalised connection", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      await handlers.plan(jsonRequest(withConnection({ layerIds: [ZONAS] })));

      // Assert
      expect(repository.inspected[0].connection).toEqual(NORMALISED_CONNECTION);
    });

    it("should inspect exactly the requested ids in the requested order and probe only those layers", async () => {
      // Arrange
      const { handlers, repository, fetcher } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [POSTES, ZONAS] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(repository.inspected.map((call) => call.layerIds)).toEqual([[POSTES, ZONAS]]);
      expect(json.plan.layers.map((layer: { layerId: string }) => layer.layerId)).toEqual([POSTES, ZONAS]);
      expect(fetcher.urls.map((url) => new URL(url).searchParams.get("typeName"))).toEqual(["WFS_SI:POSTES_F", "WFS_SI:AREA_ZONA_FTTH_F"]);
    });

    it("should collapse duplicate ids keeping the first position", async () => {
      // Arrange
      const { handlers, repository, fetcher } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [POSTES, ZONAS, POSTES, ZONAS] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(repository.inspected[0].layerIds).toEqual([POSTES, ZONAS]);
      expect(json.plan.layers).toHaveLength(2);
      expect(fetcher.urls).toHaveLength(2);
    });

    it("should return the plan built from the database state and the probes", async () => {
      // Arrange
      const { handlers, repository, fetcher } = rig();
      repository.stateOverride = () => ({ layers: [okDbLayer(ZONAS, { rowCount: 3 }), okDbLayer(LIMITE, { missingPrivileges: ["DELETE"] })] });
      fetcher.failFor = "WFS_SI:AREA_ZONA_FTTH_F";

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [ZONAS, LIMITE] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(json.plan.layers[0]).toMatchObject({ layerId: ZONAS, rowCount: 3, canLoad: false });
      expect(json.plan.layers[0].wfsError).toEqual(expect.any(String));
      expect(json.plan.layers[1]).toMatchObject({ layerId: LIMITE, wfsCount: 10, canLoad: false });
      expect(json.plan.canLoad).toBe(false);
    });

    it("should return a loadable plan for healthy layers", async () => {
      // Arrange
      const { handlers } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [ZONAS, LIMITE] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(json.plan).toMatchObject({ canLoad: true, blockers: [], warnings: [] });
      expect(json.plan.layers.map((layer: { wfsCount: number }) => layer.wfsCount)).toEqual([10, 10]);
    });

    it("should never call loadLayer", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      await handlers.plan(jsonRequest(withConnection({ layerIds: [ZONAS] })));

      // Assert
      expect(repository.loads).toEqual([]);
    });

    it.each([
      ["a body that is not JSON", "{not json"],
      ["a JSON body that is not an object", "[1,2]"],
      ["a missing connection", {}],
      ["a connection without a password", { connection: { host: "h", db_name: "d", user: "u" } }],
      ["a connection without a database", { connection: { host: "h", user: "u", password: PASSWORD } }],
      ["an unknown layer id", withConnection({ layerIds: [ZONAS, "nope"] })],
      ["layerIds that is not an array", withConnection({ layerIds: ZONAS })],
      ["an empty layerIds array", withConnection({ layerIds: [] })],
      ["a non-string layer id", withConnection({ layerIds: [123] })],
      ["an object as layer id", withConnection({ layerIds: [{ id: ZONAS }] })],
    ])("should answer 400 and touch nothing for %s", async (_label, body) => {
      // Arrange
      const { handlers, repository, fetcher } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(body));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(typeof json.error).toBe("string");
      expect(repository.inspected).toEqual([]);
      expect(fetcher.urls).toEqual([]);
      expect(text).not.toContain(PASSWORD);
    });

    it("should answer 500 with the password scrubbed when the database cannot be inspected", async () => {
      // Arrange
      const { handlers, repository, fetcher } = rig();
      repository.inspectFailure = new Error(`password authentication failed for user "u" (${PASSWORD})`);

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [ZONAS] })));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error).toContain("***");
      expect(text).not.toContain(PASSWORD);
      expect(repository.loads).toEqual([]);
      expect(fetcher.urls).toEqual([]);
    });

    it("should answer 500 with a Spanish message when something other than an Error is thrown", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.inspectFailure = "boom";

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [ZONAS] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(500);
      expect(json.error.length).toBeGreaterThan(0);
    });

    it("should not fail the plan when a WFS probe fails: the layer carries the error", async () => {
      // Arrange
      const { handlers, fetcher } = rig();
      fetcher.failFor = "WFS_SI:POSTES_F";

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: [POSTES] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(json.plan.layers[0].wfsError).toEqual(expect.any(String));
      expect(json.plan.canLoad).toBe(false);
    });

    it("should never echo the password in a successful response", async () => {
      // Arrange
      const { handlers } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(withConnection()));

      // Assert
      expect((await response.text()).includes(PASSWORD)).toBe(false);
    });
  });

  describe("load (AC-3, AC-9)", () => {
    it("should load each selected layer in request order, one call per layer, with the normalised connection and dryRun false", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [POSTES, ZONAS, LIMITE], confirm: true })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(repository.loads).toEqual([
        { connection: NORMALISED_CONNECTION, layerId: POSTES, dryRun: false },
        { connection: NORMALISED_CONNECTION, layerId: ZONAS, dryRun: false },
        { connection: NORMALISED_CONNECTION, layerId: LIMITE, dryRun: false },
      ]);
      expect(json).toMatchObject({ success: true, dryRun: false });
      expect(json.results.map((result: { layerId: string }) => result.layerId)).toEqual([POSTES, ZONAS, LIMITE]);
    });

    it("should return the results the repository produced, untouched", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.resultFor = (layerId) => resultFor(layerId, { downloaded: 42, staged: 40, duplicatesIgnored: 2, message: `hecho ${layerId}` });

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      const { json } = await bodyOf(response);
      expect(json.results).toEqual([resultFor(ZONAS, { downloaded: 42, staged: 40, duplicatesIgnored: 2, message: `hecho ${ZONAS}` })]);
    });

    it("should not force the required layers into the list", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      await handlers.load(jsonRequest(withConnection({ layerIds: [POSTES], confirm: true })));

      // Assert
      expect(repository.inspected.map((call) => call.layerIds)).toEqual([[POSTES]]);
      expect(repository.loads.map((load) => load.layerId)).toEqual([POSTES]);
    });

    it("should inspect exactly the selected ids, deduplicated, and load each once", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      await handlers.load(jsonRequest(withConnection({ layerIds: [POSTES, ZONAS, POSTES], confirm: true })));

      // Assert
      expect(repository.inspected.map((call) => call.layerIds)).toEqual([[POSTES, ZONAS]]);
      expect(repository.loads.map((load) => load.layerId)).toEqual([POSTES, ZONAS]);
    });

    it("should run a dry run without confirmation and pass dryRun true to every layer", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.resultFor = (layerId) => resultFor(layerId, { status: LayerLoadStatus.DRY_RUN_OK, finalCount: null });

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS, LIMITE], dryRun: true })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(json.dryRun).toBe(true);
      expect(repository.loads.map((load) => load.dryRun)).toEqual([true, true]);
      expect(json.results.map((result: { status: string }) => result.status)).toEqual([LayerLoadStatus.DRY_RUN_OK, LayerLoadStatus.DRY_RUN_OK]);
    });

    it("should default dryRun to false and still require confirmation", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS] })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error.length).toBeGreaterThan(0);
      expect(repository.loads).toEqual([]);
    });

    it.each([
      ["confirm false", { confirm: false }],
      ["confirm the string true", { confirm: "true" }],
      ["confirm 1", { confirm: 1 }],
      ["dryRun false and confirm false", { dryRun: false, confirm: false }],
    ])("should refuse a real load with %s", async (_label, extra) => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], ...extra })));

      // Assert
      expect(response.status).toBe(400);
      expect(repository.loads).toEqual([]);
    });

    it.each([
      ["a body that is not JSON", "{not json"],
      ["a missing connection", { layerIds: [ZONAS], confirm: true }],
      ["a connection without a password", { connection: { host: "h", db_name: "d", user: "u" }, layerIds: [ZONAS], confirm: true }],
      ["omitted layerIds", withConnection({ confirm: true })],
      ["an empty layerIds array", withConnection({ layerIds: [], confirm: true })],
      ["layerIds that is not an array", withConnection({ layerIds: ZONAS, confirm: true })],
      ["an unknown layer id", withConnection({ layerIds: [ZONAS, "nope"], confirm: true })],
      ["a non-string layer id", withConnection({ layerIds: [7], confirm: true })],
    ])("should answer 400 and load nothing for %s", async (_label, body) => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      const response = await handlers.load(jsonRequest(body));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(repository.inspected).toEqual([]);
      expect(repository.loads).toEqual([]);
      expect(text).not.toContain(PASSWORD);
    });

    it("should answer 409 with the plan and call loadLayer for none when a selected layer is blocked, even for the healthy ones", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.stateOverride = () => ({ layers: [okDbLayer(ZONAS), okDbLayer(POSTES, { tableExists: false, rowCount: null, lastUpdated: null })] });

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS, POSTES], confirm: true })));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(409);
      expect(json.success).toBe(false);
      expect(typeof json.error).toBe("string");
      expect(json.plan.canLoad).toBe(false);
      expect(json.plan.layers.map((layer: { canLoad: boolean }) => layer.canLoad)).toEqual([true, false]);
      expect(repository.loads).toEqual([]);
      expect(text).not.toContain(PASSWORD);
    });

    it.each([
      ["a missing privilege", { layers: [okDbLayer(ZONAS, { missingPrivileges: ["DELETE"] })] }],
      ["no TEMP privilege", { canCreateTemp: false }],
    ])("should answer 409 and load nothing for %s", async (_label, override) => {
      // Arrange
      const { handlers, repository } = rig();
      repository.stateOverride = () => override;

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      expect(response.status).toBe(409);
      expect(repository.loads).toEqual([]);
    });

    it("should refuse a dry run too when a layer is blocked", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.stateOverride = () => ({ canCreateTemp: false });

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], dryRun: true })));

      // Assert
      expect(response.status).toBe(409);
      expect(repository.loads).toEqual([]);
    });

    it("should still load when only the audit table is unavailable (a warning, not a blocker)", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.stateOverride = () => ({ auditAvailable: false });

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      expect(response.status).toBe(200);
      expect(repository.loads).toHaveLength(1);
    });

    it("should not probe the WFS on the load path", async () => {
      // Arrange
      const { handlers, fetcher } = rig();

      // Act
      await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS, LIMITE], confirm: true })));

      // Assert
      expect(fetcher.urls).toEqual([]);
    });

    it("should answer 200 with every result and keep loading after a failed or rejected layer", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.resultFor = (layerId) => {
        if (layerId === ZONAS) return resultFor(layerId, { status: LayerLoadStatus.FAILED, step: "wfs", finalCount: null, message: "sin WFS" });
        if (layerId === LIMITE) return resultFor(layerId, { status: LayerLoadStatus.REJECTED_VALIDATION, step: "validacion", finalCount: null });
        return resultFor(layerId);
      };

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS, LIMITE, POSTES], confirm: true })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(repository.loads.map((load) => load.layerId)).toEqual([ZONAS, LIMITE, POSTES]);
      expect(json.results.map((result: { status: string }) => result.status)).toEqual([
        LayerLoadStatus.FAILED,
        LayerLoadStatus.REJECTED_VALIDATION,
        LayerLoadStatus.LOADED,
      ]);
    });

    it("should load the layers one at a time, never two at once", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS, LIMITE, POSTES], confirm: true })));

      // Assert
      expect(repository.maxActive).toBe(1);
    });

    it("should answer 500 with the password scrubbed when a layer load throws unexpectedly", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.loadFailureFor = ZONAS;

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(text).not.toContain(PASSWORD);
    });

    it("should answer 500 with the password scrubbed and load nothing when the database cannot be inspected", async () => {
      // Arrange
      const { handlers, repository } = rig();
      repository.inspectFailure = new Error(`connection refused (password ${PASSWORD})`);

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(500);
      expect(json.error).toContain("***");
      expect(text).not.toContain(PASSWORD);
      expect(repository.loads).toEqual([]);
    });

    it("should never echo the password in a successful response", async () => {
      // Arrange
      const { handlers } = rig();

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      expect((await response.text()).includes(PASSWORD)).toBe(false);
    });
  });

  describe("strict flags and layerIds (decisions)", () => {
    it.each([
      ["dryRun the string yes", { dryRun: "yes", confirm: true }],
      ["dryRun 1", { dryRun: 1, confirm: true }],
      ["dryRun null", { dryRun: null, confirm: true }],
      ["confirm the string true next to a dry run", { dryRun: true, confirm: "true" }],
      ["confirm 1 next to a dry run", { dryRun: true, confirm: 1 }],
      ["confirm null next to a dry run", { dryRun: true, confirm: null }],
      ["layerIds null", { layerIds: null, confirm: true }],
    ])("should answer 400 with a Spanish message and touch nothing on load for %s", async (_label, extra) => {
      // Arrange
      const { handlers, repository, fetcher } = rig();

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], ...extra })));

      // Assert
      const { json, text } = await bodyOf(response);
      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(typeof json.error).toBe("string");
      expect(json.error.length).toBeGreaterThan(0);
      expect(repository.inspected).toEqual([]);
      expect(repository.loads).toEqual([]);
      expect(fetcher.urls).toEqual([]);
      expect(text).not.toContain(PASSWORD);
    });

    it("should answer 400 with a Spanish message and touch nothing on plan when layerIds is null (only an absent key means all layers)", async () => {
      // Arrange
      const { handlers, repository, fetcher } = rig();

      // Act
      const response = await handlers.plan(jsonRequest(withConnection({ layerIds: null })));

      // Assert
      const { json } = await bodyOf(response);
      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error.length).toBeGreaterThan(0);
      expect(repository.inspected).toEqual([]);
      expect(fetcher.urls).toEqual([]);
    });

    it("should treat an absent dryRun as false", async () => {
      // Arrange
      const { handlers, repository } = rig();

      // Act
      const response = await handlers.load(jsonRequest(withConnection({ layerIds: [ZONAS], confirm: true })));

      // Assert
      expect(response.status).toBe(200);
      expect(repository.loads.map((load) => load.dryRun)).toEqual([false]);
    });
  });
});
