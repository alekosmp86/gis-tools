import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbConfig, DatabaseFetchResult, ExecuteBatchResult } from "@/core/types/db";

const mocks = vi.hoisted(() => ({
  fetchOrStreamRecords: vi.fn(),
  executeSqlInChunks: vi.fn(),
}));

vi.mock("@/core/services/streaming/DatabaseStreamReader", () => ({
  DatabaseStreamReader: { fetchOrStreamRecords: mocks.fetchOrStreamRecords },
}));
vi.mock("@/core/services/dbExecutionService", () => ({
  executeSqlInChunks: mocks.executeSqlInChunks,
}));

import { runFullReplace, FULL_REPLACE_BATCH_SIZE } from "@/core/services/fullReplaceService";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { SequenceRef } from "@/core/services/replaceSequences";
import { GeometryRepairStatus } from "@/core/types/replace";

const sourceConfig = { table_name: "src", schema_name: "public" } as unknown as DbConfig;
const targetConfig = { table_name: "dst", schema_name: "geo" } as unknown as DbConfig;

const ANALYZE_SCRIPT = 'ANALYZE "geo"."dst";';
const DEFAULT_TOLERANCE_LITERAL = "0.0001";
const REPAIR_FAILURE_PREFIX = "Reparación de geometrías";
const SEQUENCE_FAILURE_PREFIX = "No se pudieron ajustar las secuencias";

const TARGET_TYPES_WITH_MULTIPOLYGON: Record<string, string> = {
  id: "integer",
  name: "text",
  geom: "geometry(MultiPolygon,32721)",
};

const mapping: ReplaceColumnMapping = { sourceByTarget: { id: "id", name: "name" }, defaults: {} };
const seqA: SequenceRef = { qualifiedLabel: "geo.a_seq", schema: "geo", name: "a_seq", columns: ["id"], mapped: false };

const isCountScript = (script: string): boolean => script.includes("SELECT concat_ws(");
const isUpdateScript = (script: string): boolean => script.includes('AS t SET "');
const isGeometryRepairScript = (script: string): boolean => isCountScript(script) || isUpdateScript(script);
const isSequenceRepairScript = (script: string): boolean => script.includes("pg_sequence_last_value");

const okBatch = (script: string): ExecuteBatchResult => {
  const lines = script.split("\n").filter((line) => line.trim() !== "");
  const base: ExecuteBatchResult = {
    success: true,
    totalProcessed: lines.length,
    affectedRows: lines.length,
    errorCount: 0,
    errors: [],
    message: "ok",
  };
  return isSequenceRepairScript(script) ? { ...base, selectResults: lines.map((_line, index) => 100 + index) } : base;
};

const failedBatch = (errors: string[]): ExecuteBatchResult => ({
  success: false,
  totalProcessed: 0,
  affectedRows: 0,
  errorCount: errors.length,
  errors,
  message: "x",
});

const makeRows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index, name: `n${index}` }));

const targetFetch = (columnTypes: Record<string, string>): DatabaseFetchResult => ({
  records: [],
  totalCount: 0,
  columnTypes,
  detectedSrid: 32721,
});

const sourceFetch = (rows: Array<Record<string, unknown>>): DatabaseFetchResult => ({
  records: rows,
  totalCount: rows.length,
  columnTypes: { id: "integer", name: "text" },
  detectedSrid: 4326,
});

const arrange = (rows: Array<Record<string, unknown>>, columnTypes: Record<string, string> = TARGET_TYPES_WITH_MULTIPOLYGON) => {
  mocks.fetchOrStreamRecords.mockImplementation(async (config: DbConfig) =>
    config === targetConfig ? targetFetch(columnTypes) : sourceFetch(rows)
  );
};

const arrangeRepair = (countText: string, updatedRows = 0) => {
  mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
    if (isCountScript(script)) return { ...okBatch(script), selectResults: [countText] };
    if (isUpdateScript(script)) return { ...okBatch(script), affectedRows: updatedRows };
    return okBatch(script);
  });
};

const params = (overrides: Record<string, unknown> = {}) => ({
  sourceConfig,
  targetConfig,
  password: "pw",
  sourceColumns: ["id", "name"],
  targetColumns: ["id", "name"],
  mapping,
  sequences: [] as SequenceRef[],
  resetSequences: true,
  ...overrides,
});

