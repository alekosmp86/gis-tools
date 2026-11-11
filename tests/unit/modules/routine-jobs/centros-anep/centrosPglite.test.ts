import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planColumns } from "@/modules/routine-jobs/jobs/centros-anep/domain/columnPlan";
import { buildStagingChecksSql, buildFinalCountsSql } from "@/modules/routine-jobs/jobs/centros-anep/domain/stagingSql";
import { toCentrosFinalCounts, toCentrosStagingReport } from "@/modules/routine-jobs/jobs/centros-anep/domain/reportMapping";
import { writeCentrosRevertBackup } from "@/modules/routine-jobs/jobs/centros-anep/services/revertBackup";
import { runCentrosAnep } from "@/modules/routine-jobs/jobs/centros-anep/services/runCentrosAnep";
import { assertInsertedMatches, runCentrosTransaction } from "@/modules/routine-jobs/jobs/centros-anep/services/centrosSteps";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { CentrosParams, CentrosResolved } from "@/modules/routine-jobs/jobs/centros-anep/types";
import { centrosTables, finalLayout, stagingLayout } from "./centrosFixtures";

type Row = Record<string, unknown>;

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const PASSWORD = "Centros-pw!3";
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/* PostGIS is not needed: geometry is a text domain and the spatial functions the SQL uses are minimal stubs. */
const POSTGIS_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS $$ SELECT $1 = '' $$ LANGUAGE sql;
  CREATE FUNCTION ST_Transform(geometry, integer) RETURNS geometry AS $$ SELECT ('T' || $2::text || ':' || $1)::geometry $$ LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS integer AS $$ SELECT CASE WHEN $1 LIKE 'BAD%' THEN 0 ELSE 32721 END $$ LANGUAGE sql;
  CREATE TABLE spatial_ref_sys (srid integer);
  INSERT INTO spatial_ref_sys VALUES (32721);
`;

const TABLES_SQL = `
  CREATE SCHEMA bdj_carto;
  CREATE SCHEMA carto;
  CREATE TABLE bdj_carto.ine_centros_anep (
    ruee double precision, x double precision, y double precision, subsistema text, nombre text,
    depto text, rule_est double precision, geom geometry
  );
  CREATE TABLE carto.ine_centros_anep (
    id serial PRIMARY KEY,
    ruee double precision, x double precision, y double precision, subsistema text, nombre text,
    depto text, rule_est double precision, geom geometry
  );
