import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildCreateDeleteIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import { buildCreateReassignIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignTables";
import { NO_REFERENCE_SCAN, referenceScanOf, type ReferenceScan, type ReferenceScanRow } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import { toPadronClassification } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import {
  buildCaptureAddressMasterSql,
  buildCreateRevertTableSql,
  buildMaxAddressMasterIdSql,
  REVERT_TABLE_SQL,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import type { AcceptedGeometry, ActualizarPadronOptions, PadronLayouts, PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { readRevertCounts, revertScriptLines } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertScript";
import { ADDRESS_MASTER_COLUMN } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
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
  CREATE FUNCTION st_union_first(geometry, geometry) RETURNS geometry AS 'SELECT COALESCE($1, $2)' LANGUAGE sql;
  CREATE AGGREGATE ST_Union(geometry) (SFUNC = st_union_first, STYPE = geometry);
  CREATE FUNCTION ST_Area(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS 'SELECT least($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Centroid(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_X(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Y(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
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

const OPTIONS: ActualizarPadronOptions = {
  tolerance: 1,
  geometryAreaThreshold: 0.05,
  updateGeometries: true,
  linkAddressMaster: false,
  pairChoices: [],
};

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
async function runStage(
  database: PGlite,
  options: ActualizarPadronOptions = OPTIONS
): Promise<{ classification: Row; apply: Row }> {
  await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const classification = (await database.query<Row>(buildPadronClassifySql(LAYOUTS, options))).rows[0];
  await database.query(buildSequenceRepairSql(TARGET));
  const apply = (await database.query<Row>(buildPadronApplySql(LAYOUTS, options))).rows[0];
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

/* Rectangles anchored at the origin, encoded "width:height": two of them intersect in min(width) x min(height), so overlap and area ratio are exact decimals. */
const RECTANGLE_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION rect_width(geometry) RETURNS numeric AS $$ SELECT split_part($1::text, ':', 1)::numeric $$ LANGUAGE sql;
  CREATE FUNCTION rect_height(geometry) RETURNS numeric AS $$ SELECT split_part($1::text, ':', 2)::numeric $$ LANGUAGE sql;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS $$ SELECT $1 <> 'bad' $$ LANGUAGE sql;
  CREATE FUNCTION ST_MakeValid(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_CollectionExtract(geometry, int) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION GeometryType(geometry) RETURNS text AS $$ SELECT 'MULTIPOLYGON' $$ LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS int AS $$ SELECT 32721 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Transform(geometry, int) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Multi(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Force2D(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS $$ SELECT $1 = '' $$ LANGUAGE sql;
  CREATE FUNCTION ST_Normalize(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_SnapToGrid(geometry, numeric) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8 AS $$ SELECT 1::float8 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Area(geometry) RETURNS float8 AS $$ SELECT (rect_width($1) * rect_height($1))::float8 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS $$
    SELECT (least(rect_width($1), rect_width($2))::text || ':' || least(rect_height($1), rect_height($2))::text)::geometry
  $$ LANGUAGE sql;
  CREATE FUNCTION ST_SymDifference(geometry, geometry) RETURNS geometry AS $$
    SELECT ((rect_width($1) * rect_height($1) + rect_width($2) * rect_height($2)
      - 2 * least(rect_width($1), rect_width($2)) * least(rect_height($1), rect_height($2)))::text || ':1')::geometry
  $$ LANGUAGE sql;
  CREATE FUNCTION ST_Union(geometry, geometry) RETURNS geometry AS $$
    SELECT ((rect_width($1) * rect_height($1) + rect_width($2) * rect_height($2)
      - least(rect_width($1), rect_width($2)) * least(rect_height($1), rect_height($2)))::text || ':1')::geometry
  $$ LANGUAGE sql;
  CREATE FUNCTION st_union_first(geometry, geometry) RETURNS geometry AS $$ SELECT COALESCE($1, $2) $$ LANGUAGE sql;
  CREATE AGGREGATE ST_Union(geometry) (SFUNC = st_union_first, STYPE = geometry);
  CREATE FUNCTION ST_Centroid(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_X(geometry) RETURNS float8 AS $$ SELECT rect_width($1)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Y(geometry) RETURNS float8 AS $$ SELECT rect_height($1)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION geometry_overlaps(geometry, geometry) RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;
  CREATE OPERATOR && (LEFTARG = geometry, RIGHTARG = geometry, PROCEDURE = geometry_overlaps);
`;

describe("actualizar-padron pair tiers by footprint overlap and area ratio (STRICT and LOOSE)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(RECTANGLE_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(PAIR_REFERENCE_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should pair the NEW row as LOOSE and update the old row in place when the user chooses it (old 100:93 area 9300, new 93:103 area 9579, intersection 93x93 = 8649)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '93:103');
    `);
    const before = await readPadron(database);
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: before[0].id }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);
    const pairsList = classification.pairs_list as Array<{ tier: string }>;

    expect(Number(classification.pairs)).toBe(1);
    expect(Number(classification.pairs_loose)).toBe(1);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(pairsList).toHaveLength(1);
    expect(pairsList[0].tier).toBe("LOOSE");
    expect(Number(apply.paired)).toBe(1);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before[0].id,
      number: "501",
      type_padron: "RURAL",
      id_cadastral_locality: null,
      id_province: 1,
      geometry: "93:103",
      id_address_master: 77,
    });
  });

  it("should not pair and should insert the NEW row when overlap is 0.80, below the loose floor of 0.85 (old 100:100 area 10000, new 80:115 area 9200 with ratio 0.92 inside the band, intersection 80x100 = 8000)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:100', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '80:115');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(classification.pairs_total)).toBe(0);
    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.find((row) => row.id === before[0].id)).toEqual(before[0]);
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });

  it("should not pair and should insert the NEW row when area ratio is 1.15, above the loose ceiling of 1.10 (old 100:100 area 10000, new 100:115 area 11500, full overlap)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:100', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '100:115');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(classification.pairs_total)).toBe(0);
    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.find((row) => row.id === before[0].id)).toEqual(before[0]);
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });

  it("should tag the pair as STRICT and count no loose pairs when overlap is 1.00 and area ratio is 1.01 (old 100:100 area 10000, new 100:101 area 10100)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:100', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '100:101');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);
    const pairsList = classification.pairs_list as Array<{ tier: string }>;

    expect(Number(classification.pairs)).toBe(1);
    expect(Number(classification.pairs_loose)).toBe(0);
    expect(pairsList).toHaveLength(1);
    expect(pairsList[0].tier).toBe("STRICT");
    expect(Number(apply.paired)).toBe(1);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0].id, number: "501", type_padron: "RURAL", geometry: "100:101" });
  });

  it("should tag the pair as LOOSE, count it as loose and apply it when the user chooses it, the ratio alone failing STRICT (old 100:100 area 10000, new 100:105 area 10500, intersection 100x100 = 10000)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:100', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '100:105');
    `);
    const before = await readPadron(database);
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: before[0].id }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);
    const pairsList = classification.pairs_list as Array<{ tier: string }>;

    expect(Number(classification.pairs)).toBe(1);
    expect(Number(classification.pairs_loose)).toBe(1);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(pairsList).toHaveLength(1);
    expect(pairsList[0].tier).toBe("LOOSE");
    expect(Number(apply.paired)).toBe(1);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before[0].id,
      number: "501",
      type_padron: "RURAL",
      id_cadastral_locality: null,
      id_province: 1,
      geometry: "100:105",
      id_address_master: 77,
    });
  });

  it("should not throw and should pair nothing when an unmatched destination geometry is invalid and the overlay would raise on it (validity guard)", async () => {
    await database.exec(`
      CREATE OR REPLACE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS $$
      BEGIN
        IF $1 = 'bad' OR $2 = 'bad' THEN
          RAISE EXCEPTION 'GEOS: overlay of an invalid geometry';
        END IF;
        RETURN (least(rect_width($1), rect_width($2))::text || ':' || least(rect_height($1), rect_height($2))::text)::geometry;
      END
      $$ LANGUAGE plpgsql;
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, 'bad', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '5:5');
    `);
    await expect(database.query("SELECT ST_Intersection('bad'::geometry, '5:5'::geometry)")).rejects.toThrow();
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);

    expect(Number(classification.pairs_total)).toBe(0);
    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(classification.new)).toBe(1);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.find((row) => row.id === before[0].id)).toEqual(before[0]);
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });

  it("should leave two LOOSE candidates ambiguous, pair nothing and insert the NEW row when one NEW row claims both old rows at overlap 0.93 and area ratio 1.03", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
        ('500', 'URBANO', 10, 1, '100:93', 77),
        ('501', 'URBANO', 10, 1, '100:93', 78);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 502, '93:103');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);
    const pairsList = classification.pairs_list as Array<{ tier: string }>;

    expect(Number(classification.pairs_total)).toBe(2);
    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.pairs_not_applied)).toBe(1);
    expect(Number(classification.pairs_loose)).toBe(0);
    expect(Number(classification.missing)).toBe(2);
    expect(pairsList.map((pair) => pair.tier)).toEqual(["LOOSE", "LOOSE"]);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.filter((row) => row.number === "500" || row.number === "501")).toEqual(
      before.filter((row) => row.number === "500" || row.number === "501")
    );
    expect(after.filter((row) => row.number === "502")).toHaveLength(1);
  });

  it("should leave a LOOSE pair pending, insert the NEW row and list the old row as missing when no choice is made (old 100:93 area 9300, new 93:103 area 9579)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '93:103');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database);
    const after = await readPadron(database);
    const pairsList = classification.pairs_list as Array<{ status: string; tier: string }>;

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.pairs_loose)).toBe(0);
    expect(Number(classification.pairs_pending)).toBe(1);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(classification.new)).toBe(1);
    expect(pairsList).toHaveLength(1);
    expect(pairsList[0]).toMatchObject({ status: "NOT_APPLIED_PENDING", tier: "LOOSE" });
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.find((row) => row.id === before[0].id)).toEqual(before[0]);
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });

});

const GATE_OPTIONS: ActualizarPadronOptions = { ...OPTIONS, tolerance: 0.5, geometryAreaThreshold: 0.05 };

describe("actualizar-padron geometry gate by area change (AP-92, AP-89)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(RECTANGLE_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(PAIR_REFERENCE_SQL);
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
        ('100', 'URBANO', 10, 1, '100:100'),
        ('200', 'URBANO', 10, 1, '100:100'),
        ('300', 'URBANO', 10, 1, '100:100');
      INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
        ('URBANO', 'Montevideo', 'centro', 100, '102:100'),
        ('URBANO', 'Montevideo', 'centro', 200, '107:100'),
        ('URBANO', 'Montevideo', 'centro', 300, '150:100');
    `);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  const digestWith = async (options: ActualizarPadronOptions): Promise<string> =>
    String((await database.query<Row>(buildPadronClassifySql(LAYOUTS, options))).rows[0].plan_digest);

  it("should apply only the 2 % change and leave the 7 % and 50 % changes pending at the 5 % threshold, writing only the applied geometry", async () => {
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database, GATE_OPTIONS);
    const after = await readPadron(database);
    const geometryChanges = classification.geometry_changes as Array<{ number: string; state: string; areaChangePct: number }>;

    expect(Number(classification.changed)).toBe(3);
    expect(Number(classification.updates)).toBe(1);
    expect(Number(classification.geometry_pending)).toBe(2);
    expect(Number(apply.updated)).toBe(1);
    expect(geometryChanges.map((change) => [change.number, change.state, Number(change.areaChangePct)])).toEqual([
      ["300", "PENDING", 33.3],
      ["200", "PENDING", 6.5],
      ["100", "APPLIED", 2],
    ]);
    expect(after.map((row) => [row.number, row.geometry])).toEqual([
      ["100", "102:100"],
      ["200", "100:100"],
      ["300", "100:100"],
    ]);
    expect(after.map(keyOf)).toEqual(before.map(keyOf));
  });

  it("should apply the 7 % and the 50 % changes too when the threshold is raised to 50 %, so the option decides the gate", async () => {
    const { classification, apply } = await runStage(database, { ...GATE_OPTIONS, geometryAreaThreshold: 0.5 });
    const after = await readPadron(database);

    expect(Number(classification.geometry_pending)).toBe(0);
    expect(Number(classification.updates)).toBe(3);
    expect(Number(apply.updated)).toBe(3);
    expect(after.map((row) => row.geometry)).toEqual(["102:100", "107:100", "150:100"]);
  });

  it("should keep the plan digest unchanged when a pending change's staging geometry changes, and change it when an applied change's geometry changes (AP-89)", async () => {
    const digest = await digestWith(GATE_OPTIONS);

    await database.exec("UPDATE stg.padron_staging SET geom = '108:100' WHERE padron = 200");
    const pendingChangedDigest = await digestWith(GATE_OPTIONS);

    await database.exec("UPDATE stg.padron_staging SET geom = '103:100' WHERE padron = 100");
    const appliedChangedDigest = await digestWith(GATE_OPTIONS);

    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(pendingChangedDigest).toBe(digest);
    expect(appliedChangedDigest).not.toBe(pendingChangedDigest);
  });
});

