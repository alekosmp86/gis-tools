import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseFetchResult, DbConfig, ExecuteBatchResult } from "@/core/types/db";

const harness = vi.hoisted(() => ({
  execute: null as null | ((script: string, chunkSize: number) => Promise<ExecuteBatchResult>),
  fetchOrStreamRecords: vi.fn(),
}));

vi.mock("@/core/services/dbExecutionService", () => ({
  executeSqlInChunks: (_config: unknown, _password: string, script: string, _onProgress: unknown, chunkSize = 500) =>
    harness.execute!(script, chunkSize),
}));
vi.mock("@/core/services/streaming/DatabaseStreamReader", () => ({
  DatabaseStreamReader: { fetchOrStreamRecords: harness.fetchOrStreamRecords },
}));

import { buildReplaceStatements, runFullReplace } from "@/core/services/fullReplaceService";
import { resolveInsertColumns, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { SequenceRef } from "@/core/services/replaceSequences";
import { buildRepairSequenceStatement } from "@/core/services/sqlStatements";

const ROLE = "replace_user";
const sourceConfig = { table_name: "src", schema_name: "public" } as unknown as DbConfig;
const targetFor = (table: string) => ({ table_name: table, schema_name: "geo" }) as unknown as DbConfig;

const idSequence = (mapped: boolean): SequenceRef => ({
  qualifiedLabel: "geo.dst_id_seq",
  schema: "geo",
  name: "dst_id_seq",
  columns: ["id"],
  mapped,
});

const UNMAPPED_MAPPING: ReplaceColumnMapping = { sourceByTarget: { id: null, name: "name" }, defaults: {} };
const MAPPED_MAPPING: ReplaceColumnMapping = { sourceByTarget: { id: "id", name: "name" }, defaults: {} };

const namedRows = (count: number, firstId = 1, nullAt = -1) =>
  Array.from({ length: count }, (_, index) => ({ id: firstId + index, name: index === nullAt ? null : `new-${index}` }));

describe("Full Replace sequence adjustment against a real PostgreSQL engine", () => {
  let database: PGlite;

  const statementLines = (script: string): string[] =>
    script
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"));

  const toScalar = (value: unknown): unknown => (typeof value === "bigint" ? Number(value) : value);

  const executeAsRole = async (script: string, chunkSize: number): Promise<ExecuteBatchResult> => {
    const statements = statementLines(script);
    const errors: string[] = [];
    const selectResults: unknown[] = [];
    let errorCount = 0;
    for (let start = 0; start < statements.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, statements.length);
      const chunk = statements.slice(start, end);
      await database.exec(`SET ROLE ${ROLE};`);
      try {
        const results = await database.exec(`BEGIN;\n${chunk.join("\n")}\nCOMMIT;`);
        results
          .filter((result) => result.fields.length > 0 && result.rows.length > 0)
          .forEach((result) => selectResults.push(toScalar(Object.values(result.rows[0])[0])));
      } catch (error) {
        await database.exec("ROLLBACK;");
        errorCount += chunk.length;
        errors.push(`Lote ${start / chunkSize + 1} (${start + 1}-${end}): ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await database.exec("RESET ROLE;");
      }
    }
    return {
      success: errorCount === 0,
      totalProcessed: statements.length,
      affectedRows: 0,
      errorCount,
      errors,
      message: "",
      selectResults,
    } as ExecuteBatchResult;
  };

  interface RunOptions {
    mapping?: ReplaceColumnMapping;
    sequences?: SequenceRef[];
    resetSequences?: boolean;
    table?: string;
    targetColumns?: string[];
    columnTypes?: Record<string, string>;
  }

  const replace = (rows: Array<Record<string, unknown>>, options: RunOptions = {}) => {
    const targetColumns = options.targetColumns ?? ["id", "name"];
    const targetConfig = targetFor(options.table ?? "dst");
    harness.fetchOrStreamRecords.mockImplementation(async (_config: DbConfig, mappingConfig?: unknown) =>
      ({
        records: mappingConfig ? rows : [],
        totalCount: mappingConfig ? rows.length : 1,
        columnTypes: options.columnTypes ?? { id: "integer", name: "text" },
        detectedSrid: 4326,
      }) satisfies DatabaseFetchResult
    );
    return runFullReplace({
      sourceConfig,
      targetConfig,
      password: "pw",
      sourceColumns: targetColumns,
      targetColumns,
      mapping: options.mapping ?? UNMAPPED_MAPPING,
      sequences: options.sequences ?? [idSequence(options.mapping === MAPPED_MAPPING)],
      resetSequences: options.resetSequences ?? true,
    });
  };

  const idsInTarget = async (table = "dst"): Promise<number[]> => {
    const result = await database.query<{ id: number }>(`SELECT id FROM geo.${table} ORDER BY id`);
    return result.rows.map((row) => row.id);
  };

  const probeInsertedId = async (): Promise<number> => {
    const result = await database.query<{ id: number }>("INSERT INTO geo.dst (name) VALUES ('probe') RETURNING id");
    return result.rows[0].id;
  };

  beforeEach(async () => {
    harness.fetchOrStreamRecords.mockReset();
    database = new PGlite();
    harness.execute = executeAsRole;
    await database.exec(`
      CREATE SCHEMA geo;
      CREATE TABLE geo.dst (id serial PRIMARY KEY, name text NOT NULL);
      INSERT INTO geo.dst (name) VALUES ('old-1'), ('old-2'), ('old-3');
      CREATE ROLE ${ROLE};
      GRANT USAGE ON SCHEMA geo TO ${ROLE};
      GRANT SELECT, INSERT, DELETE ON geo.dst TO ${ROLE};
      GRANT USAGE, UPDATE ON SEQUENCE geo.dst_id_seq TO ${ROLE};
    `);
  });

  afterEach(async () => {
    harness.execute = null;
    await database.close();
  });

  it("should prove the fixture role has no SELECT on the sequence relation, no TRUNCATE and no ownership", async () => {
    await database.exec(`SET ROLE ${ROLE};`);
    await expect(database.exec("SELECT last_value FROM geo.dst_id_seq;")).rejects.toThrow(/permission denied/);
    await expect(database.exec("TRUNCATE TABLE geo.dst;")).rejects.toThrow(/permission denied/);
    await expect(database.exec("ALTER SEQUENCE geo.dst_id_seq RESTART WITH 1;")).rejects.toThrow(/must be owner/);
    await database.exec("RESET ROLE;");
  });

  describe("unmapped (default-generated) id column", () => {
    it("should load ids 1..N and leave the sequence handing out N+1 after a successful replace", async () => {
      const result = await replace(namedRows(5));

      expect(result.errorCount).toBe(0);
      expect(await idsInTarget()).toEqual([1, 2, 3, 4, 5]);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 6, resetToStart: true }]);
      expect(await probeInsertedId()).toBe(6);
    });

    it("should hand out the next id above the loaded rows even when the reset checkbox is off", async () => {
      const result = await replace(namedRows(5), { resetSequences: false });

      expect(result.errorCount).toBe(0);
      expect(await idsInTarget()).toEqual([4, 5, 6, 7, 8]);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 9, resetToStart: false }]);
      expect(await probeInsertedId()).toBe(9);
    });

    it("should restore the old rows, raise the sequence above the highest old id and avoid a collision when the first batch fails", async () => {
      const result = await replace([{ name: "new-1" }, { name: null }]);

      expect(result.targetModified).toBe(false);
      expect(result.errorCount).toBeGreaterThan(0);
      expect(await idsInTarget()).toEqual([1, 2, 3]);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 4, resetToStart: false }]);
      expect(await probeInsertedId()).toBe(4);
    });

    it("should never lower the sequence below what the aborted first batch consumed when the reset checkbox is off", async () => {
      const result = await replace([{ name: "new-1" }, { name: null }], { resetSequences: false });

      expect(await idsInTarget()).toEqual([1, 2, 3]);
      expect(result.sequencesAdjusted).toHaveLength(1);
      expect(result.sequencesAdjusted[0].nextValue).toBeGreaterThanOrEqual(4);
      expect(await probeInsertedId()).toBe(result.sequencesAdjusted[0].nextValue);
    });

    it("should keep the partially loaded rows and put the sequence above their highest id when a later batch fails", async () => {
      const result = await replace(namedRows(600, 1, 550));

      expect(result.targetModified).toBe(true);
      expect(result.errors[0]).toMatch(/^Lote 2 \(/);
      const ids = await idsInTarget();
      expect(ids).toHaveLength(498);
      const highestId = ids[ids.length - 1];
      expect(result.sequencesAdjusted).toHaveLength(1);
      expect(result.sequencesAdjusted[0].nextValue).toBeGreaterThan(highestId);
      expect(await probeInsertedId()).toBe(result.sequencesAdjusted[0].nextValue);
    });
  });

  describe("mapped (explicit) id column", () => {
    it("should raise the sequence above the highest explicit id so later default inserts do not collide", async () => {
      const result = await replace(namedRows(10, 100), { mapping: MAPPED_MAPPING });

      expect(result.errorCount).toBe(0);
      expect(await idsInTarget()).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 110, resetToStart: false }]);
      expect(await probeInsertedId()).toBe(110);
    });

    it("should not reset a mapped sequence to 1 before the load", async () => {
      await database.exec("SELECT setval('geo.dst_id_seq', 500, true);");

      const result = await replace(namedRows(3, 1), { mapping: MAPPED_MAPPING });

      expect(result.sequencesAdjusted[0].resetToStart).toBe(false);
    });

    it("should not lower the sequence when the explicit ids are smaller than its current position", async () => {
      await database.exec("SELECT setval('geo.dst_id_seq', 500, true);");

      const result = await replace(namedRows(3, 1), { mapping: MAPPED_MAPPING });

      expect(await idsInTarget()).toEqual([1, 2, 3]);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 501, resetToStart: false }]);
      expect(await probeInsertedId()).toBe(501);
    });

    it("should leave the sequence above the old rows when the first batch fails and the old rows come back", async () => {
      const result = await replace([{ id: 100, name: "new-1" }, { id: 101, name: null }], { mapping: MAPPED_MAPPING });

      expect(result.targetModified).toBe(false);
      expect(await idsInTarget()).toEqual([1, 2, 3]);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 4, resetToStart: false }]);
      expect(await probeInsertedId()).toBe(4);
    });

    it("should put the sequence just above the highest loaded explicit id when a later batch fails", async () => {
      const result = await replace(namedRows(600, 100, 550), { mapping: MAPPED_MAPPING });

      expect(result.targetModified).toBe(true);
      expect(result.errors[0]).toMatch(/^Lote 2 \(/);
      const ids = await idsInTarget();
      expect(ids[ids.length - 1]).toBe(598);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.dst_id_seq", nextValue: 599, resetToStart: false }]);
      expect(await probeInsertedId()).toBe(599);
    });
  });

  describe("empty source (statement level, since runFullReplace refuses an empty source)", () => {
    const runStatements = async (statements: string[]): Promise<void> => {
      const result = await executeAsRole(statements.join("\n"), 500);
      expect(result.errors).toEqual([]);
    };

    it("should leave the table empty and an unmapped sequence at 1", async () => {
      const sequence = idSequence(false);
      const header = await buildReplaceStatements({
        targetConfig: targetFor("dst"),
        records: [],
        insertColumns: resolveInsertColumns(UNMAPPED_MAPPING, ["id", "name"]),
        targetColumnTypes: { id: "integer", name: "text" },
        targetSrid: 4326,
        sequences: [sequence],
      });

      await runStatements([...header, buildRepairSequenceStatement("geo", "dst_id_seq", "geo", "dst", ["id"])]);

      expect(await idsInTarget()).toEqual([]);
      expect(await probeInsertedId()).toBe(1);
    });

    it("should leave the table empty and a mapped sequence unchanged", async () => {
      const sequence = idSequence(true);
      const header = await buildReplaceStatements({
        targetConfig: targetFor("dst"),
        records: [],
        insertColumns: resolveInsertColumns(MAPPED_MAPPING, ["id", "name"]),
        targetColumnTypes: { id: "integer", name: "text" },
        targetSrid: 4326,
        sequences: [sequence],
      });

      await runStatements([...header, buildRepairSequenceStatement("geo", "dst_id_seq", "geo", "dst", ["id"])]);

      expect(await idsInTarget()).toEqual([]);
      expect(await probeInsertedId()).toBe(4);
    });
  });

  describe("two columns sharing one sequence", () => {
    const sharedSequence: SequenceRef = {
      qualifiedLabel: "geo.shared_seq",
      schema: "geo",
      name: "shared_seq",
      columns: ["a", "b"],
      mapped: true,
    };

    beforeEach(async () => {
      await database.exec(`
        CREATE SEQUENCE geo.shared_seq;
        CREATE TABLE geo.dst2 (
          a integer DEFAULT nextval('geo.shared_seq'),
          b integer DEFAULT nextval('geo.shared_seq'),
          name text NOT NULL
        );
        GRANT SELECT, INSERT, DELETE ON geo.dst2 TO ${ROLE};
        GRANT USAGE, UPDATE ON SEQUENCE geo.shared_seq TO ${ROLE};
      `);
    });

    it("should take the maximum over both columns when both receive source values", async () => {
      const rows = [
        { a: 10, b: 500, name: "r1" },
        { a: 11, b: 501, name: "r2" },
        { a: 12, b: 502, name: "r3" },
      ];

      const result = await replace(rows, {
        table: "dst2",
        targetColumns: ["a", "b", "name"],
        mapping: { sourceByTarget: { a: "a", b: "b", name: "name" }, defaults: {} },
        columnTypes: { a: "integer", b: "integer", name: "text" },
        sequences: [sharedSequence],
      });

      expect(result.errorCount).toBe(0);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.shared_seq", nextValue: 503, resetToStart: false }]);
      const next = await database.query<{ next: number }>("SELECT nextval('geo.shared_seq')::int AS next");
      expect(next.rows[0].next).toBe(503);
    });

    it("should use the explicit column maximum when it is above what the default-filled column consumed", async () => {
      const rows = [
        { a: 1000, name: "r1" },
        { a: 1002, name: "r2" },
      ];

      const result = await replace(rows, {
        table: "dst2",
        targetColumns: ["a", "b", "name"],
        mapping: { sourceByTarget: { a: "a", b: null, name: "name" }, defaults: {} },
        columnTypes: { a: "integer", b: "integer", name: "text" },
        sequences: [sharedSequence],
      });

      expect(result.errorCount).toBe(0);
      expect(result.sequencesAdjusted).toEqual([{ qualifiedLabel: "geo.shared_seq", nextValue: 1003, resetToStart: false }]);
    });
  });

  describe("adversarial identifiers", () => {
    it("should repair a sequence, table and column whose names hold double and single quotes", async () => {
      await database.exec(`
        CREATE SEQUENCE geo."q""s'q";
        CREATE TABLE geo."t""x'y" ("c""1" integer);
        INSERT INTO geo."t""x'y" VALUES (7), (8);
        GRANT SELECT ON geo."t""x'y" TO ${ROLE};
        GRANT USAGE, UPDATE ON SEQUENCE geo."q""s'q" TO ${ROLE};
      `);

      const result = await executeAsRole(buildRepairSequenceStatement("geo", `q"s'q`, "geo", `t"x'y`, [`c"1`]), 500);

      expect(result.errors).toEqual([]);
      expect((result as ExecuteBatchResult & { selectResults: unknown[] }).selectResults).toEqual([9]);
      const next = await database.query<{ next: number }>(`SELECT nextval('geo."q""s''q"')::int AS next`);
      expect(next.rows[0].next).toBe(9);
    });
  });

  describe("repair failure (role loses UPDATE on the sequence)", () => {
    beforeEach(async () => {
      await database.exec(`REVOKE UPDATE ON SEQUENCE geo.dst_id_seq FROM ${ROLE};`);
    });

    it("should report one extra error line and keep the replace result intact", async () => {
      const result = await replace(namedRows(10, 100), { mapping: MAPPED_MAPPING, resetSequences: false });

      expect(result.insertedRows).toBe(10);
      expect(result.sourceRows).toBe(10);
      expect(result.targetModified).toBe(true);
      expect(await idsInTarget()).toHaveLength(10);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("No se pudieron ajustar las secuencias");
      expect(result.errors[0]).toMatch(/permission denied/);
      expect(result.errorCount).toBe(1);
      expect(result.sequencesAdjusted).toEqual([]);
    });

    it("should append the repair error after the replace error instead of masking it", async () => {
      const result = await replace(namedRows(600, 100, 550), { mapping: MAPPED_MAPPING, resetSequences: false });

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toMatch(/^Lote 2 \(/);
      expect(result.errors[1]).toContain("No se pudieron ajustar las secuencias");
      expect(result.insertedRows).toBeGreaterThan(0);
      expect(result.sequencesAdjusted).toEqual([]);
    });
  });
});
