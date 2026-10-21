import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbConfig } from "@/core/types/db";
import { buildReplaceStatements } from "@/core/services/fullReplaceService";
import { resolveInsertColumns, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { SequenceRef } from "@/core/services/replaceSequences";
import { buildDeleteStatement, buildResetSequenceStatement } from "@/core/services/sqlStatements";

const SERVICES_DIR = path.resolve(__dirname, "../../../../src/core/services");
const FULL_REPLACE_SOURCES = ["fullReplaceService.ts", "sqlStatements.ts", "replaceSequences.ts"];

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

describe("Full Replace SQL and messages (structural)", () => {
  it.each(FULL_REPLACE_SOURCES)("should not mention TRUNCATE outside comments in %s", (fileName) => {
    const source = readFileSync(path.join(SERVICES_DIR, fileName), "utf8");
    expect(stripComments(source).toUpperCase()).not.toContain("TRUNCATE");
  });

  it("should not use ALTER SEQUENCE outside comments in the Full Replace sources", () => {
    FULL_REPLACE_SOURCES.forEach((fileName) => {
      const source = readFileSync(path.join(SERVICES_DIR, fileName), "utf8");
      expect(stripComments(source).toUpperCase()).not.toContain("ALTER SEQUENCE");
    });
  });
});

describe("Full Replace against a real PostgreSQL engine without TRUNCATE privilege", () => {
  const ROLE = "replace_user";
  const targetConfig = { table_name: "dst", schema_name: "geo" } as unknown as DbConfig;
  const mapping: ReplaceColumnMapping = { sourceByTarget: { name: "name" }, defaults: {} };
  const sequence: SequenceRef = { qualifiedLabel: "geo.dst_id_seq", schema: "geo", name: "dst_id_seq", columns: ["id"], mapped: false };
  let database: PGlite;

  const buildStatements = (records: Array<Record<string, unknown>>, sequences: SequenceRef[] = [sequence]) =>
    buildReplaceStatements({
      targetConfig,
      records,
      insertColumns: resolveInsertColumns(mapping, ["name"]),
      targetColumnTypes: { name: "text" },
      targetSrid: 4326,
      sequences,
    });

  const runBatchAsRole = async (statements: string[]): Promise<void> => {
    await database.exec(`SET ROLE ${ROLE};`);
    try {
      await database.exec(`BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
    } catch (error) {
      await database.exec("ROLLBACK;");
      throw error;
    } finally {
      await database.exec("RESET ROLE;");
    }
  };

  const namesInTarget = async (): Promise<string[]> => {
    const result = await database.query<{ name: string }>("SELECT name FROM geo.dst ORDER BY id");
    return result.rows.map((row) => row.name);
  };

  const nextId = async (): Promise<number> => {
    const result = await database.query<{ next: number }>("SELECT nextval('geo.dst_id_seq')::int AS next");
    return result.rows[0].next;
  };

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE SCHEMA geo;
      CREATE TABLE geo.dst (id serial PRIMARY KEY, name text NOT NULL);
      INSERT INTO geo.dst (name) VALUES ('old-1'), ('old-2'), ('old-3');
      CREATE ROLE ${ROLE};
      GRANT USAGE ON SCHEMA geo TO ${ROLE};
      GRANT SELECT, INSERT, DELETE ON geo.dst TO ${ROLE};
      GRANT USAGE, SELECT, UPDATE ON SEQUENCE geo.dst_id_seq TO ${ROLE};
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("should prove the fixture role cannot TRUNCATE nor ALTER SEQUENCE", async () => {
    await database.exec(`SET ROLE ${ROLE};`);
    await expect(database.exec("TRUNCATE TABLE geo.dst;")).rejects.toThrow(/permission denied/);
    await expect(database.exec("ALTER SEQUENCE geo.dst_id_seq RESTART WITH 1;")).rejects.toThrow(/must be owner/);
    await database.exec("RESET ROLE;");
  });

  it("should complete a replace with only SELECT, INSERT, DELETE on the table and UPDATE on the sequence", async () => {
    const statements = await buildStatements([{ name: "new-1" }, { name: "new-2" }]);

    await runBatchAsRole(statements);

    expect(await namesInTarget()).toEqual(["new-1", "new-2"]);
  });

  it("should make the first inserted row take id 1 after the setval reset", async () => {
    const statements = await buildStatements([{ name: "new-1" }]);

    await runBatchAsRole(statements);

    const result = await database.query<{ id: number }>("SELECT id FROM geo.dst");
    expect(result.rows).toEqual([{ id: 1 }]);
  });

  it("should make the next nextval return 1 when the replace source is empty", async () => {
    const statements = await buildStatements([]);

    await runBatchAsRole(statements);

    expect(await namesInTarget()).toEqual([]);
    expect(await nextId()).toBe(1);
  });

  it("should reset a sequence whose name holds a double quote and a single quote", async () => {
    const adversarial: SequenceRef = { qualifiedLabel: `geo.q"s'q`, schema: "geo", name: `q"s'q`, columns: ["id"], mapped: false };
    await database.exec(`CREATE SEQUENCE geo."q""s'q" START 50; GRANT USAGE, SELECT, UPDATE ON SEQUENCE geo."q""s'q" TO ${ROLE};`);
    await database.query(`SELECT nextval('geo."q""s''q"'::regclass)`);

    await runBatchAsRole([buildResetSequenceStatement(adversarial.schema, adversarial.name)]);

    const result = await database.query<{ next: number }>(`SELECT nextval('geo."q""s''q"'::regclass)::int AS next`);
    expect(result.rows[0].next).toBe(1);
  });

  it("should leave the old rows in place when batch 1 fails (DELETE and INSERTs roll back)", async () => {
    const statements = await buildStatements([{ name: "new-1" }, { name: null }]);

    await expect(runBatchAsRole(statements)).rejects.toThrow(/null value|not-null/i);

    expect(await namesInTarget()).toEqual(["old-1", "old-2", "old-3"]);
  });

  it("should not roll the sequence back to its old value after a failed first batch because setval and nextval are not transactional", async () => {
    await database.exec("SELECT setval('geo.dst_id_seq', 3, true);");
    const statements = await buildStatements([{ name: "new-1" }, { name: null }]);

    await expect(runBatchAsRole(statements)).rejects.toThrow();

    expect(await namesInTarget()).toEqual(["old-1", "old-2", "old-3"]);
    expect(await nextId()).toBe(3);
  });

  it("should send DELETE as the first statement of the script", async () => {
    const statements = await buildStatements([{ name: "new-1" }]);

    expect(statements[0]).toBe(buildDeleteStatement("geo", "dst"));
    expect(statements[0]).toBe('DELETE FROM "geo"."dst";');
  });
});