const scriptsOf = (): string[] => mocks.executeSqlInChunks.mock.calls.map((call) => call[2] as string);
const geometryScriptsOf = (): string[] => scriptsOf().filter(isGeometryRepairScript);
const countScriptsOf = (): string[] => scriptsOf().filter(isCountScript);
const updateScriptsOf = (): string[] => scriptsOf().filter(isUpdateScript);

beforeEach(() => {
  mocks.fetchOrStreamRecords.mockReset();
  mocks.executeSqlInChunks.mockReset();
  mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => okBatch(script));
});

describe("runFullReplace geometry repair", () => {
  describe("default on", () => {
    it("should run the replace, then the geometry count, then the geometry update, then ANALYZE when the repair is on by default", async () => {
      arrange(makeRows(3));
      arrangeRepair("2,0", 2);
      const result = await runFullReplace(params());
      const scripts = scriptsOf();
      expect(scripts).toHaveLength(4);
      expect(scripts[0].startsWith('DELETE FROM "geo"."dst";')).toBe(true);
      expect(isCountScript(scripts[1])).toBe(true);
      expect(isUpdateScript(scripts[2])).toBe(true);
      expect(scripts[3]).toBe(ANALYZE_SCRIPT);
      expect(result.insertedRows).toBe(3);
    });

    it("should report the repaired and unrepairable row counts per column when the repair runs by default", async () => {
      arrange(makeRows(3));
      arrangeRepair("5,1", 5);
      const result = await runFullReplace(params());
      expect(result.geometryRepair).toEqual({
        status: GeometryRepairStatus.OK,
        columns: [{ column: "geom", repairedRows: 5, unrepairableRows: 1 }],
        skippedColumns: [],
      });
    });

    it("should run the sequence repair between the replace and the geometry count", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params({ sequences: [seqA] }));
      const scripts = scriptsOf();
      expect(scripts).toHaveLength(5);
      expect(isSequenceRepairScript(scripts[1])).toBe(true);
      expect(isCountScript(scripts[2])).toBe(true);
      expect(isUpdateScript(scripts[3])).toBe(true);
      expect(scripts[4]).toBe(ANALYZE_SCRIPT);
    });

    it("should send no update request and report the unrepairable rows when the count is 0,3", async () => {
      arrange(makeRows(3));
      arrangeRepair("0,3");
      const result = await runFullReplace(params());
      expect(geometryScriptsOf()).toHaveLength(1);
      expect(countScriptsOf()).toHaveLength(1);
      expect(updateScriptsOf()).toEqual([]);
      expect(scriptsOf()).toHaveLength(3);
      expect(scriptsOf()[2]).toBe(ANALYZE_SCRIPT);
      expect(result.geometryRepair.columns).toEqual([{ column: "geom", repairedRows: 0, unrepairableRows: 3 }]);
    });

    it("should send no update request and report zeros when the count is 0,0", async () => {
      arrange(makeRows(3));
      arrangeRepair("0,0");
      const result = await runFullReplace(params());
      expect(updateScriptsOf()).toEqual([]);
      expect(result.geometryRepair).toEqual({
        status: GeometryRepairStatus.OK,
        columns: [{ column: "geom", repairedRows: 0, unrepairableRows: 0 }],
        skippedColumns: [],
      });
    });

    it("should repair every repairable geometry column in column order and skip the non-repairable ones", async () => {
      arrange(makeRows(3), {
        id: "integer",
        geom: "geometry(MultiPolygon,32721)",
        poly: "geometry(Polygon,32721)",
        area: "geometry",
        zed: "geometry(MultiPolygonZ,32721)",
      });
      arrangeRepair("1,0", 1);
      const result = await runFullReplace(params());
      const columnsTouched = geometryScriptsOf().map((script) => (script.includes('"area"') ? "area" : script.includes('"zed"') ? "zed" : "geom"));
      expect(columnsTouched).toEqual(["geom", "geom", "area", "area", "zed", "zed"]);
      expect(scriptsOf().some((script) => script.includes('"poly"'))).toBe(false);
      expect(result.geometryRepair.columns).toEqual([
        { column: "geom", repairedRows: 1, unrepairableRows: 0 },
        { column: "area", repairedRows: 1, unrepairableRows: 0 },
        { column: "zed", repairedRows: 1, unrepairableRows: 0 },
      ]);
      expect(result.geometryRepair.skippedColumns).toEqual(["poly"]);
    });

    it("should send the geometry repair to the target config with the password", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params({ password: "secret" }));
      const countCall = mocks.executeSqlInChunks.mock.calls.find((call) => isCountScript(call[2] as string));
      expect(countCall?.[0]).toBe(targetConfig);
      expect(countCall?.[1]).toBe("secret");
    });

    it("should send each geometry statement as its own single-line request", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params());
      const geometryCalls = mocks.executeSqlInChunks.mock.calls.filter((call) => isGeometryRepairScript(call[2] as string));
      expect(geometryCalls).toHaveLength(2);
      for (const call of geometryCalls) {
        expect(call[2]).not.toMatch(/[\n\r]/);
        expect(call[4]).toBe(1);
      }
    });
  });

  describe("repair turned off", () => {
    it("should send no geometry repair request when repairGeometries is false", async () => {
      arrange(makeRows(3));
      arrangeRepair("2,0", 2);
      await runFullReplace(params({ repairGeometries: false }));
      expect(geometryScriptsOf()).toEqual([]);
      expect(scriptsOf()).toHaveLength(2);
      expect(scriptsOf()[1]).toBe(ANALYZE_SCRIPT);
    });

    it("should report status off with no columns when repairGeometries is false", async () => {
      arrange(makeRows(3));
      arrangeRepair("2,0", 2);
      const result = await runFullReplace(params({ repairGeometries: false }));
      expect(result.geometryRepair).toEqual({ status: GeometryRepairStatus.OFF, columns: [], skippedColumns: [] });
    });

    it("should still report the skipped polygonal columns when repairGeometries is false", async () => {
      arrange(makeRows(3), { id: "integer", poly: "geometry(Polygon,32721)", mz: "geometry(MultiPolygonM,32721)" });
      arrangeRepair("2,0", 2);
      const result = await runFullReplace(params({ repairGeometries: false }));
      expect(result.geometryRepair).toEqual({
        status: GeometryRepairStatus.OFF,
        columns: [],
        skippedColumns: ["poly", "mz"],
      });
    });

    it("should keep the replace and ANALYZE untouched when repairGeometries is false", async () => {
      arrange(makeRows(3));
      arrangeRepair("2,0", 2);
      const result = await runFullReplace(params({ repairGeometries: false }));
      expect(result.insertedRows).toBe(3);
      expect(result.errorCount).toBe(0);
      expect(result.replaceErrorCount).toBe(0);
      expect(result.analyze).toEqual({ status: "ok" });
    });
  });

  describe("replace with errors", () => {
    it("should skip the repair with no repair request when a later batch returned errors", async () => {
      arrange(makeRows(1200));
      arrangeRepair("1,0", 1);
      mocks.executeSqlInChunks
        .mockImplementationOnce(async (_config: DbConfig, _password: string, script: string) => okBatch(script))
        .mockResolvedValueOnce(failedBatch(["Lote 1 (1-500): violation"]))
        .mockImplementationOnce(async (_config: DbConfig, _password: string, script: string) => okBatch(script));
      const result = await runFullReplace(params());
      expect(geometryScriptsOf()).toEqual([]);
      expect(result.geometryRepair).toEqual({ status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns: [] });
      expect(result.errorCount).toBe(1);
      expect(result.replaceErrorCount).toBe(1);
      expect(result.errors[0]).toMatch(/^Lote 2 \(501-1000\)/);
    });

    it("should skip the repair with no repair request when the first batch failed and the target was not modified", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      mocks.executeSqlInChunks.mockResolvedValueOnce(failedBatch(["Lote 1 (1-3): fail"]));
      const result = await runFullReplace(params());
      expect(geometryScriptsOf()).toEqual([]);
      expect(result.targetModified).toBe(false);
      expect(result.geometryRepair).toEqual({ status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns: [] });
      expect(result.replaceErrorCount).toBe(1);
    });

    it("should skip the repair when the later batch call rejects", async () => {
      arrange(makeRows(1200));
      arrangeRepair("1,0", 1);
      mocks.executeSqlInChunks
        .mockImplementationOnce(async (_config: DbConfig, _password: string, script: string) => okBatch(script))
        .mockRejectedValueOnce(new Error("connection lost"));
      const result = await runFullReplace(params());
      expect(geometryScriptsOf()).toEqual([]);
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.SKIPPED);
      expect(result.replaceErrorCount).toBe(1);
    });

    it("should report the skipped polygonal columns even when the repair is skipped", async () => {
      arrange(makeRows(1200), { id: "integer", geom: "geometry(MultiPolygon,32721)", poly: "geometry(Polygon,32721)" });
      arrangeRepair("1,0", 1);
      mocks.executeSqlInChunks
        .mockImplementationOnce(async (_config: DbConfig, _password: string, script: string) => okBatch(script))
        .mockResolvedValueOnce(failedBatch(["Lote 1 (1-500): violation"]));
      const result = await runFullReplace(params());
      expect(result.geometryRepair).toEqual({ status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns: ["poly"] });
    });
  });

  describe("target without repairable geometry columns", () => {
    it.each([
      ["no geometry column at all", { id: "integer", name: "text" }],
      ["only a single Polygon column", { id: "integer", poly: "geometry(Polygon,32721)" }],
      ["only point and geography columns", { id: "integer", pt: "geometry(Point,4326)", g: "geography(MultiPolygon,4326)" }],
    ])("should send no geometry repair request when the target has %s", async (_label, columnTypes) => {
      arrange(makeRows(3), columnTypes);
      arrangeRepair("1,0", 1);
      const result = await runFullReplace(params());
      expect(geometryScriptsOf()).toEqual([]);
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.OK);
      expect(result.geometryRepair.columns).toEqual([]);
    });

    it("should still run ANALYZE when the target has no repairable geometry column", async () => {
      arrange(makeRows(3), { id: "integer", name: "text" });
      const result = await runFullReplace(params());
      expect(scriptsOf()[scriptsOf().length - 1]).toBe(ANALYZE_SCRIPT);
      expect(result.analyze).toEqual({ status: "ok" });
    });
  });

  describe("repair failure", () => {
    it("should append one repair error line, keep insertedRows and report status failed when the count returns a database error", async () => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) =>
        isCountScript(script) ? failedBatch(["permission denied for table dst"]) : okBatch(script)
      );
      const result = await runFullReplace(params());
      expect(result.insertedRows).toBe(3);
      expect(result.sourceRows).toBe(3);
      expect(result.targetModified).toBe(true);
      expect(result.replaceErrorCount).toBe(0);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe(`${REPAIR_FAILURE_PREFIX}: columna geom: permission denied for table dst`);
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.FAILED);
      expect(result.geometryRepair.columns).toEqual([]);
      expect(result.geometryRepair.message).toBe("columna geom: permission denied for table dst");
    });

    it("should append the repair error when the update returns a database error after a successful count", async () => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isCountScript(script)) return { ...okBatch(script), selectResults: ["2,0"] };
        if (isUpdateScript(script)) return failedBatch(["update rejected by check constraint"]);
        return okBatch(script);
      });
      const result = await runFullReplace(params());
      expect(result.insertedRows).toBe(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(REPAIR_FAILURE_PREFIX);
      expect(result.errors[0]).toContain("update rejected by check constraint");
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.FAILED);
    });

    it("should append the thrown error message when the count call rejects", async () => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isCountScript(script)) throw new Error("connection lost");
        return okBatch(script);
      });
      const result = await runFullReplace(params());
      expect(result.insertedRows).toBe(3);
      expect(result.errors[0]).toContain(REPAIR_FAILURE_PREFIX);
      expect(result.errors[0]).toContain("connection lost");
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.FAILED);
    });

    it("should say Error desconocido when the count call rejects with a non-Error", async () => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isCountScript(script)) throw "weird";
        return okBatch(script);
      });
      const result = await runFullReplace(params());
      expect(result.errors[0]).toContain(REPAIR_FAILURE_PREFIX);
      expect(result.errors[0]).toContain("Error desconocido");
    });

    it.each([
      ["a bare number", [5]],
      ["a count without a comma", ["5"]],
      ["three parts", ["1,2,3"]],
      ["a negative part", ["5,-1"]],
      ["an empty result list", []],
      ["no result at all", undefined],
    ])("should fail the column and send no update when the count result is %s", async (_label, selectResults) => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) =>
        isCountScript(script) ? { ...okBatch(script), selectResults } : okBatch(script)
      );
      const result = await runFullReplace(params());
      expect(updateScriptsOf()).toEqual([]);
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.FAILED);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(`${REPAIR_FAILURE_PREFIX}: columna geom:`);
      expect(result.errors[0]).toContain("recuento");
      expect(result.insertedRows).toBe(3);
    });

    it("should keep the columns already repaired and stop at the first failing column", async () => {
      arrange(makeRows(3), { id: "integer", geom: "geometry(MultiPolygon,32721)", area: "geometry", zed: "geometry(MultiPolygonZ,32721)" });
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isCountScript(script) && script.includes('"area"')) return failedBatch(["area denied"]);
        if (isCountScript(script)) return { ...okBatch(script), selectResults: ["2,0"] };
        if (isUpdateScript(script)) return { ...okBatch(script), affectedRows: 2 };
        return okBatch(script);
      });
      const result = await runFullReplace(params());
      expect(result.geometryRepair.status).toBe(GeometryRepairStatus.FAILED);
      expect(result.geometryRepair.columns).toEqual([{ column: "geom", repairedRows: 2, unrepairableRows: 0 }]);
      expect(result.geometryRepair.message).toBe("columna area: area denied");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe(`${REPAIR_FAILURE_PREFIX}: columna area: area denied`);
      expect(scriptsOf().some((script) => script.includes('"zed"'))).toBe(false);
    });

    it("should still run ANALYZE and keep the replace when only the repair failed", async () => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isGeometryRepairScript(script)) throw new Error("denied");
        return okBatch(script);
      });
      const result = await runFullReplace(params());
      expect(scriptsOf()[scriptsOf().length - 1]).toBe(ANALYZE_SCRIPT);
      expect(result.analyze).toEqual({ status: "ok" });
      expect(result.targetModified).toBe(true);
      expect(result.insertedRows).toBe(3);
    });

    it("should keep replaceErrorCount at 0 and count the sequence and geometry failures in order when both repairs fail", async () => {
      arrange(makeRows(3));
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isSequenceRepairScript(script)) return failedBatch(["sequence denied"]);
        if (isCountScript(script)) return failedBatch(["count denied"]);
        return okBatch(script);
      });
      const result = await runFullReplace(params({ sequences: [seqA] }));
      expect(result.errorCount).toBe(2);
      expect(result.replaceErrorCount).toBe(0);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].startsWith(SEQUENCE_FAILURE_PREFIX)).toBe(true);
      expect(result.errors[0]).toContain("sequence denied");
      expect(result.errors[1].startsWith(`${REPAIR_FAILURE_PREFIX}: columna geom`)).toBe(true);
      expect(result.errors[1]).toContain("count denied");
      expect(result.insertedRows).toBe(3);
      expect(result.targetModified).toBe(true);
    });
  });

  describe("repair decimals", () => {
    it("should use the default 4 decimals tolerance when repairDecimals is absent", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params());
      expect(countScriptsOf()[0]).toContain(`ST_SnapToGrid(ST_Transform(part, 4326), ${DEFAULT_TOLERANCE_LITERAL})`);
      expect(updateScriptsOf()[0]).toContain(`ST_SnapToGrid(ST_Transform(part, 4326), ${DEFAULT_TOLERANCE_LITERAL})`);
    });

    it("should pass a custom repairDecimals of 8 to both the count and the update", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params({ repairDecimals: 8 }));
      expect(countScriptsOf()[0]).toContain("ST_SnapToGrid(ST_Transform(part, 4326), 0.00000001)");
      expect(updateScriptsOf()[0]).toContain("ST_SnapToGrid(ST_Transform(part, 4326), 0.00000001)");
    });

    it("should pass a repairDecimals of 0 as tolerance 1", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params({ repairDecimals: 0 }));
      expect(updateScriptsOf()[0]).toContain("ST_SnapToGrid(ST_Transform(part, 4326), 1)");
    });

    it.each([9, -1, 2.5, Number.NaN])("should fall back to the default tolerance when repairDecimals is %s", async (decimals) => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params({ repairDecimals: decimals }));
      expect(countScriptsOf()[0]).toContain(`ST_SnapToGrid(ST_Transform(part, 4326), ${DEFAULT_TOLERANCE_LITERAL})`);
    });
  });

  describe("order and progress", () => {
    it("should send ANALYZE only after the geometry update request", async () => {
      arrange(makeRows(3));
      arrangeRepair("1,0", 1);
      await runFullReplace(params());
      const scripts = scriptsOf();
      expect(scripts.indexOf(ANALYZE_SCRIPT)).toBeGreaterThan(scripts.findIndex(isUpdateScript));
    });

    it("should send one count and one update even when the replace spans several batches", async () => {
      arrange(makeRows(FULL_REPLACE_BATCH_SIZE + 1));
      arrangeRepair("1,0", 1);
      await runFullReplace(params());
      expect(countScriptsOf()).toHaveLength(1);
      expect(updateScriptsOf()).toHaveLength(1);
    });
  });
});