const withChoices = (pairChoices: readonly PairChoice[]): ActualizarPadronOptions => ({ ...OPTIONS, pairChoices });

const idOfNumber = (rows: readonly TargetRow[], number: string): number => {
  const row = rows.find((candidate) => candidate.number === number);
  if (!row) throw new Error(`no destination row numbered ${number}`);
  return row.id;
};

const rowWithId = (rows: readonly TargetRow[], id: number): TargetRow | undefined => rows.find((row) => row.id === id);

describe("actualizar-padron pair choices made by the user for ambiguous groups", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(RECTANGLE_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(PAIR_REFERENCE_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should pair the NEW row only with the chosen old row, update it in place and leave the other candidate missing when two LOOSE candidates claim it and the choice names one (old 500 and 501 at 100:93, new 502 at 93:103)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
        ('500', 'URBANO', 10, 1, '100:93', 77),
        ('501', 'URBANO', 10, 1, '100:93', 78);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 502, '93:103');
    `);
    const before = await readPadron(database);
    const oldId = idOfNumber(before, "500");
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "502", oldId }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(1);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(classification.new)).toBe(0);
    expect(Number(classification.choices_unapplied)).toBe(0);
    expect(Number(apply.paired)).toBe(1);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toHaveLength(2);
    expect(rowWithId(after, oldId)).toMatchObject({
      id: oldId,
      number: "502",
      type_padron: "RURAL",
      id_cadastral_locality: null,
      id_province: 1,
      geometry: "93:103",
      id_address_master: 77,
    });
    expect(rowWithId(after, idOfNumber(before, "501"))).toEqual(rowWithId(before, idOfNumber(before, "501")));
  });

  it("should pair nothing when two LOOSE candidates claim the NEW row and no choice is made (old 500 and 501 at 100:93, new 502 at 93:103)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
        ('500', 'URBANO', 10, 1, '100:93', 77),
        ('501', 'URBANO', 10, 1, '100:93', 78);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 502, '93:103');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database, withChoices([]));
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.choices_unapplied)).toBe(0);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(after.filter((row) => row.number === "500" || row.number === "501")).toEqual(
      before.filter((row) => row.number === "500" || row.number === "501")
    );
  });

  it("should insert the NEW row and pair nothing when its choice is null (no pair, insert as new)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '93:103');
    `);
    const before = await readPadron(database);
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: null }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.missing)).toBe(1);
    expect(Number(classification.new)).toBe(1);
    expect(Number(classification.choices_unapplied)).toBe(0);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(rowWithId(after, idOfNumber(before, "500"))).toEqual(rowWithId(before, idOfNumber(before, "500")));
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });

  it("should pair nothing for the NEW row, insert it and leave every destination row unchanged when the chosen old id is not a candidate of its key (999)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO carto.padron (id, number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES (999, '999', 'URBANO', 10, 1, '1:1', NULL);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '93:103');
    `);
    const before = await readPadron(database);
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: 999 }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.missing)).toBe(2);
    expect(Number(classification.choices_unapplied)).toBe(1);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(rowWithId(after, 999)).toEqual(rowWithId(before, 999));
    expect(rowWithId(after, idOfNumber(before, "500"))).toEqual(rowWithId(before, idOfNumber(before, "500")));
    expect(after).toHaveLength(3);
    expect(after.filter((row) => row.number === "501")).toHaveLength(1);
  });

  it("should list the overlap and the area ratio of each pair as numbers in pairs_list (old 100:93 area 9300, new 93:103 area 9579, intersection 93x93 = 8649, so overlap 8649/9300 = 0.93 and ratio 9579/9300 = 1.03)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 501, '93:103');
    `);

    const { classification } = await runStage(database);
    const pairsList = classification.pairs_list as Array<{ overlap: unknown; areaRatio: unknown }>;

    expect(pairsList).toHaveLength(1);
    expect(typeof pairsList[0].overlap).toBe("number");
    expect(pairsList[0].overlap).toBeCloseTo(0.93, 10);
    expect(typeof pairsList[0].areaRatio).toBe("number");
    expect(pairsList[0].areaRatio).toBeCloseTo(1.03, 10);
  });

  it("should leave both NEW rows ambiguous, pair nothing and insert both when two NEW keys claim one old row and no choice is made (old 500 at 100:93, new 502 and 503 at 93:103)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES
        ('RURAL', 'MONTEVIDEO', NULL, 502, '93:103'),
        ('RURAL', 'MONTEVIDEO', NULL, 503, '93:103');
    `);
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database, withChoices([]));
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.pairs_not_applied)).toBe(2);
    expect(Number(classification.new)).toBe(2);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(2);
    expect(rowWithId(after, idOfNumber(before, "500"))).toEqual(rowWithId(before, idOfNumber(before, "500")));
    expect(after.filter((row) => row.number === "502" || row.number === "503")).toHaveLength(2);
  });

  it("should pair only the chosen NEW key with the shared old row and insert the other NEW key, so no choice is left unapplied (old 500 at 100:93, new 502 chosen, new 503 pruned)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES
        ('RURAL', 'MONTEVIDEO', NULL, 502, '93:103'),
        ('RURAL', 'MONTEVIDEO', NULL, 503, '93:103');
    `);
    const before = await readPadron(database);
    const oldId = idOfNumber(before, "500");
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "502", oldId }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(1);
    expect(Number(classification.pairs_total)).toBe(1);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(Number(classification.new)).toBe(1);
    expect(Number(classification.choices_unapplied)).toBe(0);
    expect(Number(apply.paired)).toBe(1);
    expect(Number(apply.inserted)).toBe(1);
    expect(after).toHaveLength(2);
    expect(rowWithId(after, oldId)).toMatchObject({
      id: oldId,
      number: "502",
      type_padron: "RURAL",
      id_cadastral_locality: null,
      id_province: 1,
      geometry: "93:103",
      id_address_master: 77,
    });
    expect(after.filter((row) => row.number === "503")).toHaveLength(1);
  });

  it("should pair both chosen keys through a cascade when the first choice frees the second old row (old 500 at 100:110, old 501 at 100:100; new 502 at 100:105 and new 503 at 100:95; choice 502 to 500)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
        ('500', 'URBANO', 10, 1, '100:110', 77),
        ('501', 'URBANO', 10, 1, '100:100', 78);
      INSERT INTO stg.padron_staging VALUES
        ('RURAL', 'MONTEVIDEO', NULL, 502, '100:105'),
        ('RURAL', 'MONTEVIDEO', NULL, 503, '100:95');
    `);
    const before = await readPadron(database);
    const firstOldId = idOfNumber(before, "500");
    const secondOldId = idOfNumber(before, "501");
    const options = withChoices([
      { typePadron: "RURAL", provinceId: 1, localityId: null, number: "502", oldId: firstOldId },
      { typePadron: "RURAL", provinceId: 1, localityId: null, number: "503", oldId: secondOldId },
    ]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(2);
    expect(Number(classification.pairs_not_applied)).toBe(0);
    expect(Number(classification.new)).toBe(0);
    expect(Number(classification.choices_unapplied)).toBe(0);
    expect(Number(apply.paired)).toBe(2);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toHaveLength(2);
    expect(rowWithId(after, firstOldId)).toMatchObject({ number: "502", type_padron: "RURAL", id_cadastral_locality: null, geometry: "100:105" });
    expect(rowWithId(after, secondOldId)).toMatchObject({ number: "503", type_padron: "RURAL", id_cadastral_locality: null, geometry: "100:95" });
  });

  it("should prune only and write nothing when the choice names an UNCHANGED key that no NEW row carries, leaving the choice unapplied (old 500 at 100:93, UNCHANGED rural 600 at 5:5)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
        ('500', 'URBANO', 10, 1, '100:93', 77),
        ('600', 'RURAL', NULL, 1, '5:5', NULL);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 600, '5:5');
    `);
    const before = await readPadron(database);
    const oldId = idOfNumber(before, "500");
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "600", oldId }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.unchanged)).toBe(1);
    expect(Number(classification.new)).toBe(0);
    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.choices_unapplied)).toBe(1);
    expect(Number(apply.inserted)).toBe(0);
    expect(Number(apply.updated)).toBe(0);
    expect(Number(apply.paired)).toBe(0);
    expect(after).toEqual(before);
  });

  it("should not count a null old id choice for an UNCHANGED key as unapplied (no pair is expected, so nothing is written)", async () => {
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
        ('600', 'RURAL', NULL, 1, '5:5', NULL);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 600, '5:5');
    `);
    const before = await readPadron(database);
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "600", oldId: null }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.unchanged)).toBe(1);
    expect(Number(classification.choices_unapplied)).toBe(0);
    expect(Number(apply.inserted)).toBe(0);
    expect(after).toEqual(before);
  });

  it("should bind a hostile choice number as data, pair nothing and leave the table intact (number 1'; DROP TABLE x; --)", async () => {
    const hostileNumber = "1'; DROP TABLE x; --";
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master)
        VALUES ('500', 'URBANO', 10, 1, '100:93', 77);
      INSERT INTO stg.padron_staging VALUES ('RURAL', 'MONTEVIDEO', NULL, 502, '93:103');
    `);
    const before = await readPadron(database);
    const oldId = idOfNumber(before, "500");
    const options = withChoices([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: hostileNumber, oldId }]);

    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);

    expect(Number(classification.pairs)).toBe(0);
    expect(Number(classification.choices_unapplied)).toBe(1);
    expect(Number(apply.paired)).toBe(0);
    expect(Number(apply.inserted)).toBe(1);
    expect(rowWithId(after, oldId)).toEqual(rowWithId(before, oldId));
    expect(after.filter((row) => row.number === "502")).toHaveLength(1);
  });
});

