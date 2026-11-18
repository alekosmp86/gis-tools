import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbConfig, ExecuteBatchResult } from "@/core/types/db";

const mocks = vi.hoisted(() => ({
  executeSqlInChunks: vi.fn(),
}));

vi.mock("@/core/services/dbExecutionService", () => ({
  executeSqlInChunks: mocks.executeSqlInChunks,
}));

import { repairTargetGeometries } from "@/core/services/geometryRepairRunner";
import { GeometryRepairStatus } from "@/core/types/replace";

const targetConfig = { table_name: "dst", schema_name: "geo" } as unknown as DbConfig;
const PASSWORD = "pw";
const OK_EXECUTION = { errorCount: 0, targetModified: true };
const ENABLED_4 = { enabled: true, decimals: 4 };
const COLUMN_TYPES: Record<string, string> = {
  id: "integer",
  geom: "geometry(MultiPolygon,32721)",
  poly: "geometry(Polygon,32721)",
  zed: "geometry(MultiPolygonZ,32721)",
  mz: "geometry(MultiPolygonZM,32721)",
};

const isCountScript = (script: string): boolean => script.includes("SELECT concat_ws(");
const isUpdateScript = (script: string): boolean => script.includes('AS t SET "');
const columnOf = (script: string): string => (script.includes('"zed"') ? "zed" : "geom");

const okBatch = (script: string, extra: Partial<ExecuteBatchResult> = {}): ExecuteBatchResult => ({
  success: true,
  totalProcessed: 1,
  affectedRows: 0,
  errorCount: 0,
  errors: [],
  message: "ok",
  ...extra,
});

const failedBatch = (errors: string[]): ExecuteBatchResult => ({
  success: false,
  totalProcessed: 0,
  affectedRows: 0,
  errorCount: errors.length,
  errors,
  message: "x",
});

const scriptsOf = (): string[] => mocks.executeSqlInChunks.mock.calls.map((call) => call[2] as string);

const arrangeCounts = (countsByColumn: Record<string, string>, updatedRows = 0) => {
  mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
    if (isCountScript(script)) return okBatch(script, { selectResults: [countsByColumn[columnOf(script)]] });
    if (isUpdateScript(script)) return okBatch(script, { affectedRows: updatedRows });
    return okBatch(script);
  });
};

beforeEach(() => {
  mocks.executeSqlInChunks.mockReset();
});

