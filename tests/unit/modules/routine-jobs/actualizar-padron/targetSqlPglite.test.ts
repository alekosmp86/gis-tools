import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import type { ActualizarPadronOptions, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";

type Row = Record<string, unknown>;

const SETUP_TIMEOUT_MS = 30000;

/* Stand-ins for the PostGIS functions: geometries are numeric text, so distances and areas are plain differences. */
const POSTGIS_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS 'SELECT $1 <> ''bad''' LANGUAGE sql;
  CREATE FUNCTION ST_MakeValid(geometry) RETURNS geometry AS 'SELECT ''5''::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_CollectionExtract(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION GeometryType(geometry) RETURNS text AS 'SELECT ''MULTIPOLYGON''' LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS int AS 'SELECT 32721' LANGUAGE sql;
  CREATE FUNCTION ST_Transform(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Multi(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Force2D(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS 'SELECT $1 = ''''' LANGUAGE sql;
  CREATE FUNCTION ST_Normalize(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_SnapToGrid(geometry, numeric) RETURNS geometry AS 'SELECT round($1::numeric, 3)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8 AS 'SELECT abs($1::numeric - $2::numeric)::float8' LANGUAGE sql;
  CREATE FUNCTION ST_SymDifference(geometry, geometry) RETURNS geometry AS 'SELECT abs($1::numeric - $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Union(geometry, geometry) RETURNS geometry AS 'SELECT greatest($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Area(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS 'SELECT least($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION geometry_overlaps(geometry, geometry) RETURNS boolean AS 'SELECT true' LANGUAGE sql;
  CREATE OPERATOR && (LEFTARG = geometry, RIGHTARG = geometry, PROCEDURE = geometry_overlaps);
`;

const SCHEMA_SQL = `
  CREATE SCHEMA stg;
  CREATE SCHEMA carto;
  CREATE TABLE stg.padron_staging (unidadcat text, nomdepto text, nomloccat text, padron numeric, geom geometry);
  CREATE TABLE carto.province (id int, name text);
  CREATE TABLE carto.loc (id int, name text, id_province int);
  CREATE TABLE carto.padron (
    id serial PRIMARY KEY, number varchar(10), type_padron varchar(30),
    id_cadastral_locality int, id_province int, geometry geometry, id_address_master int
  );
`;

/* Destination before the run: UNCHANGED (rural, NULL locality), CHANGED, AMBIGUOUS (two rows), MISSING. */
const SEED_SQL = `
  INSERT INTO carto.province VALUES (1, 'MONTEVIDEO');
  INSERT INTO carto.loc VALUES (10, 'CENTRO', 1);
  INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
    ('100', 'RURAL', NULL, 1, '1'),
    ('200', 'URBANO', 10, 1, '2'),
    ('300', 'URBANO', 10, 1, '3'),
    ('300', 'URBANO', 10, 1, '3'),
    ('999', 'URBANO', 10, 1, '9');
  INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
    ('RURAL', 'MONTEVIDEO', NULL, 100, '1'),
    ('URBANO', 'Montevideo', 'centro', 200, '4'),
    ('URBANO', 'Montevideo', 'centro', 300, '3'),
    ('RURAL', 'MONTEVIDEO', NULL, 600, '6');
`;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", Object.values(LOCALITY_COLUMN)),
};

const OPTIONS: ActualizarPadronOptions = { tolerance: 1, updateGeometries: true, linkAddressMaster: false };

const SELECT_PADRON_SQL = "SELECT id, number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master FROM carto.padron ORDER BY id";

interface TargetRow {
  id: number;
  number: string;
  type_padron: string;
  id_cadastral_locality: number | null;
  id_province: number;
  geometry: string;
  id_address_master: number | null;
}

async function readPadron(database: PGlite): Promise<TargetRow[]> {
  const result = await database.query<TargetRow>(SELECT_PADRON_SQL);
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

const keyOf = (row: TargetRow): Omit<TargetRow, "geometry"> => ({
  id: row.id,
  number: row.number,
  type_padron: row.type_padron,
  id_cadastral_locality: row.id_cadastral_locality,
  id_province: row.id_province,
  id_address_master: row.id_address_master,
});

/** The transaction of the stage as the job runs it: classify, repair the sequence, apply, then COMMIT. */
async function runStage(database: PGlite): Promise<{ classification: Row; apply: Row }> {
  await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const classification = (await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS))).rows[0];
  await database.query(buildSequenceRepairSql(TARGET));
  const apply = (await database.query<Row>(buildPadronApplySql(LAYOUTS, OPTIONS))).rows[0];
  await database.exec("COMMIT");
  return { classification, apply };
}

describe("actualizar-padron generated SQL on embedded Postgres", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(SEED_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  describe("classify and apply (AP-37, AP-38, AP-42 to AP-46, AP-48)", () => {
    it("should classify one row of each class and apply exactly one insert and one update", async () => {
      const before = await readPadron(database);

      const { classification, apply } = await runStage(database);

      expect(Number(classification.new)).toBe(1);
      expect(Number(classification.unchanged)).toBe(1);
      expect(Number(classification.changed)).toBe(1);
      expect(Number(classification.ambiguous)).toBe(1);
      expect(Number(classification.missing)).toBe(1);
      expect(Number(apply.inserted)).toBe(1);
      expect(Number(apply.updated)).toBe(1);
      expect(await readPadron(database)).toHaveLength(before.length + 1);
    });

    it("should keep the id and every key column of each existing row", async () => {
      const before = await readPadron(database);

      await runStage(database);

      const beforeIds = before.map((row) => row.id);
      const after = await readPadron(database);
      expect(after.filter((row) => beforeIds.includes(row.id)).map(keyOf)).toEqual(before.map(keyOf));
    });

    it("should update only the geometry of the CHANGED row and leave UNCHANGED, AMBIGUOUS and MISSING rows as they were", async () => {
      const before = await readPadron(database);

      await runStage(database);

      const after = await readPadron(database);
      const byNumber = (number: string, rowsOf: TargetRow[]) => rowsOf.filter((row) => row.number === number);
      expect(byNumber("200", after)[0].geometry).toBe("4");
      expect(byNumber("100", after)).toEqual(byNumber("100", before));
      expect(byNumber("300", after)).toEqual(byNumber("300", before));
      expect(byNumber("999", after)).toEqual(byNumber("999", before));
    });

    it("should insert exactly one rural row with a sequence id greater than every existing id and NULL locality", async () => {
      const before = await readPadron(database);
      const highestExistingId = Math.max(...before.map((row) => row.id));

      await runStage(database);

      const inserted = (await readPadron(database)).filter((row) => row.number === "600");
      expect(inserted).toHaveLength(1);
      expect(inserted[0].id).toBeGreaterThan(highestExistingId);
      expect(inserted[0]).toMatchObject({
        type_padron: "RURAL",
        id_cadastral_locality: null,
        id_province: 1,
        geometry: "6",
        id_address_master: null,
      });
    });

    it("should match the rural row through the NULL-safe key so that it is not inserted a second time", async () => {
      const before = await readPadron(database);

      await runStage(database);

      const after = await readPadron(database);
      expect(after.filter((row) => row.number === "100")).toEqual(before.filter((row) => row.number === "100"));
    });

    it("should insert nothing and update nothing when the same stage runs a second time (AP-43, AP-44)", async () => {
      await runStage(database);
      const afterFirst = await readPadron(database);

      const { apply } = await runStage(database);

      expect(Number(apply.inserted)).toBe(0);
      expect(Number(apply.updated)).toBe(0);
      expect(await readPadron(database)).toEqual(afterFirst);
    });
  });
});

const PAIR_REFERENCE_SQL = `
  INSERT INTO carto.province VALUES (1, 'MONTEVIDEO');
  INSERT INTO carto.loc VALUES (10, 'CENTRO', 1);
`;

describe("actualizar-padron pairs of reclassified and renumbered padrones (AP-64 to AP-67)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(PAIR_REFERENCE_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should update the old row in place and insert no row when one NEW row pairs with it at equal area (AP-64, AP-65, AP-67)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '5', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '5');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(1);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(Number(classification.missing)).toBe(0);
    expect(Number(classification.new)).toBe(0);
    expect(Number(apply.inserted)).toBe(0);
    expect(Number(apply.paired)).toBe(1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before[0].id,
      number: "501",
      type_padron: "RURAL",
      id_cadastral_locality: null,
      id_province: 1,
      geometry: "5",
      id_address_master: 77,
    });
  });

  it("should renumber a rural row with NULL locality in place and keep its NULL locality and address master link (AP-65)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('700', 'RURAL', NULL, 1, '7', 88);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 701, '7');
    `);
    const before = await readPadron(database);

    const { apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(apply.paired)).toBe(1);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before[0].id,
      number: "701",
      type_padron: "RURAL",
      id_cadastral_locality: null,
      id_address_master: 88,
    });
  });

  it("should leave the old row untouched, insert both NEW rows and count the old row as missing when two NEW rows claim it (AP-45, AP-66)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '5', 77);
      INSERT INTO stg.padron_staging VALUES
        ('RURAL', 'MONTEVIDEO', NULL, 501, '5'),
        ('RURAL', 'MONTEVIDEO', NULL, 502, '5');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.pairs_total)).toBe(2);
    expect(Number(classification.pairs_not_applied)).toBe(2);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(classification.new)).toBe(2);
    expect(Number(apply.inserted)).toBe(2);
    expect(Number(apply.paired)).toBe(0);
    expect(after.find((row) => row.id === before[0].id)).toEqual(before[0]);
    expect(after.filter((row) => row.number === "501" || row.number === "502")).toHaveLength(2);
  });

  it("should not pair an old row whose key only skipped staging rows carry and should insert the NEW row (AP-64)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '5', 77);
      INSERT INTO stg.padron_staging VALUES
        ('URBANO', 'Montevideo', 'centro', 500, '5'),
        ('URBANO', 'Montevideo', 'centro', 500.4, '5'),
        ('RURAL', 'MONTEVIDEO', NULL, 501, '5');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(classification.pairs_total)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.find((row) => row.id === before[0].id)).toEqual(before[0]);
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });
});