/* ST_AsEWKB stand-in: the geometry text is its own hex form, so an even-length digit string round-trips exactly. */
const EWKB_STUB_SQL = `CREATE FUNCTION ST_AsEWKB(geometry) RETURNS bytea AS 'SELECT decode($1::text, ''hex'')' LANGUAGE sql;`;

/* One geometry update (200), one applied pair (500 becomes RURAL 501 with a new geometry) and one insert (600). */
const REVERT_SEED_SQL = `
  INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
    ('200', 'URBANO', 10, 1, '20'),
    ('500', 'URBANO', 10, 1, '50');
  INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
    ('URBANO', 'Montevideo', 'centro', 200, '40'),
    ('RURAL', 'MONTEVIDEO', NULL, 501, '51'),
    ('RURAL', 'MONTEVIDEO', NULL, 600, '60');
`;

const REVERT_GENERATED_AT = "2026-10-30T12:00:00.000Z";

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf("carto", "addresses_master", Object.values(ADDRESS_MASTER_COLUMN)),
  srid: 0,
  idColumn: ADDRESS_MASTER_COLUMN.ID,
  idSequence: null,
  identityColumns: [],
  catalog: [],
};

const ADDRESS_TARGET: WritableTargetLayout = {
  ...TARGET,
  columns: { ...TARGET.columns, id_address_master: "id_address_master" },
};