describe("repairTargetGeometries", () => {
  describe("status off", () => {
    it("should return status off with no columns and send no request when the repair is disabled", async () => {
      const outcome = await repairTargetGeometries(targetConfig, PASSWORD, OK_EXECUTION, COLUMN_TYPES, {
        enabled: false,
        decimals: 4,
      });
      expect(outcome).toEqual({ status: GeometryRepairStatus.OFF, columns: [], skippedColumns: ["poly", "mz"] });
      expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
    });

    it("should report the non-repairable polygonal columns in skippedColumns when the repair is disabled", async () => {
      const outcome = await repairTargetGeometries(targetConfig, PASSWORD, OK_EXECUTION, COLUMN_TYPES, {
        enabled: false,
        decimals: 4,
      });
      expect(outcome.skippedColumns).toEqual(["poly", "mz"]);
    });
  });

  describe("status skipped", () => {
    it("should return status skipped and send no request when the replace reported errors", async () => {
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        { errorCount: 2, targetModified: true },
        COLUMN_TYPES,
        ENABLED_4
      );
      expect(outcome).toEqual({ status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns: ["poly", "mz"] });
      expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
    });

    it("should return status skipped and send no request when the target was not modified", async () => {
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        { errorCount: 0, targetModified: false },
        COLUMN_TYPES,
        ENABLED_4
      );
      expect(outcome.status).toBe(GeometryRepairStatus.SKIPPED);
      expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
    });
  });

  describe("status ok", () => {
    it("should return status ok with no columns and send no request when no column is repairable", async () => {
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { id: "integer", poly: "geometry(Polygon,32721)" },
        ENABLED_4
      );
      expect(outcome).toEqual({ status: GeometryRepairStatus.OK, columns: [], skippedColumns: ["poly"] });
      expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
    });

    it("should run the count then the update for a column and report the update's affected rows", async () => {
      arrangeCounts({ geom: "4,2" }, 4);
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(scriptsOf()).toHaveLength(2);
      expect(isCountScript(scriptsOf()[0])).toBe(true);
      expect(isUpdateScript(scriptsOf()[1])).toBe(true);
      expect(outcome).toEqual({
        status: GeometryRepairStatus.OK,
        columns: [{ column: "geom", repairedRows: 4, unrepairableRows: 2 }],
        skippedColumns: [],
      });
    });

    it("should skip the update and report zero repaired rows when the count changes nothing", async () => {
      arrangeCounts({ geom: "0,3" });
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(scriptsOf()).toHaveLength(1);
      expect(outcome.columns).toEqual([{ column: "geom", repairedRows: 0, unrepairableRows: 3 }]);
    });

    it("should repair every repairable column in key order and skip the unsupported ones", async () => {
      arrangeCounts({ geom: "1,0", zed: "1,0" }, 1);
      const outcome = await repairTargetGeometries(targetConfig, PASSWORD, OK_EXECUTION, COLUMN_TYPES, ENABLED_4);
      expect(scriptsOf().map(columnOf)).toEqual(["geom", "geom", "zed", "zed"]);
      expect(outcome.columns.map((column) => column.column)).toEqual(["geom", "zed"]);
      expect(outcome.skippedColumns).toEqual(["poly", "mz"]);
    });

    it("should send every statement as a single line to the target config with the password", async () => {
      arrangeCounts({ geom: "1,0" }, 1);
      await repairTargetGeometries(targetConfig, PASSWORD, OK_EXECUTION, { geom: "geometry(MultiPolygon,32721)" }, ENABLED_4);
      for (const call of mocks.executeSqlInChunks.mock.calls) {
        expect(call[0]).toBe(targetConfig);
        expect(call[1]).toBe(PASSWORD);
        expect(call[2]).not.toMatch(/[\n\r]/);
        expect(call[4]).toBe(1);
      }
    });

    it("should use the tolerance for the configured decimals in the count and the update", async () => {
      arrangeCounts({ geom: "1,0" }, 1);
      await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        { enabled: true, decimals: 8 }
      );
      for (const script of scriptsOf()) {
        expect(script).toContain("ST_SnapToGrid(ST_Transform(part, 4326), 0.00000001)");
      }
    });

    it("should return status ok with no columns when the table has no columns at all", async () => {
      const outcome = await repairTargetGeometries(targetConfig, PASSWORD, OK_EXECUTION, {}, ENABLED_4);
      expect(outcome).toEqual({ status: GeometryRepairStatus.OK, columns: [], skippedColumns: [] });
    });
  });

  describe("status failed", () => {
    it("should report the database error of a count with the column name and keep the failing column out of columns", async () => {
      mocks.executeSqlInChunks.mockResolvedValue(failedBatch(["permission denied for table dst"]));
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(outcome.status).toBe(GeometryRepairStatus.FAILED);
      expect(outcome.columns).toEqual([]);
      expect(outcome.message).toBe("columna geom: permission denied for table dst");
    });

    it("should report the database error of the update with the column name", async () => {
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (isCountScript(script)) return okBatch(script, { selectResults: ["2,0"] });
        return failedBatch(["update rejected by check constraint"]);
      });
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(outcome.status).toBe(GeometryRepairStatus.FAILED);
      expect(outcome.message).toBe("columna geom: update rejected by check constraint");
    });

    it("should report Error desconocido when the request rejects with a non-Error", async () => {
      mocks.executeSqlInChunks.mockRejectedValue("weird");
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(outcome.status).toBe(GeometryRepairStatus.FAILED);
      expect(outcome.message).toBe("columna geom: Error desconocido");
    });

    it("should report the thrown message when the request rejects with an Error", async () => {
      mocks.executeSqlInChunks.mockRejectedValue(new Error("connection lost"));
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(outcome.message).toBe("columna geom: connection lost");
    });

    it.each([
      ["a bare number", [3]],
      ["a count with a decimal part", ["0,3.5"]],
      ["an empty result list", []],
      ["no result at all", undefined],
    ])("should fail the column and send no update when the count result is %s", async (_label, selectResults) => {
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) =>
        okBatch(script, { selectResults })
      );
      const outcome = await repairTargetGeometries(
        targetConfig,
        PASSWORD,
        OK_EXECUTION,
        { geom: "geometry(MultiPolygon,32721)" },
        ENABLED_4
      );
      expect(outcome.status).toBe(GeometryRepairStatus.FAILED);
      expect(outcome.message).toContain("columna geom:");
      expect(scriptsOf().some(isUpdateScript)).toBe(false);
    });

    it("should keep the columns repaired before the failure and stop at the first failing column", async () => {
      mocks.executeSqlInChunks.mockImplementation(async (_config: DbConfig, _password: string, script: string) => {
        if (columnOf(script) === "zed") return failedBatch(["zed denied"]);
        if (isCountScript(script)) return okBatch(script, { selectResults: ["2,1"] });
        if (isUpdateScript(script)) return okBatch(script, { affectedRows: 2 });
        return okBatch(script);
      });
      const outcome = await repairTargetGeometries(targetConfig, PASSWORD, OK_EXECUTION, COLUMN_TYPES, ENABLED_4);
      expect(outcome.status).toBe(GeometryRepairStatus.FAILED);
      expect(outcome.columns).toEqual([{ column: "geom", repairedRows: 2, unrepairableRows: 1 }]);
      expect(outcome.message).toBe("columna zed: zed denied");
      expect(outcome.skippedColumns).toEqual(["poly", "mz"]);
      expect(scriptsOf().some((script) => script.includes('"mz"'))).toBe(false);
    });
  });
});
