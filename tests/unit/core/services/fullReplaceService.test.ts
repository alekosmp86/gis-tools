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

import {
  buildReplaceStatements,
  runFullReplace,
  FULL_REPLACE_BATCH_SIZE,
} from "@/core/services/fullReplaceService";
import { resolveInsertColumns, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";

const sourceConfig = { table_name: "src", schema_name: "public" } as unknown as DbConfig;
const targetConfig = { table_name: "dst", schema_name: "geo" } as unknown as DbConfig;

const okBatch = (script: string): ExecuteBatchResult => {
  const count = script.split("\n").filter((l) => l.trim() !== "").length;
  return { success: true, totalProcessed: count, affectedRows: count, errorCount: 0, errors: [], message: "ok" };
};

const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}` }));

const fetchResult = (records: Array<Record<string, unknown>>, totalCount = records.length): DatabaseFetchResult => ({
  records,
  totalCount,
  columnTypes: { id: "integer", name: "text" },
  detectedSrid: 4326,
});

const mapping: ReplaceColumnMapping = { sourceByTarget: { id: "id", name: "name" }, defaults: {} };

const params = (overrides: Record<string, unknown> = {}) => ({
  sourceConfig,
  targetConfig,
  password: "pw",
  sourceColumns: ["id", "name"],
  targetColumns: ["id", "name"],
  mapping,
  ...overrides,
});

const arrangeFetch = (rows: Array<Record<string, unknown>>, totalCount = rows.length) => {
  mocks.fetchOrStreamRecords.mockImplementation(async (_cfg: DbConfig, mappingCfg?: unknown) =>
    mappingCfg ? fetchResult(rows, totalCount) : fetchResult([], 1)
  );
};

beforeEach(() => {
  mocks.fetchOrStreamRecords.mockReset();
  mocks.executeSqlInChunks.mockReset();
  mocks.executeSqlInChunks.mockImplementation(async (_c: DbConfig, _p: string, script: string) => okBatch(script));
});

describe("buildReplaceStatements", () => {
  const build = (
    records: Array<Record<string, unknown>>,
    mappingValue: ReplaceColumnMapping,
    targetColumns: string[],
    types: Record<string, string>,
    srid = 4326
  ) =>
    buildReplaceStatements({
      targetConfig,
      records,
      insertColumns: resolveInsertColumns(mappingValue, targetColumns),
      targetColumnTypes: types,
      targetSrid: srid,
    });

  it("should put TRUNCATE first and emit one INSERT per row", async () => {
    const statements = await build(makeRows(3), mapping, ["id", "name"], { id: "integer", name: "text" });
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe('TRUNCATE TABLE "geo"."dst";');
    expect(statements[1]).toBe('INSERT INTO "geo"."dst" ("id", "name") VALUES (0, \'n0\');');
  });

  it("should emit only TRUNCATE when source is empty", async () => {
    const statements = await build([], mapping, ["id", "name"], {});
    expect(statements).toEqual(['TRUNCATE TABLE "geo"."dst";']);
  });

  it("should default the schema to public when target schema is empty", async () => {
    const statements = await buildReplaceStatements({
      targetConfig: { table_name: "dst", schema_name: "" } as unknown as DbConfig,
      records: [{ id: 1 }],
      insertColumns: [{ targetColumn: "id", sourceColumn: "id", fixedDefault: null }],
      targetColumnTypes: { id: "integer" },
      targetSrid: 4326,
    });
    expect(statements[0]).toBe('TRUNCATE TABLE "public"."dst";');
    expect(statements[1]).toContain('INSERT INTO "public"."dst"');
  });

  it("should keep byte-identical duplicate rows", async () => {
    const row = { id: 7, name: "dup" };
    const statements = await build([row, { ...row }, { ...row }], mapping, ["id", "name"], {
      id: "integer",
      name: "text",
    });
    expect(statements.slice(1)).toHaveLength(3);
    expect(new Set(statements.slice(1)).size).toBe(1);
  });

  it("should map source columns to differently named target columns", async () => {
    const map: ReplaceColumnMapping = { sourceByTarget: { dest_name: "src_name" }, defaults: {} };
    const statements = await build([{ src_name: "x" }], map, ["dest_name"], { dest_name: "text" });
    expect(statements[1]).toBe('INSERT INTO "geo"."dst" ("dest_name") VALUES (\'x\');');
  });

  it("should omit unmapped target columns with no default", async () => {
    const map: ReplaceColumnMapping = { sourceByTarget: { id: "id", note: null }, defaults: {} };
    const statements = await build([{ id: 1 }], map, ["id", "note"], { id: "integer", note: "text" });
    expect(statements[1]).not.toContain('"note"');
  });

  it("should emit raw default expression unquoted", async () => {
    const map: ReplaceColumnMapping = {
      sourceByTarget: { id: "id", created: null },
      defaults: { created: { fieldName: "created", value: "now()", useRawExpression: true } },
    };
    const statements = await build([{ id: 1 }], map, ["id", "created"], { id: "integer", created: "timestamp" });
    expect(statements[1]).toContain("VALUES (1, now())");
  });

  it("should emit literal default quoted and escaped", async () => {
    const map: ReplaceColumnMapping = {
      sourceByTarget: { id: "id", tag: null },
      defaults: { tag: { fieldName: "tag", value: "it's", useRawExpression: false } },
    };
    const statements = await build([{ id: 1 }], map, ["id", "tag"], { id: "integer", tag: "text" });
    expect(statements[1]).toContain("VALUES (1, 'it''s')");
  });

  it("should write NULL for null and undefined but keep an empty string as an empty literal", async () => {
    const statements = await build([{ id: null, name: undefined }, { id: 1, name: "" }], mapping, ["id", "name"], {
      id: "integer",
      name: "text",
    });
    expect(statements[1]).toContain("VALUES (NULL, NULL)");
    expect(statements[2]).toContain("VALUES (1, '')");
  });

  it("should preserve quotes, newlines, version-like text and spaces byte-for-byte in the INSERT", async () => {
    const tricky = [
      { name: "O'Brien", literal: "'O''Brien'" },
      { name: "Version 2.0", literal: "'Version 2.0'" },
      { name: "  padded  ", literal: "'  padded  '" },
      { name: "a\tb", literal: "'a\tb'" },
      { name: "line1\nline2", literal: "E'line1\\nline2'" },
      { name: "cr\r\nlf", literal: "E'cr\\r\\nlf'" },
      { name: "back\\slash", literal: "E'back\\\\slash'" },
      { name: "00123", literal: "'00123'" },
    ];
    const statements = await build(
      tricky.map((t, i) => ({ id: i, name: t.name })),
      mapping,
      ["id", "name"],
      { id: "integer", name: "text" }
    );
    tricky.forEach((t, i) => {
      expect(statements[i + 1]).toBe(`INSERT INTO "geo"."dst" ("id", "name") VALUES (${i}, ${t.literal});`);
      expect(statements[i + 1]).not.toMatch(/[\n\r]/);
    });
  });

  it("should keep numeric-looking text quoted and write booleans unquoted", async () => {
    const map: ReplaceColumnMapping = { sourceByTarget: { code: "code", flag: "flag" }, defaults: {} };
    const statements = await build([{ code: "1.0", flag: true }], map, ["code", "flag"], {
      code: "text",
      flag: "boolean",
    });
    expect(statements[1]).toContain("VALUES ('1.0', true)");
  });

  it("should escape single quotes in text values", async () => {
    const statements = await build([{ id: 1, name: "O'Brien" }], mapping, ["id", "name"], {
      id: "integer",
      name: "text",
    });
    expect(statements[1]).toContain("'O''Brien'");
  });

  describe("geometry columns", () => {
    const geomMap: ReplaceColumnMapping = { sourceByTarget: { geom: "the_geom" }, defaults: {} };
    const point = { type: "Point", coordinates: [1, 2] };

    it("should build ST_GeomFromGeoJSON with the target SRID", async () => {
      const statements = await build([{ the_geom: point }], geomMap, ["geom"], { geom: "geometry(Point,3857)" });
      expect(statements[1]).toContain("ST_GeomFromGeoJSON");
      expect(statements[1]).toContain("3857");
      expect(statements[1]).toContain('{"type":"Point","coordinates":[1,2]}');
    });

    it("should parse a GeoJSON string value", async () => {
      const statements = await build([{ the_geom: JSON.stringify(point) }], geomMap, ["geom"], {
        geom: "geometry(Point,4326)",
      });
      expect(statements[1]).toContain("ST_GeomFromGeoJSON");
    });

    it("should wrap single geometry in ST_Multi for a multi target", async () => {
      const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
      const statements = await build([{ the_geom: poly }], geomMap, ["geom"], {
        geom: "geometry(MultiPolygon,4326)",
      });
      expect(statements[1]).toContain("ST_Multi(");
    });

    it("should not wrap in ST_Multi for a single-type target", async () => {
      const statements = await build([{ the_geom: point }], geomMap, ["geom"], { geom: "geometry(Point,4326)" });
      expect(statements[1]).not.toContain("ST_Multi");
    });

    it("should write NULL for a null geometry", async () => {
      const statements = await build([{ the_geom: null }], geomMap, ["geom"], { geom: "geometry(Point,4326)" });
      expect(statements[1]).toContain("VALUES (NULL)");
      expect(statements[1]).not.toContain("ST_GeomFromGeoJSON");
    });

    it("should not emit a geometry expression for unparsable geometry text", async () => {
      const statements = await build([{ the_geom: "not json{" }], geomMap, ["geom"], {
        geom: "geometry(Point,4326)",
      });
      expect(statements[1]).not.toContain("ST_GeomFromGeoJSON");
    });
  });
});

describe("buildReplaceStatements empty-string handling", () => {
  const buildOne = (value: unknown, type: string, defaults: ReplaceColumnMapping["defaults"] = {}) =>
    buildReplaceStatements({
      targetConfig,
      records: [{ src: value }],
      insertColumns: resolveInsertColumns({ sourceByTarget: { col: "src" }, defaults }, ["col"]),
      targetColumnTypes: { col: type },
      targetSrid: 4326,
    }).then((statements) => statements[1]);

  it.each([
    "integer",
    "numeric(10,2)",
    "date",
    "timestamp without time zone",
    "boolean",
    "geometry(MultiPolygon,4326)",
  ])("should emit NULL for an empty source string into %s", async (type) => {
    expect(await buildOne("", type)).toBe('INSERT INTO "geo"."dst" ("col") VALUES (NULL);');
  });

  it.each(["text", "character varying(20)"])("should keep an empty literal for an empty source string into %s", async (type) => {
    expect(await buildOne("", type)).toBe('INSERT INTO "geo"."dst" ("col") VALUES (\'\');');
  });

  it.each([
    ["integer", 5, "5"],
    ["numeric(10,2)", "12.50", "'12.50'"],
    ["date", "2024-01-31", "'2024-01-31'"],
    ["timestamp without time zone", "2024-01-31 10:00:00", "'2024-01-31 10:00:00'"],
    ["boolean", true, "true"],
    ["text", "abc", "'abc'"],
    ["character varying(20)", "abc", "'abc'"],
  ])("should leave non-empty values unchanged for %s", async (type, value, literal) => {
    expect(await buildOne(value, type)).toBe(`INSERT INTO "geo"."dst" ("col") VALUES (${literal});`);
  });

  it("should not turn a non-empty geometry value into NULL", async () => {
    const statement = await buildOne({ type: "Point", coordinates: [1, 2] }, "geometry(Point,4326)");
    expect(statement).toContain("ST_GeomFromGeoJSON");
    expect(statement).not.toContain("VALUES (NULL)");
  });

  it.each(["integer", "date", "boolean"])("should not turn a whitespace-only string into NULL for %s", async (type) => {
    expect(await buildOne("  ", type)).toBe('INSERT INTO "geo"."dst" ("col") VALUES (\'  \');');
  });

  it("should leave an empty fixed default untouched because only mapped source values are affected", async () => {
    const statements = await buildReplaceStatements({
      targetConfig,
      records: [{}],
      insertColumns: [{ targetColumn: "num", sourceColumn: null, fixedDefault: { fieldName: "num", value: "", useRawExpression: false } }],
      targetColumnTypes: { num: "integer" },
      targetSrid: 4326,
    });
    expect(statements[1]).toBe('INSERT INTO "geo"."dst" ("num") VALUES (\'\');');
  });

  it("should keep a non-empty fixed default literal on a non-text column", async () => {
    const statements = await buildReplaceStatements({
      targetConfig,
      records: [{}],
      insertColumns: resolveInsertColumns(
        { sourceByTarget: { num: null }, defaults: { num: { fieldName: "num", value: "7", useRawExpression: false } } },
        ["num"]
      ),
      targetColumnTypes: { num: "integer" },
      targetSrid: 4326,
    });
    expect(statements[1]).toBe('INSERT INTO "geo"."dst" ("num") VALUES (\'7\');');
  });
});

describe("runFullReplace", () => {
  it("should propagate fetch failure and execute nothing", async () => {
    mocks.fetchOrStreamRecords.mockRejectedValue(new Error("boom"));
    await expect(runFullReplace(params())).rejects.toThrow("boom");
    expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
  });

  it("should throw and execute nothing when the fetch is incomplete", async () => {
    arrangeFetch(makeRows(3), 5);
    await expect(runFullReplace(params())).rejects.toThrow(/incompleta/);
    expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
  });

  it("should throw when no columns are mapped and not touch the database", async () => {
    arrangeFetch(makeRows(1));
    const emptyMapping: ReplaceColumnMapping = { sourceByTarget: { id: null, name: null }, defaults: {} };
    await expect(runFullReplace(params({ mapping: emptyMapping }))).rejects.toThrow(/columnas mapeadas/);
    expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
    expect(mocks.fetchOrStreamRecords).not.toHaveBeenCalled();
  });

  it("should request only mapped source columns from the source", async () => {
    arrangeFetch(makeRows(1));
    const partial: ReplaceColumnMapping = { sourceByTarget: { id: "id", name: null }, defaults: {} };
    await runFullReplace(params({ mapping: partial }));
    const sourceCall = mocks.fetchOrStreamRecords.mock.calls.find((c) => c[0] === sourceConfig);
    expect(sourceCall?.[1]).toMatchObject({ fieldsToCompare: ["id"] });
  });

  it("should report ignored source columns", async () => {
    arrangeFetch(makeRows(1));
    const partial: ReplaceColumnMapping = { sourceByTarget: { id: "id", name: null }, defaults: {} };
    const result = await runFullReplace(params({ mapping: partial, sourceColumns: ["id", "name", "extra"] }));
    expect(result.ignoredSourceColumns).toEqual(["name", "extra"]);
  });

  it("should stop after a failing first chunk with target unmodified", async () => {
    arrangeFetch(makeRows(800));
    mocks.executeSqlInChunks.mockResolvedValue({
      success: false,
      totalProcessed: 500,
      affectedRows: 0,
      errorCount: 1,
      errors: ["Lote 1 (1-500): fail"],
      message: "x",
    });
    const result = await runFullReplace(params());
    expect(mocks.executeSqlInChunks).toHaveBeenCalledTimes(1);
    expect(result.targetModified).toBe(false);
    expect(result.insertedRows).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.sourceRows).toBe(800);
  });

  it("should throw and execute nothing for an empty source", async () => {
    arrangeFetch([]);
    await expect(runFullReplace(params())).rejects.toThrow(
      "El origen no tiene registros: la tabla destino no fue modificada."
    );
    expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
  });

  it("should throw and fetch/execute nothing when only fixed defaults are mapped", async () => {
    arrangeFetch(makeRows(2));
    const defaultsOnly: ReplaceColumnMapping = {
      sourceByTarget: { id: null, name: null },
      defaults: { name: { fieldName: "name", value: "fixed", useRawExpression: false } },
    };
    await expect(runFullReplace(params({ mapping: defaultsOnly }))).rejects.toThrow(
      /Ninguna columna destino tiene una columna de origen asignada.*no fue modificada/
    );
    expect(mocks.fetchOrStreamRecords).not.toHaveBeenCalled();
    expect(mocks.executeSqlInChunks).not.toHaveBeenCalled();
  });

  it("should request the source with rawValues true and the target meta without it", async () => {
    arrangeFetch(makeRows(1));
    await runFullReplace(params());
    const sourceCall = mocks.fetchOrStreamRecords.mock.calls.find((c) => c[0] === sourceConfig);
    const targetCall = mocks.fetchOrStreamRecords.mock.calls.find((c) => c[0] === targetConfig);
    expect(sourceCall?.[3]).toEqual({ rawValues: true });
    expect(targetCall?.[3]).toEqual({ limit: 1 });
    expect(targetCall?.[3]).not.toHaveProperty("rawValues");
  });

  it("should insert empty-string source values as empty literals, not NULL", async () => {
    arrangeFetch([{ id: 1, name: "" }]);
    await runFullReplace(params());
    expect(mocks.executeSqlInChunks.mock.calls[0][2]).toContain("VALUES (1, '')");
  });

  it.each([
    [1, 1],
    [499, 499],
    [500, 500],
    [501, 501],
    [1000, 1000],
    [1234, 1234],
  ])("should insert all %i source rows and report %i inserted", async (rows, expected) => {
    arrangeFetch(makeRows(rows));
    const result = await runFullReplace(params());
    expect(result.sourceRows).toBe(rows);
    expect(result.insertedRows).toBe(expected);
    expect(result.errorCount).toBe(0);
    expect(result.targetModified).toBe(true);
    expect(result.insertedRows).toBe(result.sourceRows);
  });

  it("should send TRUNCATE first in the first call and split at the batch size", async () => {
    arrangeFetch(makeRows(FULL_REPLACE_BATCH_SIZE + 10));
    await runFullReplace(params());
    expect(mocks.executeSqlInChunks).toHaveBeenCalledTimes(2);
    const first = mocks.executeSqlInChunks.mock.calls[0][2] as string;
    const second = mocks.executeSqlInChunks.mock.calls[1][2] as string;
    expect(first.startsWith('TRUNCATE TABLE "geo"."dst";')).toBe(true);
    expect(first.split("\n")).toHaveLength(FULL_REPLACE_BATCH_SIZE);
    expect(second.split("\n")).toHaveLength(11);
    expect(second).not.toContain("TRUNCATE");
  });

  it("should use a single call when statements fit exactly in one batch", async () => {
    arrangeFetch(makeRows(FULL_REPLACE_BATCH_SIZE - 1));
    await runFullReplace(params());
    expect(mocks.executeSqlInChunks).toHaveBeenCalledTimes(1);
  });

  it("should pass the password and target config to execution", async () => {
    arrangeFetch(makeRows(1));
    await runFullReplace(params({ password: "secret" }));
    expect(mocks.executeSqlInChunks.mock.calls[0][0]).toBe(targetConfig);
    expect(mocks.executeSqlInChunks.mock.calls[0][1]).toBe("secret");
  });

  it("should call execution once per 500-statement slice and never with the whole script", async () => {
    arrangeFetch(makeRows(1200));
    await runFullReplace(params());
    const scripts = mocks.executeSqlInChunks.mock.calls.map((c) => c[2] as string);
    expect(scripts.map((s) => s.split("\n").length)).toEqual([500, 500, 201]);
    expect(scripts[0].startsWith("TRUNCATE")).toBe(true);
    expect(scripts[1]).not.toContain("TRUNCATE");
    expect(scripts[2]).not.toContain("TRUNCATE");
    expect(mocks.executeSqlInChunks.mock.calls.every((c) => c[4] === FULL_REPLACE_BATCH_SIZE)).toBe(true);
  });

  it("should report later-slice errors with real batch/statement offset labels and targetModified true", async () => {
    arrangeFetch(makeRows(1200));
    mocks.executeSqlInChunks
      .mockImplementationOnce(async (_c: DbConfig, _p: string, script: string) => okBatch(script))
      .mockResolvedValueOnce({
        success: false,
        totalProcessed: 500,
        affectedRows: 499,
        errorCount: 1,
        errors: ["Lote 1 (1-500): constraint violation"],
        message: "x",
      })
      .mockResolvedValueOnce({
        success: false,
        totalProcessed: 201,
        affectedRows: 200,
        errorCount: 1,
        errors: ["Lote 1 (1-201): other violation"],
        message: "x",
      });
    const result = await runFullReplace(params());
    expect(mocks.executeSqlInChunks).toHaveBeenCalledTimes(3);
    expect(result.targetModified).toBe(true);
    expect(result.errorCount).toBe(2);
    expect(result.errors).toEqual([
      "Lote 2 (501-1000): constraint violation",
      "Lote 3 (1001-1201): other violation",
    ]);
    expect(result.insertedRows).toBe(499 + 499 + 200);
    expect(result.insertedRows).toBeLessThan(result.sourceRows);
  });

  it("should flag target modified and stop when a later slice call rejects", async () => {
    arrangeFetch(makeRows(1200));
    mocks.executeSqlInChunks
      .mockImplementationOnce(async (_c: DbConfig, _p: string, script: string) => okBatch(script))
      .mockRejectedValueOnce(new Error("connection lost"));
    const result = await runFullReplace(params());
    expect(mocks.executeSqlInChunks).toHaveBeenCalledTimes(2);
    expect(result.targetModified).toBe(true);
    expect(result.errorCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("La tabla destino ya fue modificada");
    expect(result.errors[0]).toContain("connection lost");
    expect(result.insertedRows).toBe(499);
  });

  it("should keep earlier slice progress and add one error when a non-Error is thrown in a later slice", async () => {
    arrangeFetch(makeRows(1200));
    mocks.executeSqlInChunks
      .mockImplementationOnce(async (_c: DbConfig, _p: string, script: string) => okBatch(script))
      .mockImplementationOnce(async (_c: DbConfig, _p: string, script: string) => okBatch(script))
      .mockRejectedValueOnce("weird");
    const result = await runFullReplace(params());
    expect(result.targetModified).toBe(true);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]).toContain("La tabla destino ya fue modificada");
    expect(result.errors[0]).toContain("Error desconocido");
    expect(result.insertedRows).toBe(499 + 500);
  });

  it("should send nothing further after a failing first chunk", async () => {
    arrangeFetch(makeRows(1200));
    mocks.executeSqlInChunks.mockResolvedValueOnce({
      success: false,
      totalProcessed: 500,
      affectedRows: 0,
      errorCount: 1,
      errors: ["Lote 1 (1-500): fail"],
      message: "x",
    });
    const result = await runFullReplace(params());
    expect(mocks.executeSqlInChunks).toHaveBeenCalledTimes(1);
    expect(result.targetModified).toBe(false);
  });

  it("should emit fetch-independent build and execute progress phases", async () => {
    arrangeFetch(makeRows(2));
    const onProgress = vi.fn();
    await runFullReplace(params({ onProgress }));
    const phases = onProgress.mock.calls.map((c) => c[0].phase);
    expect(phases).toContain("build");
    expect(phases).toContain("execute");
  });
});