const sessionOn = (database: PGlite): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

describe("actualizar-padron revert script on embedded Postgres (AP-69 to AP-72)", () => {
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

  it("should restore the table to its snapshot when the generated revert script runs after the real run (AP-69, AP-70, AP-71, AP-72)", async () => {
    await database.exec(EWKB_STUB_SQL);
    await database.exec(REVERT_SEED_SQL);
    const before = await readPadron(database);
    const session = sessionOn(database);

    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    await database.query(buildPadronClassifySql(LAYOUTS, OPTIONS));
    await database.query(buildSequenceRepairSql(TARGET));
    await database.query(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }));
    const counts = await readRevertCounts(session);
    const scriptLines: string[] = [];
    for await (const line of revertScriptLines(session, { target: TARGET, counts, generatedAt: REVERT_GENERATED_AT })) {
      scriptLines.push(line.text);
    }
    await database.exec("COMMIT");
    const afterRun = await readPadron(database);

    await database.exec(scriptLines.join("\n"));
    const afterRevert = await readPadron(database);

    expect(counts).toEqual({ U: 1, P: 1, I: 1, A: 0, D: 0, R: 0, M: 0 });
    expect(afterRun).not.toEqual(before);
    expect(afterRevert).toEqual(before);
  });

  it("should unlink the run's address master links and delete only the run's address master rows when the revert script runs (AP-70, AP-70a, AP-71)", async () => {
    await database.exec(EWKB_STUB_SQL);
    await database.exec(`
      CREATE TABLE carto.addresses_master (addresses_master_id int PRIMARY KEY, urn text);
      INSERT INTO carto.addresses_master VALUES (5, 'cgeo:padron:id:1');
    `);
    await database.exec(REVERT_SEED_SQL);
    await database.exec(
      "INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES ('777', 'URBANO', 10, 1, '7', 5);"
    );
    const before = await readPadron(database);
    const session = sessionOn(database);
    const scriptLines: string[] = [];

    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    await database.query(buildPadronClassifySql(LAYOUTS, OPTIONS));
    await database.query(buildSequenceRepairSql(TARGET));
    await database.query(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }));
    await database.query(buildCaptureAddressMasterSql(ADDRESS_TARGET));
    const maxIdBefore = Number((await database.query<Row>(buildMaxAddressMasterIdSql(ADDRESS_MASTER))).rows[0].max_id);
    await database.exec(`
      INSERT INTO carto.addresses_master VALUES (6, 'cgeo:padron:id:1'), (7, 'cgeo:padron:id:999');
      UPDATE carto.padron SET id_address_master = 6 WHERE id = 1;
      INSERT INTO carto.padron (id, number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
        (10, '810', 'URBANO', 10, 1, '81'), (11, '811', 'URBANO', 10, 1, '82'), (13, '813', 'URBANO', 10, 1, '83');
      INSERT INTO carto.padron (id, number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
        (12, '812', 'URBANO', 10, 1, '84');
      INSERT INTO ${REVERT_TABLE_SQL} (kind, id) VALUES ('I', 10), ('I', 11), ('I', 13);
    `);
    const counts = await readRevertCounts(session);
    for await (const line of revertScriptLines(session, {
      target: ADDRESS_TARGET,
      addressMaster: { layout: ADDRESS_MASTER, maxIdBefore },
      counts,
      generatedAt: REVERT_GENERATED_AT,
    })) {
      scriptLines.push(line.text);
    }
    await database.exec("COMMIT");

    await database.exec(scriptLines.join("\n"));
    const after = await readPadron(database);
    const addressMasterRows = (
      await database.query<{ addresses_master_id: number; urn: string }>(
        "SELECT addresses_master_id, urn FROM carto.addresses_master ORDER BY addresses_master_id"
      )
    ).rows;
    const unlinkLines = scriptLines.filter((line) => line.startsWith("UPDATE ") && line.includes('SET "id_address_master" = NULL'));
    const addressMasterDeleteLines = scriptLines.filter((line) => line.startsWith('DELETE FROM "carto"."addresses_master"'));

    expect(maxIdBefore).toBe(5);
    expect(counts).toEqual({ U: 1, P: 1, I: 4, A: 3, D: 0, R: 0, M: 0 });
    expect(after.filter((row) => row.id !== 12)).toEqual(before);
    expect(after.find((row) => row.id === 12)).toBeDefined();
    expect(addressMasterRows).toEqual([
      { addresses_master_id: 5, urn: "cgeo:padron:id:1" },
      { addresses_master_id: 7, urn: "cgeo:padron:id:999" },
    ]);
    expect(unlinkLines).toHaveLength(1);
    expect(addressMasterDeleteLines).toHaveLength(1);
    expect(scriptLines.indexOf(addressMasterDeleteLines[0])).toBeGreaterThan(scriptLines.indexOf(unlinkLines[0]));
  });
});

const DIGEST_DESTINATION_SQL = `
  INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
    ('100', 'RURAL', NULL, 1, '1'),
    ('200', 'URBANO', 10, 1, '2');
`;

const STAGING_UNCHANGED_ROW = "('RURAL', 'MONTEVIDEO', NULL, 100, '1')";
const STAGING_CHANGED_ROW = "('URBANO', 'Montevideo', 'centro', 200, '4')";
const STAGING_NULL_LOCALITY_NEW_ROW = "('RURAL', 'MONTEVIDEO', NULL, 600, '6')";

const stagingInsertSql = (rows: readonly string[]): string =>
  `INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES ${rows.join(", ")};`;

const openDigestDatabase = async (stagingRows: readonly string[]): Promise<PGlite> => {
  const database = new PGlite();
  await database.exec(POSTGIS_STUBS_SQL);
  await database.exec(SCHEMA_SQL);
  await database.exec(PAIR_REFERENCE_SQL);
  await database.exec(DIGEST_DESTINATION_SQL);
  await database.exec(stagingInsertSql(stagingRows));
  return database;
};

const planDigestOf = async (database: PGlite): Promise<string> => {
  const row = (await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS))).rows[0];
  return String(row.plan_digest);
};

const stagingOrderOf = async (database: PGlite): Promise<number[]> =>
  (await database.query<{ padron: number }>("SELECT padron FROM stg.padron_staging")).rows.map((row) => Number(row.padron));

describe("actualizar-padron plan digest of the planned writes (persist guard input)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await openDigestDatabase([STAGING_UNCHANGED_ROW, STAGING_CHANGED_ROW, STAGING_NULL_LOCALITY_NEW_ROW]);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should return the same plan digest when the same staging rows are inserted in a different order", async () => {
    const reversed = await openDigestDatabase([STAGING_NULL_LOCALITY_NEW_ROW, STAGING_CHANGED_ROW, STAGING_UNCHANGED_ROW]);
    try {
      const digest = await planDigestOf(database);
      expect(await stagingOrderOf(reversed)).not.toEqual(await stagingOrderOf(database));

      const reversedDigest = await planDigestOf(reversed);

      expect(digest).toMatch(/^[0-9a-f]{32}$/);
      expect(reversedDigest).toBe(digest);
    } finally {
      await reversed.close();
    }
  });

  it("should return a different plan digest when one candidate geometry differs and the counts stay equal", async () => {
    const digest = await planDigestOf(database);
    await database.exec("UPDATE stg.padron_staging SET geom = '44' WHERE padron = 200");

    const changedDigest = await planDigestOf(database);

    expect(changedDigest).not.toBe(digest);
  });

  it("should return a different plan digest when the NULL-locality NEW row changes its geometry", async () => {
    const digest = await planDigestOf(database);
    await database.exec("UPDATE stg.padron_staging SET geom = '66' WHERE padron = 600");

    const changedDigest = await planDigestOf(database);

    expect(changedDigest).not.toBe(digest);
  });

  it("should return a different plan digest when the NULL-locality NEW row is removed, so it contributes an entry", async () => {
    const digest = await planDigestOf(database);
    await database.exec("DELETE FROM stg.padron_staging WHERE padron = 600");

    const changedDigest = await planDigestOf(database);

    expect(changedDigest).not.toBe(digest);
  });
});