`;

const sessionOn = (database: PGlite, log: string[] = [], failOn?: string): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    log.push(sql);
    if (failOn !== undefined && sql === failOn) throw new Error(`fallo simulado en ${sql} con ${PASSWORD}`);
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

const insertStaging = (database: PGlite, rows: ReadonlyArray<[number | null, string | null, string | null, string | null]>) =>
  Promise.all(
    rows.map(([ruee, subsistema, nombre, geom]) =>
      database.query("INSERT INTO bdj_carto.ine_centros_anep (ruee, subsistema, nombre, geom) VALUES ($1, $2, $3, $4)", [
        ruee,
        subsistema,
        nombre,
        geom,
      ])
    )
  );

const CLEAN_STAGING: ReadonlyArray<[number, string, string, string]> = [
  [1, "CEIP", "Escuela 1", "P1"],
  [2, "CEIP", "Escuela 2", "P2"],
  [3, "CES", "Liceo", "P3"],
  [4, "CFE", "Formación", "P4"],
];

const resolved = (): CentrosResolved => {
  const staging = stagingLayout();
  const final = finalLayout();
  return {
    staging,
    final,
    defaultSequenceTargets: [],
    schemaBlockers: [],
    plan: planColumns({
      stagingCatalog: staging.catalog,
      finalCatalog: final.catalog,
      stagingGeometry: "geom",
      finalGeometry: "geom",
      identityColumns: [],
    }),
  };
};

const paramsOf = (dryRun: boolean): CentrosParams => ({
  config: { host: "h", port: "5432", db_name: "d", user: "u", password: PASSWORD, schema_name: "", table_name: "" },
  tables: centrosTables(),
  dryRun,
  confirm: !dryRun,
});

const timer = () => createStepTimer({ now: () => 0, total: 10 });

const countOf = async (database: PGlite, table: string): Promise<number> =>
  Number((await database.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

describe("centros-anep SQL on PGlite (CA-8, CA-9, CA-11, CA-12, CA-13, CA-18)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-centros-"));
    tempRoot.directory = directory;
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(TABLES_SQL);
  });

  afterEach(async () => {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  describe("analysis queries", () => {
    it("should count rows, NULL or empty geometry, NULL ruee, NULL subsistema, repeated ruee and damaged text", async () => {
      await insertStaging(database, [
        [1, "CEIP", "Escuela", "P1"],
        [1, "CEIP", "Repetida", "P2"],
        [2, "CES", "Liceo", "P3"],
        [null, "CETP", "Sin ruee", "P4"],
        [3, null, "Sin subsistema", "P5"],
        [4, "CFE", `Da${REPLACEMENT_CHARACTER}ada`, "P6"],
        [5, "CES", "Sin geometria", null],
        [6, "CES", "Geometria vacia", ""],
      ]);

      const checks = await database.query(buildStagingChecksSql(stagingLayout().layout, ["nombre", "subsistema"]));
      const report = toCentrosStagingReport(checks.rows[0] as Row, 0);

      expect(report.rows).toBe(8);
      expect(report.emptyGeometry).toBe(2);
      expect(report.nullRuee).toBe(1);
      expect(report.nullSubsistema).toBe(1);
      expect(report.repeatedGroups).toBe(1);
      expect(report.repeatedRows).toBe(2);
      expect(report.repeatedRuee).toEqual([{ ruee: "1", rows: 2 }]);
      expect(report.damagedTextRows).toBe(1);
      expect(report.bySubsistema).toEqual([
        { value: "CEIP", rows: 2 },
        { value: "CES", rows: 3 },
        { value: "CETP", rows: 1 },
        { value: "CFE", rows: 1 },
        { value: null, rows: 1 },
      ]);
    });

    it("should report zero counts for an empty staging table", async () => {
      const checks = await database.query(buildStagingChecksSql(stagingLayout().layout, ["nombre"]));
      const report = toCentrosStagingReport(checks.rows[0] as Row, 0);

      expect(report).toMatchObject({ rows: 0, emptyGeometry: 0, nullRuee: 0, repeatedGroups: 0, repeatedRows: 0, damagedTextRows: 0 });
      expect(report.bySubsistema).toEqual([]);
    });

    it("should report the clean staging counts by subsistema without damage", async () => {
      await insertStaging(database, CLEAN_STAGING);

      const checks = await database.query(buildStagingChecksSql(stagingLayout().layout, ["nombre", "subsistema"]));
      const report = toCentrosStagingReport(checks.rows[0] as Row, 0);

      expect(report.rows).toBe(4);
      expect(report.damagedTextRows).toBe(0);
      expect(report.repeatedGroups).toBe(0);
      expect(report.bySubsistema).toEqual([
        { value: "CEIP", rows: 2 },
        { value: "CES", rows: 1 },
        { value: "CFE", rows: 1 },
      ]);
    });

    it("should count the final table by subsistema", async () => {
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('CES'), ('CES'), (NULL)");

      const result = await database.query(buildFinalCountsSql(finalLayout()));

      expect(toCentrosFinalCounts(result.rows[0] as Row)).toEqual({
        rows: 3,
        bySubsistema: [
          { value: "CES", rows: 2 },
          { value: null, rows: 1 },
        ],
      });
    });
  });

  describe("runCentrosTransaction dry run (CA-3, CA-9)", () => {
    it("should analyze inside a read-only transaction and leave the final table untouched", async () => {
      await insertStaging(database, CLEAN_STAGING);
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema, nombre) VALUES ('OLD', 'x')");
      const log: string[] = [];

      const outcome = await runCentrosTransaction(sessionOn(database, log), paramsOf(true), resolved(), timer());

      expect(log[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      expect(log).toContain("ROLLBACK");
      expect(log).not.toContain("COMMIT");
      expect(log.some((sql) => sql.includes("DELETE FROM"))).toBe(false);
      expect(outcome.targetModified).toBe(false);
      expect(outcome.outcomeUnknown).toBe(false);
      expect(outcome.inserted).toBe(0);
      expect(outcome.comparison.currentRows).toBe(1);
      expect(outcome.comparison.afterRows).toBe(4);
      expect(await countOf(database, "carto.ine_centros_anep")).toBe(1);
      expect(await readdir(directory)).toEqual([]);
    });
  });

  describe("runCentrosTransaction real run (CA-11, CA-12, CA-13)", () => {
    it("should delete every old row, insert the staging rows, write the revert file and run ANALYZE before COMMIT", async () => {
      await insertStaging(database, CLEAN_STAGING);
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema, nombre, geom) VALUES ('OLD', 'a', 'G1'), ('OLD', 'b', 'G2'), ('CES', 'c', 'G3')");
      const log: string[] = [];

      const outcome = await runCentrosTransaction(sessionOn(database, log), paramsOf(false), resolved(), timer());

      expect(outcome.targetModified).toBe(true);
      expect(outcome.outcomeUnknown).toBe(false);
      expect(outcome.deleted).toBe(3);
      expect(outcome.inserted).toBe(4);
      expect(outcome.backup?.rows).toBe(3);
      expect(log[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ");
      expect(log[1]).toBe('LOCK TABLE "carto"."ine_centros_anep" IN SHARE ROW EXCLUSIVE MODE');
      expect(log.some((sql) => /TRUNCATE/i.test(sql))).toBe(false);
      const analyzeAt = log.findIndex((sql) => sql.startsWith("ANALYZE"));
      expect(analyzeAt).toBeGreaterThan(-1);
      expect(analyzeAt).toBeLessThan(log.indexOf("COMMIT"));
      expect(log[log.length - 1]).toBe("COMMIT");
      const rows = await database.query<{ subsistema: string; geom: string }>(
        "SELECT subsistema, geom FROM carto.ine_centros_anep ORDER BY ruee"
      );
      expect(rows.rows.map((row) => row.subsistema)).toEqual(["CEIP", "CEIP", "CES", "CFE"]);
      expect(rows.rows[0].geom).toBe("T32721:P1");
    });

    it("should let the serial id of the final table fill itself and not copy any id from staging", async () => {
      await insertStaging(database, CLEAN_STAGING);

      await runCentrosTransaction(sessionOn(database), paramsOf(false), resolved(), timer());

      const ids = await database.query<{ id: number }>("SELECT id FROM carto.ine_centros_anep ORDER BY id");
      expect(ids.rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
    });

    it("should write the revert file before the first DELETE", async () => {
      await insertStaging(database, CLEAN_STAGING);
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('OLD')");
      const log: string[] = [];

      await runCentrosTransaction(sessionOn(database, log), paramsOf(false), resolved(), timer());

      const lastPageRead = log.map((sql, index) => (sql.includes("ORDER BY ctid") ? index : -1)).filter((index) => index >= 0).pop() ?? -1;
      const deleteAt = log.findIndex((sql) => sql.includes("DELETE FROM"));
      expect(lastPageRead).toBeGreaterThan(-1);
      expect(lastPageRead).toBeLessThan(deleteAt);
    });

    it("should refuse a staging with a blocker, roll back and write nothing", async () => {
      await insertStaging(database, [...CLEAN_STAGING, [9, "CES", "Sin geometria", null]]);
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('OLD')");
      const log: string[] = [];

      await expect(runCentrosTransaction(sessionOn(database, log), paramsOf(false), resolved(), timer())).rejects.toThrow(
        /no fue modificada/
      );

      expect(log).toContain("ROLLBACK");
      expect(log).not.toContain("COMMIT");
      expect(await countOf(database, "carto.ine_centros_anep")).toBe(1);
      expect(await readdir(directory)).toEqual([]);
    });

    it("should refuse an empty staging and leave the final table intact", async () => {
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('OLD')");

      await expect(runCentrosTransaction(sessionOn(database), paramsOf(false), resolved(), timer())).rejects.toThrow(
        /no tiene filas/
      );

      expect(await countOf(database, "carto.ine_centros_anep")).toBe(1);
    });

    it("should roll back the delete when the inserted count differs from the staging count (count-equality)", async () => {
      await insertStaging(database, CLEAN_STAGING);
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema, nombre) VALUES ('OLD', 'a'), ('OLD', 'b')");
      await database.exec(`
        CREATE FUNCTION carto.skip_ruee_2() RETURNS trigger AS $$ BEGIN IF NEW.ruee = 2 THEN RETURN NULL; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER skip_ruee_2 BEFORE INSERT ON carto.ine_centros_anep FOR EACH ROW EXECUTE FUNCTION carto.skip_ruee_2();
      `);
      const log: string[] = [];

      await expect(runCentrosTransaction(sessionOn(database, log), paramsOf(false), resolved(), timer())).rejects.toThrow(
        /Las filas insertadas \(3\) no coinciden con las filas de staging \(4\)/
      );

      expect(log).toContain("ROLLBACK");
      expect(log).not.toContain("COMMIT");
      const subsistemas = await database.query<{ subsistema: string }>("SELECT subsistema FROM carto.ine_centros_anep");
      expect(subsistemas.rows.map((row) => row.subsistema)).toEqual(["OLD", "OLD"]);
    });

    it("should report outcome unknown, with the commit error scrubbed of the password, when COMMIT fails", async () => {
      await insertStaging(database, CLEAN_STAGING);

      const outcome = await runCentrosTransaction(sessionOn(database, [], "COMMIT"), paramsOf(false), resolved(), timer());

      expect(outcome.outcomeUnknown).toBe(true);
      expect(outcome.targetModified).toBe(false);
      expect(outcome.commitError).toContain("fallo simulado");
      expect(outcome.commitError).not.toContain(PASSWORD);
    });

    it("should roll back and name the untouched table when the insert itself fails", async () => {
      await insertStaging(database, CLEAN_STAGING);
      await database.exec("ALTER TABLE carto.ine_centros_anep ADD CONSTRAINT nombre_corto CHECK (length(nombre) < 5)");
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema, nombre) VALUES ('OLD', 'ok')");

      await expect(runCentrosTransaction(sessionOn(database), paramsOf(false), resolved(), timer())).rejects.toThrow(
        /No se pudo completar la carga de centros ANEP/
      );

      expect(await countOf(database, "carto.ine_centros_anep")).toBe(1);
    });
  });

  describe("runCentrosAnep real run without prior analysis (CA-8, CA-15)", () => {
    const GEOMETRY_TYPE = "geometry(Point,32721)";

    /* PGlite stores geometry as a text domain, so the catalog read is told the typmod PostGIS would report. */
    const realSession = (log: string[]): RunSession => {
      const inner = sessionOn(database, log);
      return {
        async query(sql: string, values?: unknown[]) {
          const result = await inner.query(sql, values);
          if (!sql.includes("pg_attrdef")) return result;
          return {
            rows: result.rows.map((row) => (row.column_name === "geom" ? { ...row, data_type: GEOMETRY_TYPE } : row)),
          };
        },
        async close() {},
      };
    };

    const runReal = (log: string[]) => {
      const deps: RunDeps = { openSession: async () => realSession(log), now: () => 0 };
      return runCentrosAnep(paramsOf(false), deps);
    };

    const expectUntouched = async (log: string[]) => {
      expect(log.some((sql) => /DELETE FROM|INSERT INTO|ANALYZE|ORDER BY ctid/.test(sql))).toBe(false);
      expect(log).not.toContain("COMMIT");
      expect(log).toContain("ROLLBACK");
      expect(await countOf(database, "carto.ine_centros_anep")).toBe(2);
      expect((await database.query("SELECT subsistema FROM carto.ine_centros_anep ORDER BY id")).rows).toEqual([
        { subsistema: "OLD" },
        { subsistema: "OLD2" },
      ]);
      const written = await readdir(directory);
      expect(written.filter((name) => name.endsWith(".sql.gz"))).toEqual([]);
      if (written.includes("gis-tools-routine-jobs")) {
        expect(await readdir(path.join(directory, "gis-tools-routine-jobs"))).toEqual([]);
      }
    };

    beforeEach(async () => {
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema, nombre, geom) VALUES ('OLD', 'a', 'G1'), ('OLD2', 'b', 'G2')");
    });

    it("should throw the empty staging blocker before any backup or DELETE and leave the final table untouched", async () => {
      const log: string[] = [];

      await expect(runReal(log)).rejects.toThrow(/no tiene filas/);

      await expectUntouched(log);
    });

    it("should throw the NULL geometry and damaged text blockers before any backup or DELETE", async () => {
      await insertStaging(database, [
        [1, "CEIP", "Escuela", "P1"],
        [2, "CES", "Sin geometria", null],
        [3, "CFE", `Da${REPLACEMENT_CHARACTER}ada`, "P3"],
      ]);
      const log: string[] = [];

      const failure = await runReal(log).then(
        () => new Error("no fallo"),
        (error: unknown) => error as Error
      );

      expect(failure.message).toMatch(/geometr/i);
      expect(failure.message).toMatch(/caracteres dañados/);
      await expectUntouched(log);
    });
  });

  describe("assertInsertedMatches (CA-11)", () => {
    it("should accept equal counts, including zero", () => {
      expect(() => assertInsertedMatches(4, 4)).not.toThrow();
      expect(() => assertInsertedMatches(0, 0)).not.toThrow();
    });

    it("should throw in Spanish with both counts when they differ", () => {
      expect(() => assertInsertedMatches(3, 4)).toThrow("Las filas insertadas (3) no coinciden con las filas de staging (4).");
      expect(() => assertInsertedMatches(5, 4)).toThrow(/\(5\).*\(4\)/);
    });
  });

  describe("writeCentrosRevertBackup (CA-12)", () => {
    const NOW = new Date(2026, 9, 30, 12, 0, 0);

    it("should write a gzip SQL named centros-anep-revert, register it, and restore the previous rows with their ids", async () => {
      await database.exec(`
        INSERT INTO carto.ine_centros_anep (ruee, subsistema, nombre, geom) VALUES
          (10, 'CEIP', 'Escuela "San José" d''Arc', 'G1'), (11, 'CES', 'Liceo', 'G2'), (NULL, NULL, NULL, NULL);
        DELETE FROM carto.ine_centros_anep WHERE ruee = 11;
      `);
      const before = await database.query("SELECT * FROM carto.ine_centros_anep ORDER BY id");

      const backup = await writeCentrosRevertBackup(sessionOn(database), finalLayout(), 2, NOW);

      const filePath = path.join(directory, "gis-tools-routine-jobs", backup.fileName);
      const text = gunzipSync(await readFile(filePath)).toString("utf8");
      expect(backup.fileName).toMatch(/^centros-anep-revert-carto-ine_centros_anep-\d{8}-\d{6}\.sql\.gz$/);
      expect(backup.rows).toBe(2);
      expect(backup.bytes).toBe((await stat(filePath)).size);
      expect(getRevertBackup(backup.token)).toMatchObject({ filePath, fileName: backup.fileName });
      expect(text.startsWith("SET client_encoding = 'UTF8';\n")).toBe(true);
      expect(text).toContain("OVERRIDING SYSTEM VALUE VALUES");
      expect(text).toContain("BEGIN;");
      expect(text.trimEnd().endsWith("COMMIT;")).toBe(true);
      expect(text).not.toMatch(/^\\/m);

      await database.exec("DELETE FROM carto.ine_centros_anep; INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('OTRO')");
      await database.exec(text.replace("SET client_encoding = 'UTF8';\n", ""));
      const after = await database.query("SELECT * FROM carto.ine_centros_anep ORDER BY id");
      expect(after.rows).toEqual(before.rows);
    });

    it("should write a valid file for an empty final table", async () => {
      const backup = await writeCentrosRevertBackup(sessionOn(database), finalLayout(), 0, NOW);

      const text = gunzipSync(await readFile(path.join(directory, "gis-tools-routine-jobs", backup.fileName))).toString("utf8");
      expect(backup.rows).toBe(0);
      expect(text).not.toContain("INSERT INTO");
      expect(text).toContain("DELETE FROM");
    });

    it("should split the rows of a large table into several INSERT pages", async () => {
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) SELECT 'CEIP' FROM generate_series(1, 1203)");

      const backup = await writeCentrosRevertBackup(sessionOn(database), finalLayout(), 1203, NOW);

      const text = gunzipSync(await readFile(path.join(directory, "gis-tools-routine-jobs", backup.fileName))).toString("utf8");
      expect(backup.rows).toBe(1203);
      expect(text.match(/OVERRIDING SYSTEM VALUE VALUES/g)).toHaveLength(3);
    });

    it("should restore ids into an identity column with OVERRIDING SYSTEM VALUE", async () => {
      await database.exec(`
        CREATE TABLE carto.ine_centros_identity (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ruee double precision, subsistema text, nombre text, geom geometry
        );
        INSERT INTO carto.ine_centros_identity (ruee, subsistema) VALUES (1, 'CES'), (2, 'CFE');
      `);
      const layout = { ...finalLayout(), table: "ine_centros_identity", identityColumns: ["id"] };
      layout.catalog = ["id", "ruee", "subsistema", "nombre", "geom"].map((name) => ({
        column_name: name,
        data_type: "x",
        is_nullable: true,
        column_default: null,
      }));
      const before = await database.query("SELECT * FROM carto.ine_centros_identity ORDER BY id");

      const backup = await writeCentrosRevertBackup(sessionOn(database), layout, 2, NOW);

      const text = gunzipSync(await readFile(path.join(directory, "gis-tools-routine-jobs", backup.fileName))).toString("utf8");
      await database.exec("DELETE FROM carto.ine_centros_identity; INSERT INTO carto.ine_centros_identity (subsistema) VALUES ('Z')");
      await database.exec(text.replace("SET client_encoding = 'UTF8';\n", ""));
      expect((await database.query("SELECT * FROM carto.ine_centros_identity ORDER BY id")).rows).toEqual(before.rows);
    });

    it("should fail with the Spanish backup error and leave no file when the row count differs from the table", async () => {
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('CES')");

      await expect(writeCentrosRevertBackup(sessionOn(database), finalLayout(), 5, NOW)).rejects.toThrow(
        /No se pudo generar el respaldo para revertir: el respaldo tiene 1 filas y la tabla final 5\./
      );

      expect(await readdir(path.join(directory, "gis-tools-routine-jobs"))).toEqual([]);
    });

    it("should leave no file behind when a page query fails", async () => {
      await database.exec("INSERT INTO carto.ine_centros_anep (subsistema) VALUES ('CES')");
      const failing: RunSession = {
        async query() {
          throw new Error("conexión perdida");
        },
        async close() {},
      };

      await expect(writeCentrosRevertBackup(failing, finalLayout(), 1, NOW)).rejects.toThrow(/No se pudo generar el respaldo/);

      expect(await readdir(path.join(directory, "gis-tools-routine-jobs"))).toEqual([]);
    });
  });
});