const CLASSIFY_FIGURE_KEYS = [
  "new",
  "unchanged",
  "within_tolerance",
  "changed",
  "ambiguous",
  "updates",
  "geometry_pending",
  "missing",
  "pairs",
  "pairs_loose",
  "pairs_total",
  "pairs_pending",
  "pairs_not_applied",
  "choices_unapplied",
  "target_rows",
  "target_max_id",
  "staging_candidates",
  "plan_digest",
] as const;

const REPORT_ONLY_COLUMNS = ["missing_review", "pending_geometry_changes"] as const;

describe("actualizar-padron persist classify without the report (report false)", () => {
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

  it("should return the same counts, fingerprint and plan digest as the report classify on the same data", async () => {
    const report = (await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS))).rows[0];
    const persist = (
      await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS, NO_REFERENCE_SCAN, { report: false }))
    ).rows[0];

    expect(Number(report.new)).toBe(1);
    expect(Number(report.changed)).toBe(1);
    for (const key of CLASSIFY_FIGURE_KEYS) {
      expect(String(persist[key]), key).toBe(String(report[key]));
    }
    expect(String(persist.plan_digest)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("should omit the report-only columns when the report is false and keep them when it is true", async () => {
    const report = (await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS))).rows[0];
    const persist = (
      await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS, NO_REFERENCE_SCAN, { report: false }))
    ).rows[0];

    for (const column of REPORT_ONLY_COLUMNS) {
      expect(persist).not.toHaveProperty(column);
      expect(report).toHaveProperty(column);
    }
  });
});

const GEOMETRY_FILL_OPTIONS: ActualizarPadronOptions = { ...OPTIONS, tolerance: 0.5, geometryAreaThreshold: 0.05 };

describe("actualizar-padron geometry of a CHANGED row with a NULL destination geometry (fill-in gate)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(RECTANGLE_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(PAIR_REFERENCE_SQL);
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
        ('100', 'URBANO', 10, 1, NULL),
        ('200', 'URBANO', 10, 1, '100:100');
      INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
        ('URBANO', 'Montevideo', 'centro', 100, '102:100'),
        ('URBANO', 'Montevideo', 'centro', 200, '150:100');
    `);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should apply the NULL-geometry change, counted in updates and written, when updateGeometries is on", async () => {
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database, { ...GEOMETRY_FILL_OPTIONS, updateGeometries: true });
    const after = await readPadron(database);
    const geometryChanges = classification.geometry_changes as Array<{ number: string; state: string }>;

    expect(Number(classification.changed)).toBe(2);
    expect(Number(classification.updates)).toBe(1);
    expect(geometryChanges.map((change) => [change.number, change.state])).toContainEqual(["100", "APPLIED"]);
    expect(Number(apply.updated)).toBe(1);
    expect(after.find((row) => row.number === "100")?.geometry).toBe("102:100");
    expect(after.map(keyOf)).toEqual(before.map(keyOf));
  });

  it("should keep a CHANGED row with an old geometry pending when its area ratio is at or above the threshold", async () => {
    const { classification, apply } = await runStage(database, { ...GEOMETRY_FILL_OPTIONS, updateGeometries: true });
    const after = await readPadron(database);
    const geometryChanges = classification.geometry_changes as Array<{ number: string; state: string }>;

    expect(Number(classification.geometry_pending)).toBe(1);
    expect(geometryChanges.map((change) => [change.number, change.state])).toContainEqual(["200", "PENDING"]);
    expect(Number(apply.updated)).toBe(1);
    expect(after.find((row) => row.number === "200")?.geometry).toBe("100:100");
  });

  it("should leave the NULL-geometry change pending and write nothing when updateGeometries is off", async () => {
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database, { ...GEOMETRY_FILL_OPTIONS, updateGeometries: false });
    const after = await readPadron(database);
    const geometryChanges = classification.geometry_changes as Array<{ number: string; state: string }>;

    expect(Number(classification.changed)).toBe(2);
    expect(Number(classification.updates)).toBe(0);
    expect(Number(classification.geometry_pending)).toBe(2);
    expect(geometryChanges.map((change) => [change.number, change.state])).toContainEqual(["100", "PENDING"]);
    expect(Number(apply.updated)).toBe(0);
    expect(after).toEqual(before);
  });
});

const ACCEPTED_URBANO_200: AcceptedGeometry = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200" };

const withAccepted = (acceptedGeometries: readonly AcceptedGeometry[], base: ActualizarPadronOptions = GATE_OPTIONS): ActualizarPadronOptions => ({
  ...base,
  acceptedGeometries,
});

describe("actualizar-padron accepted geometry changes (AP-100, AP-92)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(RECTANGLE_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(PAIR_REFERENCE_SQL);
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
        ('100', 'URBANO', 10, 1, '100:100'),
        ('200', 'URBANO', 10, 1, '100:100'),
        ('300', 'URBANO', 10, 1, '100:100');
      INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
        ('URBANO', 'Montevideo', 'centro', 100, '102:100'),
        ('URBANO', 'Montevideo', 'centro', 200, '107:100'),
        ('URBANO', 'Montevideo', 'centro', 300, '150:100');
    `);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  const planDigestOf = async (options: ActualizarPadronOptions): Promise<string> =>
    String((await database.query<Row>(buildPadronClassifySql(LAYOUTS, options))).rows[0].plan_digest);

  it("should apply a CHANGED row above the threshold when its key is accepted: counted in updates, written, listed APPLIED and in the digest", async () => {
    const before = await readPadron(database);
    const digestWithoutAccept = await planDigestOf(GATE_OPTIONS);

    const options = withAccepted([ACCEPTED_URBANO_200]);
    const digestWithAccept = await planDigestOf(options);
    const { classification, apply } = await runStage(database, options);
    const after = await readPadron(database);
    const geometryChanges = classification.geometry_changes as Array<{ number: string; state: string }>;

    expect(Number(classification.updates)).toBe(2);
    expect(Number(classification.geometry_pending)).toBe(1);
    expect(Number(classification.geometry_accepts_unapplied)).toBe(0);
    expect(Number(apply.updated)).toBe(2);
    expect(geometryChanges.map((change) => [change.number, change.state])).toEqual([
      ["300", "PENDING"],
      ["200", "APPLIED"],
      ["100", "APPLIED"],
    ]);
    expect(after.map((row) => [row.number, row.geometry])).toEqual([
      ["100", "102:100"],
      ["200", "107:100"],
      ["300", "100:100"],
    ]);
    expect(after.map(keyOf)).toEqual(before.map(keyOf));
    expect(digestWithAccept).not.toBe(digestWithoutAccept);
  });

  it("should keep the same CHANGED row pending, and write only the threshold change, when its key is not accepted", async () => {
    const { classification, apply } = await runStage(database, GATE_OPTIONS);
    const after = await readPadron(database);
    const geometryChanges = classification.geometry_changes as Array<{ number: string; state: string }>;

    expect(Number(classification.updates)).toBe(1);
    expect(geometryChanges.map((change) => [change.number, change.state])).toContainEqual(["200", "PENDING"]);
    expect(Number(apply.updated)).toBe(1);
    expect(after.find((row) => row.number === "200")?.geometry).toBe("100:100");
  });

  it("should not apply an accepted key when updateGeometries is off, and count it as unapplied", async () => {
    const before = await readPadron(database);

    const { classification, apply } = await runStage(database, withAccepted([ACCEPTED_URBANO_200], { ...GATE_OPTIONS, updateGeometries: false }));
    const after = await readPadron(database);

    expect(Number(classification.updates)).toBe(0);
    expect(Number(apply.updated)).toBe(0);
    expect(Number(classification.geometry_accepts_unapplied)).toBe(1);
    expect(after).toEqual(before);
  });

  it("should count only the accepted key with no CHANGED row as unapplied, not the accepted key that was applied", async () => {
    const goneKey: AcceptedGeometry = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "999" };

    const { classification: withGone } = await runStage(database, withAccepted([ACCEPTED_URBANO_200, goneKey]));

    expect(Number(withGone.geometry_accepts_unapplied)).toBe(1);
    expect(Number(withGone.updates)).toBe(2);
  });

  it("should count zero unapplied when an accepted key is already applied by the threshold", async () => {
    const withinThreshold: AcceptedGeometry = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "100" };

    const { classification } = await runStage(database, withAccepted([withinThreshold]));

    expect(Number(classification.geometry_accepts_unapplied)).toBe(0);
    expect(Number(classification.updates)).toBe(1);
  });

  it("should bind hostile text in an accepted key as data: classify runs, nothing is injected and the destination keeps its rows", async () => {
    const before = await readPadron(database);
    const hostileNumber: AcceptedGeometry = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "1'; DROP TABLE carto.padron; --" };
    const hostileType: AcceptedGeometry = { typePadron: "URBANO' OR '1'='1", provinceId: 1, localityId: 10, number: "200" };

    const { classification } = await runStage(database, withAccepted([hostileNumber, hostileType]));
    const after = await readPadron(database);

    expect(Number(classification.geometry_accepts_unapplied)).toBe(2);
    expect(Number(classification.updates)).toBe(1);
    expect(after).toHaveLength(before.length);
    expect(after.map(keyOf)).toEqual(before.map(keyOf));
  });
});

/* AP-101 to AP-108: automatic deletion of unpaired, reference-free padrones.
   Province 1: 100 UNCHANGED by staging (not missing), 500 the old side of a PENDING loose pair with the NEW row 501
   (old area 100, new area 95: overlap 0.95, inside the loose band, short of the strict 0.98 floor), 700 missing and
   reference-free (the only deletable one), 800 missing and referenced by carto.access_point, 810 missing and
   referenced by carto.address_ref (a second referencing table).
   Province 2: 900 and 901, both candidates of the one NEW row 902 (area 95): an AMBIGUOUS pair, both STILL_PAIRABLE. */
const READABLE_ACCESS_POINT: ReferenceScanRow = { schema: "carto", table: "access_point", readable: true };
const READABLE_ADDRESS_REF: ReferenceScanRow = { schema: "carto", table: "address_ref", readable: true };
const BOTH_READABLE_SCAN = referenceScanOf([READABLE_ACCESS_POINT, READABLE_ADDRESS_REF]);

const REMOVAL_SCHEMA_SQL = `
  CREATE TABLE carto.access_point (id serial PRIMARY KEY, id_padron int);
  CREATE TABLE carto.address_ref (id serial PRIMARY KEY, id_padron bigint);
`;

const REMOVAL_SEED_SQL = `
  INSERT INTO carto.province VALUES (1, 'MONTEVIDEO'), (2, 'CANELONES'), (3, 'ROCHA');
  INSERT INTO carto.loc VALUES (10, 'CENTRO', 1);
  INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
    ('100', 'RURAL', NULL, 1, '1', 11),
    ('500', 'URBANO', 10, 1, '100', 22),
    ('700', 'URBANO', 10, 1, '7', 33),
    ('800', 'URBANO', 10, 1, '8', 44),
    ('810', 'URBANO', 10, 1, '81', 55),
    ('900', 'RURAL', NULL, 2, '100', NULL),
    ('901', 'RURAL', NULL, 2, '100', NULL);
  INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
    ('RURAL', 'MONTEVIDEO', NULL, 100, '1'),
    ('URBANO', 'Montevideo', 'centro', 501, '95'),
    ('RURAL', 'CANELONES', NULL, 902, '95');
`;

const REMOVAL_LAYOUTS: PadronLayouts = { ...LAYOUTS, target: ADDRESS_TARGET };

const REMOVAL_FIGURE_KEYS = [
  "removed",
  "removals_skipped_still_pairable",
  "removals_skipped_now_referenced",
  "removals_skipped_not_reassignable",
  "reassigned",
  "subdivided_deleted",
  "removals_skipped_unverified",
  "plan_digest",
] as const;

const hasTempIdsTable = async (database: PGlite): Promise<boolean> =>
  (await database.query<{ found: boolean }>(`SELECT to_regclass('pg_temp.padron_delete_ids') IS NOT NULL AS found`)).rows[0].found;

const tempIdsOf = async (database: PGlite): Promise<number[]> =>
  (await database.query<{ id: number }>(`SELECT id FROM pg_temp.padron_delete_ids ORDER BY id`)).rows.map((row) => Number(row.id));

/** Inside an open transaction: creates the temp table and runs the persist classify that fills it (AP-106). */
async function persistClassify(database: PGlite, scan: ReferenceScan, options: ActualizarPadronOptions = OPTIONS): Promise<Row> {
  await database.exec(buildCreateDeleteIdsTableSql());
  await database.exec(buildCreateReassignIdsTableSql());
  return (await database.query<Row>(buildPadronClassifySql(REMOVAL_LAYOUTS, options, scan, { report: false, persistDeletable: true }))).rows[0];
}

const analysisClassifyOf = async (database: PGlite, scan: ReferenceScan): Promise<Row> =>
  (await database.query<Row>(buildPadronClassifySql(REMOVAL_LAYOUTS, OPTIONS, scan, { report: true }))).rows[0];

async function deleteStatement(database: PGlite, scan: ReferenceScan): Promise<Row> {
  return (await database.query<Row>(buildPadronDeleteSql(REMOVAL_LAYOUTS, scan.tables))).rows[0];
}

describe("actualizar-padron automatic deletion of unpaired, reference-free padrones (AP-101 to AP-108)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(REMOVAL_SCHEMA_SQL);
    await database.exec(REMOVAL_SEED_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  describe("classification (AP-103, AP-105)", () => {
    it("should delete only the unreferenced non-pairable missing padron and skip the pending, ambiguous and referenced ones", async () => {
      const before = await readPadron(database);

      const classification = toPadronClassification(await analysisClassifyOf(database, BOTH_READABLE_SCAN));
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")});`);
      await database.exec(`INSERT INTO carto.address_ref (id_padron) VALUES (${idOfNumber(before, "810")});`);
      const withRefs = toPadronClassification(await analysisClassifyOf(database, BOTH_READABLE_SCAN));

      expect(classification.counts.removed).toBe(3);
      expect(withRefs.counts.removed).toBe(1);
      expect(withRefs.counts.removalsSkipped).toEqual({
        total: 5,
        byReason: { STILL_PAIRABLE: 3, NOW_REFERENCED: 2, NOT_REASSIGNABLE: 0, UNVERIFIED: 0 },
      });
      expect(withRefs.removedList.map((removed) => removed.id)).toEqual([idOfNumber(before, "700")]);
    });

    it("should give the old side of a pending pair and of an ambiguous pair the STILL_PAIRABLE reason even when referenced, before NOW_REFERENCED", async () => {
      const before = await readPadron(database);
      await database.exec(
        `INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "500")}), (${idOfNumber(before, "900")});`
      );

      const classification = toPadronClassification(await analysisClassifyOf(database, BOTH_READABLE_SCAN));
      const reasonOf = (number: string): string | null | undefined =>
        classification.missingReview.find((entry) => entry.oldId === idOfNumber(before, number))?.removalReason;

      expect(reasonOf("500")).toBe("STILL_PAIRABLE");
      expect(reasonOf("900")).toBe("STILL_PAIRABLE");
      expect(reasonOf("901")).toBe("STILL_PAIRABLE");
    });

    it("should expose the reference counts by table in the missing review and a null reason for the padron that will be deleted", async () => {
      const before = await readPadron(database);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")}), (${idOfNumber(before, "800")});`);
      await database.exec(`INSERT INTO carto.address_ref (id_padron) VALUES (${idOfNumber(before, "800")});`);

      const review = toPadronClassification(await analysisClassifyOf(database, BOTH_READABLE_SCAN)).missingReview;
      const entry800 = review.find((entry) => entry.oldId === idOfNumber(before, "800"));
      const entry700 = review.find((entry) => entry.oldId === idOfNumber(before, "700"));

      expect(entry800?.removalReason).toBe("NOW_REFERENCED");
      expect(entry800?.refs).toEqual({ total: 3, byTable: { "carto.access_point": 2, "carto.address_ref": 1 } });
      expect(entry700?.removalReason).toBeNull();
      expect(entry700?.refs).toEqual({ total: 0, byTable: {} });
    });

    it("should not count a padron claimed by an applied pair, nor one the staging table still carries, as deletable", async () => {
      await database.exec(`
        INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES ('950', 'RURAL', NULL, 3, '100');
        INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES ('RURAL', 'ROCHA', NULL, 951, '100');
      `);

      const classification = toPadronClassification(await analysisClassifyOf(database, BOTH_READABLE_SCAN));

      expect(classification.counts.pairs).toBe(1);
      expect(classification.counts.removed).toBe(3);
    });
  });

  describe("analysis (AP-106, AP-107)", () => {
    it("should list the deletable padron with its department, write nothing and leave no temp table in a READ ONLY transaction", async () => {
      const before = await readPadron(database);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const row = await analysisClassifyOf(database, BOTH_READABLE_SCAN);
      const tempBeforeRollback = await hasTempIdsTable(database);
      await database.exec("ROLLBACK");
      const after = await readPadron(database);

      const removedList = (row.removed_list ?? []) as Array<Record<string, unknown>>;
      expect(removedList.map((removed) => Number(removed.id))).toEqual([idOfNumber(before, "700"), idOfNumber(before, "800"), idOfNumber(before, "810")]);
      expect(removedList[0]).toMatchObject({ typePadron: "URBANO", provinceId: 1, department: "MONTEVIDEO", localityId: 10, locality: "CENTRO", number: "700" });
      expect(tempBeforeRollback).toBe(false);
      expect(after).toEqual(before);
    });

    it("should return the same removal counts and plan digest as the persist classify on the same data (digest stability across both paths)", async () => {
      const analysis = await analysisClassifyOf(database, BOTH_READABLE_SCAN);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const persist = await persistClassify(database, BOTH_READABLE_SCAN);
      await database.exec("ROLLBACK");

      for (const key of [...CLASSIFY_FIGURE_KEYS, ...REMOVAL_FIGURE_KEYS]) {
        expect(String(persist[key]), key).toBe(String(analysis[key]));
      }
      expect(Number(analysis.removed)).toBe(3);
    });

    it("should return a plan digest of 32 hex characters that covers the deletable set", async () => {
      const analysis = await analysisClassifyOf(database, BOTH_READABLE_SCAN);

      expect(String(analysis.plan_digest)).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("plan digest over the deletable set (AP-89, AP-90, AP-105)", () => {
    const digestOf = async (scan: ReferenceScan = BOTH_READABLE_SCAN): Promise<string> =>
      String((await analysisClassifyOf(database, scan)).plan_digest);

    it("should change the digest when a deletable padron becomes referenced, so the eligible set shrinks while every count elsewhere is equal", async () => {
      const before = await readPadron(database);
      const digestBefore = await digestOf();

      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "700")});`);
      const digestAfter = await digestOf();

      expect(digestAfter).not.toBe(digestBefore);
    });

    it("should change the digest when a new deletable padron appears", async () => {
      const digestBefore = await digestOf();

      await database.exec(
        `INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES ('960', 'RURAL', NULL, 3, '100');`
      );
      const digestAfter = await digestOf();

      expect(digestAfter).not.toBe(digestBefore);
    });

    it("should change the digest when the deletable set swaps one id for another of the same size", async () => {
      const before = await readPadron(database);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")}), (${idOfNumber(before, "810")});`);
      const digestOne = await digestOf();

      await database.exec(`DELETE FROM carto.access_point; DELETE FROM carto.address_ref;`);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "700")}), (${idOfNumber(before, "810")});`);
      const digestTwo = await digestOf();

      expect(digestTwo).not.toBe(digestOne);
    });

    it("should keep the digest when the references of a padron that is already not deletable change", async () => {
      const before = await readPadron(database);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")});`);
      const digestBefore = await digestOf();

      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")}), (${idOfNumber(before, "500")});`);
      const digestAfter = await digestOf();

      expect(digestAfter).toBe(digestBefore);
    });

  });

  describe("real run (AP-106)", () => {
    it("should fill the temp table with exactly the deletable ids in the persist classify, set-based", async () => {
      const before = await readPadron(database);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const row = await persistClassify(database, BOTH_READABLE_SCAN);
      const ids = await tempIdsOf(database);
      await database.exec("ROLLBACK");

      expect(Number(row.removed)).toBe(3);
      expect(ids).toEqual([idOfNumber(before, "700"), idOfNumber(before, "800"), idOfNumber(before, "810")]);
    });

    it("should delete exactly the unreferenced non-pairable padron, keep every other row and drop the temp table at COMMIT", async () => {
      const before = await readPadron(database);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")});`);
      await database.exec(`INSERT INTO carto.address_ref (id_padron) VALUES (${idOfNumber(before, "810")});`);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      await database.query(buildSequenceRepairSql(TARGET));
      await database.query(buildPadronApplySql(REMOVAL_LAYOUTS, OPTIONS, { captureRevert: true }));
      const deleteRow = await deleteStatement(database, BOTH_READABLE_SCAN);
      const tempDuringTransaction = await hasTempIdsTable(database);
      await database.exec("COMMIT");
      const after = await readPadron(database);
      const tempAfterCommit = await hasTempIdsTable(database);

      const removedIds = before.filter((row) => !after.some((kept) => kept.id === row.id)).map((row) => row.number);
      expect(removedIds).toEqual(["700"]);
      expect(Number(deleteRow.deleted)).toBe(1);
      expect(Number(deleteRow.surviving)).toBe(1);
      expect(Number(deleteRow.revert_rows)).toBe(1);
      expect(tempDuringTransaction).toBe(true);
      expect(tempAfterCommit).toBe(false);
      for (const number of ["100", "500", "800", "810", "900", "901"]) {
        expect(after.some((row) => row.number === number), number).toBe(true);
      }
    });

    it("should capture the deleted row in padron_revert with kind D and every column, including id_province and id_address_master", async () => {
      const before = await readPadron(database);
      const id700 = idOfNumber(before, "700");
      const target700 = rowWithId(before, id700) as TargetRow;

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      const deleteRow = await deleteStatement(database, BOTH_READABLE_SCAN);
      const revertRows = (await database.query<Row>(`SELECT * FROM ${REVERT_TABLE_SQL} WHERE kind = 'D' ORDER BY id`)).rows;
      await database.exec("COMMIT");

      expect(Number(deleteRow.deleted)).toBe(3);
      const captured = revertRows.map((row) => ({ ...row, id: Number(row.id) }));
      expect(captured.map((row) => row.id)).toEqual([id700, idOfNumber(before, "800"), idOfNumber(before, "810")]);
      expect(captured[0]).toMatchObject({
        kind: "D",
        id: id700,
        type_padron: target700.type_padron,
        id_cadastral_locality: target700.id_cadastral_locality,
        number: target700.number,
        geometry: target700.geometry,
        id_province: target700.id_province,
        id_address_master: 33,
      });
    });

    it("should skip, not fail, an id that gets a reference after the classify, deleting the others and capturing only the deleted ones", async () => {
      const before = await readPadron(database);
      const id700 = idOfNumber(before, "700");

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${id700});`);
      const deleteRow = await deleteStatement(database, BOTH_READABLE_SCAN);
      const revertIds = (await database.query<Row>(`SELECT id FROM ${REVERT_TABLE_SQL} WHERE kind = 'D'`)).rows.map((row) => Number(row.id));
      await database.exec("COMMIT");
      const after = await readPadron(database);

      expect(Number(deleteRow.surviving)).toBe(2);
      expect(Number(deleteRow.deleted)).toBe(2);
      expect(after.some((row) => row.id === id700)).toBe(true);
      expect(revertIds).not.toContain(id700);
      expect(revertIds).toHaveLength(2);
    });

    it("should skip an id that gets a reference in the second referencing table after the classify", async () => {
      const before = await readPadron(database);
      const id700 = idOfNumber(before, "700");

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      await database.exec(`INSERT INTO carto.address_ref (id_padron) VALUES (${id700});`);
      const deleteRow = await deleteStatement(database, BOTH_READABLE_SCAN);
      await database.exec("COMMIT");
      const after = await readPadron(database);

      expect(after.some((row) => row.id === id700)).toBe(true);
      expect(Number(deleteRow.deleted)).toBe(2);
      expect(Number(deleteRow.surviving)).toBe(2);
    });

    it("should delete nothing on a second delete statement with the same temp ids, since the rows are already gone", async () => {
      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      const first = await deleteStatement(database, BOTH_READABLE_SCAN);
      const second = await deleteStatement(database, BOTH_READABLE_SCAN);
      await database.exec("COMMIT");

      expect(Number(first.deleted)).toBe(3);
      expect(Number(second.deleted)).toBe(0);
    });

    it("should leave the temp table gone and the destination intact when the transaction rolls back", async () => {
      const before = await readPadron(database);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      await deleteStatement(database, BOTH_READABLE_SCAN);
      await database.exec("ROLLBACK");
      const after = await readPadron(database);

      expect(after).toEqual(before);
      expect(await hasTempIdsTable(database)).toBe(false);
    });

    it("should restore the deleted padron, with its address master link, when the generated revert script runs after the real run", async () => {
      await database.exec(EWKB_STUB_SQL);
      await database.exec(`UPDATE carto.padron SET geometry = number || '0' WHERE number IN ('700', '800', '810');`);
      const before = await readPadron(database);
      const session = sessionOn(database);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      await persistClassify(database, BOTH_READABLE_SCAN);
      await database.query(buildSequenceRepairSql(TARGET));
      await database.query(buildPadronApplySql(REMOVAL_LAYOUTS, OPTIONS, { captureRevert: true }));
      const deleteRow = await deleteStatement(database, BOTH_READABLE_SCAN);
      const counts = await readRevertCounts(session);
      const scriptLines: string[] = [];
      for await (const line of revertScriptLines(session, { target: ADDRESS_TARGET, counts, generatedAt: REVERT_GENERATED_AT })) {
        scriptLines.push(line.text);
      }
      await database.exec("COMMIT");
      const afterRun = await readPadron(database);

      await database.exec(scriptLines.join("\n"));
      const afterRevert = await readPadron(database);

      expect(counts.D).toBe(Number(deleteRow.deleted));
      expect(counts.D).toBe(3);
      expect(afterRun).not.toEqual(before);
      expect(afterRevert).toEqual(before);
    });
  });

  describe("fail closed (AP-102)", () => {
    it("should delete nothing and mark every unpairable, unreferenced padron UNVERIFIED when the scan found no reference table", async () => {
      const before = await readPadron(database);
      const scan = referenceScanOf([]);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      const row = await persistClassify(database, scan);
      const ids = await tempIdsOf(database);
      const deleteRow = await deleteStatement(database, scan);
      await database.exec("COMMIT");
      const after = await readPadron(database);

      expect(scan.blockedReason).not.toBeNull();
      expect(Number(row.removed)).toBe(0);
      expect(Number(row.removals_skipped_unverified)).toBe(3);
      expect(Number(row.removals_skipped_still_pairable)).toBe(3);
      expect(ids).toEqual([]);
      expect(Number(deleteRow.deleted)).toBe(0);
      expect(after.some((padron) => padron.number === "700")).toBe(true);
      expect(after.filter((padron) => before.some((old) => old.id === padron.id))).toEqual(before);
    });

    it("should delete nothing, even a padron whose readable tables show no reference, when another table cannot be read", async () => {
      const before = await readPadron(database);
      const scan = referenceScanOf([READABLE_ACCESS_POINT, { schema: "carto", table: "address_ref", readable: false }]);
      await database.exec(`INSERT INTO carto.address_ref (id_padron) VALUES (${idOfNumber(before, "700")});`);
      await database.exec(`INSERT INTO carto.access_point (id_padron) VALUES (${idOfNumber(before, "800")});`);

      await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await database.query(buildCreateRevertTableSql());
      const row = await persistClassify(database, scan);
      const deleteRow = await deleteStatement(database, scan);
      await database.exec("COMMIT");
      const after = await readPadron(database);

      expect(scan.tables).toEqual([{ schema: "carto", table: "access_point", reassignBlocker: "sin clave primaria de una sola columna" }]);
      expect(scan.blockedReason).toContain("carto.address_ref");
      expect(Number(row.removed)).toBe(0);
      expect(Number(row.removals_skipped_now_referenced)).toBe(1);
      expect(Number(row.removals_skipped_unverified)).toBe(2);
      expect(Number(deleteRow.deleted)).toBe(0);
      expect(after.some((padron) => padron.number === "700")).toBe(true);
    });

    it("should behave as a normal run when every found table is readable", async () => {
      const scan = referenceScanOf([READABLE_ACCESS_POINT, READABLE_ADDRESS_REF]);

      const row = await analysisClassifyOf(database, scan);

      expect(scan.blockedReason).toBeNull();
      expect(Number(row.removed)).toBe(3);
      expect(Number(row.removals_skipped_unverified)).toBe(0);
    });

    it("should change the plan digest between a blocked scan and a readable one, so a plan analyzed under one is refused under the other", async () => {
      const blocked = await analysisClassifyOf(database, referenceScanOf([]));
      const readable = await analysisClassifyOf(database, BOTH_READABLE_SCAN);

      expect(String(blocked.plan_digest)).not.toBe(String(readable.plan_digest));
    });
  });
});

describe("actualizar-padron deletion at scale (AP-106, AP-108)", () => {
  const OVER_LIMIT = DETAIL_LIST_LIMIT + 5;
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(REMOVAL_SCHEMA_SQL);
    await database.exec(REMOVAL_SEED_SQL);
    await database.exec(`
      INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry)
        SELECT 'bulk' || lpad(n::text, 4, '0'), 'RURAL', NULL, 3, '1' FROM generate_series(1, ${OVER_LIMIT}) AS n;
    `);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should count every deletable padron but list only the first DETAIL_LIST_LIMIT in the analysis", async () => {
    const row = await analysisClassifyOf(database, BOTH_READABLE_SCAN);

    expect(Number(row.removed)).toBe(OVER_LIMIT + 3);
    expect(row.removed_list as unknown[]).toHaveLength(DETAIL_LIST_LIMIT);
  });

  it("should list the capped removed padrones ordered by department, locality, number and id", async () => {
    const row = await analysisClassifyOf(database, BOTH_READABLE_SCAN);

    const listed = (row.removed_list as Array<{ department: string | null; number: string }>).map((entry) => `${entry.department}:${entry.number}`);
    expect(listed).toEqual([...listed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).sort((a, b) => a.split(":")[0].localeCompare(b.split(":")[0], "en") ));
    expect(listed[0].startsWith("MONTEVIDEO:")).toBe(true);
  });

  it("should delete every deletable padron in a real run, set-based, while the returned list stays capped", async () => {
    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    const row = await persistClassify(database, BOTH_READABLE_SCAN);
    const deleteRow = await deleteStatement(database, BOTH_READABLE_SCAN);
    const revertCount = Number((await database.query<Row>(`SELECT count(*) AS n FROM ${REVERT_TABLE_SQL} WHERE kind = 'D'`)).rows[0].n);
    await database.exec("COMMIT");

    expect(Number(row.removed)).toBe(OVER_LIMIT + 3);
    expect(Number(deleteRow.deleted)).toBe(OVER_LIMIT + 3);
    expect(Number(deleteRow.surviving)).toBe(OVER_LIMIT + 3);
    expect(revertCount).toBe(OVER_LIMIT + 3);
    expect(deleteRow.removed_list as unknown[]).toHaveLength(DETAIL_LIST_LIMIT);
  });
});
