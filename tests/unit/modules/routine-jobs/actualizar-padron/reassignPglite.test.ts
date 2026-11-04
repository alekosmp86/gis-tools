import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildCreateDeleteIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import { buildPadronReassignSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignSql";
import {
  buildCreateInsertedIdsTableSql,
  buildCreateReassignIdsTableSql,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignTables";
import { NO_REFERENCE_SCAN, referenceScanOf, type ReferenceScan } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { toPadronClassification } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";
import { buildCreateRevertTableSql, REVERT_TABLE_SQL } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { scanReferenceTables } from "@/modules/routine-jobs/jobs/actualizar-padron/services/referenceTables";
import { readRevertCounts, revertScriptLines } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertScript";
import type { ActualizarPadronOptions, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { ADDRESS_MASTER_COLUMN } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";

type Row = Record<string, unknown>;

const SETUP_TIMEOUT_MS = 30000;

/* Stand-ins for PostGIS in one numeric model: a geometry is numeric text, a part's position is its own area, a point's position is its
   value, 'S:n' is a polygon whose point on the surface is n, and 'W:n' is a point in SRID 4326 that ST_Transform moves by +1000. The
   real PostGIS behaviour (containment gives distance zero, the true point on a surface) is PostGIS's own guarantee. */
const POSTGIS_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE DOMAIN geography AS text;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS 'SELECT $1 <> ''bad''' LANGUAGE sql;
  CREATE FUNCTION ST_MakeValid(geometry) RETURNS geometry AS 'SELECT ''5''::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_CollectionExtract(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION GeometryType(geometry) RETURNS text AS 'SELECT ''MULTIPOLYGON''' LANGUAGE sql;
  CREATE FUNCTION ST_GeometryType(geometry) RETURNS text AS 'SELECT CASE WHEN $1::text LIKE ''S:%'' THEN ''ST_Polygon'' ELSE ''ST_Point'' END' LANGUAGE sql;
  CREATE FUNCTION ST_PointOnSurface(geometry) RETURNS geometry AS 'SELECT substr($1::text, 3)::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Distance(geometry, geometry) RETURNS float8 AS 'SELECT abs($1::text::numeric - $2::text::numeric)::float8' LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS int AS 'SELECT CASE WHEN $1::text LIKE ''W:%'' THEN 4326 ELSE 32721 END' LANGUAGE sql;
  CREATE FUNCTION ST_Transform(geometry, int) RETURNS geometry AS 'SELECT CASE WHEN $1::text LIKE ''W:%'' THEN (substr($1::text, 3)::numeric + 1000)::text ELSE $1::text END::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Multi(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Force2D(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS 'SELECT $1 = ''''' LANGUAGE sql;
  CREATE FUNCTION ST_Normalize(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_SnapToGrid(geometry, numeric) RETURNS geometry AS 'SELECT round($1::numeric, 3)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8 AS 'SELECT abs($1::numeric - $2::numeric)::float8' LANGUAGE sql;
  CREATE FUNCTION ST_SymDifference(geometry, geometry) RETURNS geometry AS 'SELECT abs($1::numeric - $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Union(geometry, geometry) RETURNS geometry AS 'SELECT greatest($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION st_union_sum(geometry, geometry) RETURNS geometry AS 'SELECT (COALESCE($1::numeric, 0) + $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE AGGREGATE ST_Union(geometry) (SFUNC = st_union_sum, STYPE = geometry);
  CREATE FUNCTION ST_Area(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS 'SELECT least($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Contains(text, text) RETURNS boolean AS 'SELECT false' LANGUAGE sql;
  CREATE FUNCTION ST_Centroid(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_X(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Y(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_AsEWKB(geometry) RETURNS bytea AS 'SELECT decode($1::text, ''hex'')' LANGUAGE sql;
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
  CREATE TABLE carto.addresses_master (addresses_master_id int PRIMARY KEY, urn text, latitud numeric, longitud numeric);
  CREATE TABLE carto.access_point (gid serial PRIMARY KEY, id_padron int, geom geometry);
  CREATE TABLE carto.geog_ref (gid serial PRIMARY KEY, id_padron bigint, geog geography);
`;

/* Province 1: 100 UNCHANGED by staging (area 900, not an inserted id), 700 the SUBDIVIDED padron (area 1000, master 33) with parts
   701 (600), 702 (500) and 703 (40, below the 5 % rule). Province 3: 710 missing and unreferenced (deletable), 720 missing and with no
   part (ORPHAN: NOW_REFERENCED once referenced). Province 2: a new padron 704 (550) over nothing of province 1: never a receiver. */
const SEED_SQL = `
  INSERT INTO carto.province VALUES (1, 'MONTEVIDEO'), (2, 'CANELONES'), (3, 'ROCHA');
  INSERT INTO carto.loc VALUES (10, 'CENTRO', 1);
  INSERT INTO carto.addresses_master VALUES (33, 'cgeo:padron:id:700', 1.5, 2.5), (34, 'cgeo:padron:id:710', 3.5, 4.5);
  INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master) VALUES
    ('100', 'RURAL', NULL, 1, '900', NULL),
    ('700', 'URBANO', 10, 1, '1000', 33),
    ('710', 'RURAL', NULL, 3, '30', 34),
    ('720', 'RURAL', NULL, 3, '20', NULL);
  INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
    ('RURAL', 'MONTEVIDEO', NULL, 100, '900'),
    ('URBANO', 'Montevideo', 'centro', 701, '600'),
    ('URBANO', 'Montevideo', 'centro', 702, '500'),
    ('URBANO', 'Montevideo', 'centro', 703, '40'),
    ('RURAL', 'CANELONES', NULL, 704, '550');
`;

/* The nine rows that reference 700: each one's expected receiver is named in the test. */
const OLD_ID_SQL = "(SELECT id FROM carto.padron WHERE number = '700')";
const REFERENCE_ROWS_SQL = `
  INSERT INTO carto.access_point (id_padron, geom) VALUES
    (${OLD_ID_SQL}, '610'),
    (${OLD_ID_SQL}, '490'),
    (${OLD_ID_SQL}, '2000'),
    (${OLD_ID_SQL}, '550'),
    (${OLD_ID_SQL}, 'S:580'),
    (${OLD_ID_SQL}, '600'),
    (${OLD_ID_SQL}, '40'),
    (${OLD_ID_SQL}, 'W:-420'),
    (${OLD_ID_SQL}, '900');
`;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", [...Object.values(DESTINATION_COLUMN), "id_address_master"]),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf("carto", "addresses_master", Object.values(ADDRESS_MASTER_COLUMN)),
  srid: 0,
  idColumn: ADDRESS_MASTER_COLUMN.ID,
  idSequence: null,
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", Object.values(LOCALITY_COLUMN)),
  addressMaster: ADDRESS_MASTER,
};

const OPTIONS: ActualizarPadronOptions = {
  tolerance: 1,
  geometryAreaThreshold: 0.05,
  updateGeometries: true,
  linkAddressMaster: false,
  pairChoices: [],
};

const GENERATED_AT = "2026-10-30T12:00:00.000Z";

const sessionOn = (database: PGlite): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

async function openDatabase(extraSql = ""): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(POSTGIS_STUBS_SQL);
  await database.exec(SCHEMA_SQL);
  await database.exec(SEED_SQL);
  await database.exec(REFERENCE_ROWS_SQL);
  if (extraSql !== "") await database.exec(extraSql);
  return database;
}

const scanOf = async (database: PGlite, reassignAllowed = true): Promise<ReferenceScan> =>
  scanReferenceTables(sessionOn(database), "carto", "padron", reassignAllowed);

const idOfNumber = async (database: PGlite, number: string): Promise<number> =>
  Number((await database.query<{ id: number }>(`SELECT id FROM carto.padron WHERE number = '${number}'`)).rows[0].id);

const analysisOf = async (database: PGlite, scan: ReferenceScan): Promise<Row> =>
  (await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: true }))).rows[0];

const tempIdsOf = async (database: PGlite, table: string): Promise<number[]> =>
  (await database.query<{ id: number }>(`SELECT id FROM pg_temp.${table} ORDER BY id`)).rows.map((row) => Number(row.id));

const tempTableExists = async (database: PGlite, table: string): Promise<boolean> =>
  (await database.query<{ found: boolean }>(`SELECT to_regclass('pg_temp.${table}') IS NOT NULL AS found`)).rows[0].found;

interface RunRows {
  classification: Row;
  apply: Row;
  reassign: Row;
  deleted: Row;
}

/** The transaction body of the real run, left open: temp tables, persist classify, apply with the id store, reassign, delete. */
async function runInOpenTransaction(database: PGlite, scan: ReferenceScan): Promise<RunRows> {
  await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await database.query(buildCreateRevertTableSql());
  await database.exec(buildCreateDeleteIdsTableSql());
  await database.exec(buildCreateReassignIdsTableSql());
  const classification = (
    await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: false, persistDeletable: true }))
  ).rows[0];
  await database.query(buildSequenceRepairSql(TARGET));
  await database.exec(buildCreateInsertedIdsTableSql());
  const apply = (await database.query<Row>(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true, storeInsertedIds: true }))).rows[0];
  const reassign = (await database.query<Row>(buildPadronReassignSql(LAYOUTS, scan.tables))).rows[0];
  const deleted = (await database.query<Row>(buildPadronDeleteSql(LAYOUTS, scan.tables))).rows[0];
  return { classification, apply, reassign, deleted };
}

const accessPointOwners = async (database: PGlite): Promise<Array<{ geom: string; id_padron: number }>> =>
  (await database.query<{ geom: string; id_padron: number }>("SELECT geom, id_padron FROM carto.access_point ORDER BY gid")).rows.map(
    (row) => ({ geom: row.geom, id_padron: Number(row.id_padron) })
  );

describe("actualizar-padron reference scan facts on embedded Postgres (AP-110, AP-114)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
    await database.exec(`
      CREATE TABLE carto.no_pk (id_padron int, geom geometry);
      CREATE TABLE carto.composite_pk (a int, b int, id_padron int, geom geometry, PRIMARY KEY (a, b));
      CREATE TABLE carto.two_geoms (gid serial PRIMARY KEY, id_padron int, g1 geometry, g2 geometry);
      CREATE TABLE carto.no_geom (gid serial PRIMARY KEY, id_padron int);
      CREATE TABLE carto.text_ref (gid serial PRIMARY KEY, id_padron text, geom geometry);
    `);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should read one primary key, one geometry column and the privilege of a plain table as a reassign target", async () => {
    const scan = await scanOf(database);

    const accessPoint = scan.tables.find((table) => table.table === "access_point");
    expect(accessPoint).toEqual({
      schema: "carto",
      table: "access_point",
      reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false },
    });
    expect(scan.blockedReason).toBeNull();
  });

  it("should flag a geography column", async () => {
    const scan = await scanOf(database);

    expect(scan.tables.find((table) => table.table === "geog_ref")?.reassign).toEqual({
      pkColumn: "gid",
      geometryColumn: "geog",
      geography: true,
    });
  });

  it("should name the blocker of a table without a primary key, with a composite key, with two or with no geometry column", async () => {
    const scan = await scanOf(database);
    const blockerOf = (table: string): string | undefined => scan.tables.find((entry) => entry.table === table)?.reassignBlocker;

    expect(blockerOf("no_pk")).toBe("sin clave primaria de una sola columna");
    expect(blockerOf("composite_pk")).toBe("sin clave primaria de una sola columna");
    expect(blockerOf("two_geoms")).toBe("sin una única columna de geometría");
    expect(blockerOf("no_geom")).toBe("sin una única columna de geometría");
  });

  it("should leave out a table whose id_padron column is not numeric", async () => {
    const scan = await scanOf(database);

    expect(scan.tables.map((table) => table.table)).not.toContain("text_ref");
  });

  it("should give every table the no-address-master blocker when reassignAllowed is false", async () => {
    const scan = await scanOf(database, false);

    expect(scan.tables.length).toBeGreaterThan(0);
    for (const table of scan.tables) {
      expect(table.reassign).toBeUndefined();
      expect(table.reassignBlocker).toBe("no hay tabla de direcciones maestras");
    }
  });

  it("should report a table the role may read but not update as having no update privilege", async () => {
    await database.exec(`
      CREATE ROLE reader NOLOGIN;
      GRANT USAGE ON SCHEMA carto TO reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA carto TO reader;
      GRANT UPDATE (id_padron) ON carto.geog_ref TO reader;
      SET ROLE reader;
    `);

    const scan = await scanOf(database);
    await database.exec("RESET ROLE");

    const byName = (table: string) => scan.tables.find((entry) => entry.table === table);
    expect(byName("access_point")?.reassignBlocker).toBe("sin permiso para actualizar id_padron");
    expect(byName("geog_ref")?.reassign).toBeDefined();
    expect(scan.blockedReason).toBeNull();
  });
});

describe("actualizar-padron classification of a subdivided padron on embedded Postgres (AP-109, AP-112)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await openDatabase();
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should reassign the subdivided padron and count its rows, padron and rows per table, deleting the unreferenced ones outright", async () => {
    const scan = await scanOf(database);

    const counts = toPadronClassification(await analysisOf(database, scan)).counts;

    expect(counts.reassigned).toBe(9);
    expect(counts.subdividedDeleted).toBe(1);
    expect(counts.reassignedByTable).toEqual({ "carto.access_point": 9 });
    expect(counts.removed).toBe(3);
    expect(counts.removalsSkipped.byReason).toEqual({ STILL_PAIRABLE: 0, NOW_REFERENCED: 0, NOT_REASSIGNABLE: 0, UNVERIFIED: 0 });
  });

  it("should give the subdivided padron a null reason and its reference count, and the orphan the NOW_REFERENCED reason", async () => {
    await database.exec(`INSERT INTO carto.access_point (id_padron, geom) VALUES (${await idOfNumber(database, "720")}, '1');`);
    const scan = await scanOf(database);

    const review = toPadronClassification(await analysisOf(database, scan)).missingReview;
    const subdivided = review.find((entry) => entry.oldId === 2);
    const orphan = review.find((entry) => entry.oldId === 4);

    expect(await idOfNumber(database, "700")).toBe(2);
    expect(await idOfNumber(database, "720")).toBe(4);
    expect(subdivided?.class).toBe("SUBDIVIDED");
    expect(subdivided?.removalReason).toBeNull();
    expect(subdivided?.refs?.total).toBe(9);
    expect(orphan?.removalReason).toBe("NOW_REFERENCED");
  });

  it("should return identical numbers and digest in the analysis and in the persist classify, and write only the temp tables in the latter", async () => {
    const scan = await scanOf(database);
    const analysis = await analysisOf(database, scan);
    const readOnlyTables = [await tempTableExists(database, "padron_delete_ids"), await tempTableExists(database, "padron_reassign_ids")];

    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.exec(buildCreateDeleteIdsTableSql());
    await database.exec(buildCreateReassignIdsTableSql());
    const persist = (
      await database.query<Row>(buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: false, persistDeletable: true }))
    ).rows[0];
    const reassignIds = await tempIdsOf(database, "padron_reassign_ids");
    const deleteIds = await tempIdsOf(database, "padron_delete_ids");
    await database.exec("ROLLBACK");

    for (const key of ["removed", "reassigned", "subdivided_deleted", "removals_skipped_not_reassignable", "plan_digest"]) {
      expect(String(persist[key]), key).toBe(String(analysis[key]));
    }
    expect(readOnlyTables).toEqual([false, false]);
    expect(reassignIds).toEqual([await idOfNumber(database, "700")]);
    expect(deleteIds).toEqual([await idOfNumber(database, "710"), await idOfNumber(database, "720")]);
  });

  it("should run the analysis in a READ ONLY transaction and leave the data untouched", async () => {
    const scan = await scanOf(database);
    const before = (await database.query("SELECT * FROM carto.access_point ORDER BY gid")).rows;

    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const row = await analysisOf(database, scan);
    await database.exec("ROLLBACK");

    expect(Number(row.reassigned)).toBe(9);
    expect((await database.query("SELECT * FROM carto.access_point ORDER BY gid")).rows).toEqual(before);
  });

  it("should change the digest when the references of a reassigned padron change count per table, even if the totals match", async () => {
    const scan = await scanOf(database);
    const digestBefore = String((await analysisOf(database, scan)).plan_digest);

    await database.exec("DELETE FROM carto.access_point WHERE geom = '610'");
    await database.exec(`INSERT INTO carto.geog_ref (id_padron, geog) VALUES (${await idOfNumber(database, "700")}, '610');`);
    const digestAfter = String((await analysisOf(database, scan)).plan_digest);

    expect(digestAfter).not.toBe(digestBefore);
  });

  it("should keep a subdivided padron with a table that cannot be reassigned as NOT_REASSIGNABLE, naming the table and the reason", async () => {
    await database.exec(`
      CREATE TABLE carto.no_pk (id_padron int, geom geometry);
      INSERT INTO carto.no_pk VALUES (${await idOfNumber(database, "700")}, '1');
    `);
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const entry = classification.missingReview.find((review) => review.class === "SUBDIVIDED");

    expect(entry?.removalReason).toBe("NOT_REASSIGNABLE");
    expect(entry?.reassignBlockers).toEqual({ "carto.no_pk": "sin clave primaria de una sola columna" });
    expect(classification.counts.reassigned).toBe(0);
    expect(classification.counts.subdividedDeleted).toBe(0);
    expect(classification.counts.removalsSkipped.byReason.NOT_REASSIGNABLE).toBe(1);
  });

  it("should not let a table that cannot be reassigned block a padron it holds no row of", async () => {
    await database.exec("CREATE TABLE carto.no_pk (id_padron int, geom geometry);");
    await database.exec(`INSERT INTO carto.no_pk VALUES (${await idOfNumber(database, "720")}, '1');`);
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const subdivided = classification.missingReview.find((review) => review.class === "SUBDIVIDED");
    const orphan = classification.missingReview.find((review) => review.number === "720");

    expect(subdivided?.removalReason).toBeNull();
    expect(subdivided?.reassignBlockers).toEqual({});
    expect(classification.counts.reassigned).toBe(9);
    expect(orphan?.removalReason).toBe("NOW_REFERENCED");
  });

  it.each([
    ["NULL", "NULL"],
    ["empty", "''"],
  ])("should still reassign the padron, counting the row without a point, when a referencing row has a %s geometry (AP-111)", async (_label, value) => {
    await database.exec(`INSERT INTO carto.access_point (id_padron, geom) VALUES (${await idOfNumber(database, "700")}, ${value});`);
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const entry = classification.missingReview.find((review) => review.class === "SUBDIVIDED");

    expect(entry?.removalReason).toBeNull();
    expect(entry?.reassignBlockers).toEqual({});
    expect(classification.counts.reassigned).toBe(10);
    expect(classification.counts.reassignedWithoutPoint).toBe(1);
    expect(classification.counts.removalsSkipped.byReason.NOT_REASSIGNABLE).toBe(0);
  });

  it("should count no row without a point when every referencing row has one", async () => {
    const scan = await scanOf(database);

    const counts = toPadronClassification(await analysisOf(database, scan)).counts;

    expect(counts.reassignedWithoutPoint).toBe(0);
  });

  it("should keep the padron as NOT_REASSIGNABLE for every table when no address master table is defined (reassignAllowed false)", async () => {
    const scan = await scanOf(database, false);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const entry = classification.missingReview.find((review) => review.class === "SUBDIVIDED");

    expect(entry?.removalReason).toBe("NOT_REASSIGNABLE");
    expect(entry?.reassignBlockers?.["carto.access_point"]).toBe("no hay tabla de direcciones maestras");
    expect(classification.counts.reassigned).toBe(0);
  });

  it("should still delete the unreferenced missing padron when no address master table is defined", async () => {
    const scan = await scanOf(database, false);

    const classification = toPadronClassification(await analysisOf(database, scan));

    expect(classification.counts.removed).toBe(2);
    expect(classification.removedList.map((removed) => removed.number).sort()).toEqual(["710", "720"]);
  });

  it("should never reassign when the scan is blocked: the referenced subdivided padron is kept, the unreferenced ones are UNVERIFIED", async () => {
    const classification = toPadronClassification(await analysisOf(database, NO_REFERENCE_SCAN));

    expect(classification.counts.reassigned).toBe(0);
    expect(classification.counts.subdividedDeleted).toBe(0);
    expect(classification.counts.removed).toBe(0);
    expect(classification.counts.removalsSkipped.byReason.UNVERIFIED).toBe(3);
    expect(classification.counts.removalsSkipped.byReason.NOT_REASSIGNABLE).toBe(0);
  });

  it("should not reassign a padron the scan marks reassignable only for the unreadable part: an unreadable table blocks the whole deletion", async () => {
    const scan = referenceScanOf([
      { schema: "carto", table: "access_point", readable: true, updatable: true, primaryKeyColumns: 1, primaryKeyColumn: "gid", geometryColumns: 1, geometryColumn: "geom", geometryType: "geometry" },
      { schema: "carto", table: "secret", readable: false },
    ]);

    const counts = toPadronClassification(await analysisOf(database, scan)).counts;

    expect(counts.reassigned).toBe(0);
    expect(counts.removed).toBe(0);
  });
});

describe("actualizar-padron real run: reassign, delete and master delete on embedded Postgres (AP-111, AP-113, AP-114)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await openDatabase();
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should store the inserted ids of the apply in the session temp table, receivers included", async () => {
    const scan = await scanOf(database);

    await runInOpenTransaction(database, scan);
    const inserted = await tempIdsOf(database, "padron_inserted_ids");
    await database.exec("COMMIT");

    const numbers = (
      await database.query<{ number: string }>(`SELECT number FROM carto.padron WHERE id = ANY($1::int[]) ORDER BY number`, [inserted])
    ).rows.map((row) => row.number);
    expect(numbers).toEqual(["701", "702", "703", "704"]);
  });

  it("should move each referencing row to its nearest receiver: contained, outside any part, equidistant and polygon rows", async () => {
    const scan = await scanOf(database);
    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const owners = await accessPointOwners(database);
    const idOf = async (number: string): Promise<number> => idOfNumber(database, number);
    const part600 = await idOf("701");
    const part500 = await idOf("702");
    const lowestPart = Math.min(part600, part500);
    const ownerOf = (geom: string): number | undefined => owners.find((owner) => owner.geom === geom)?.id_padron;

    expect(Number(run.reassign.moved)).toBe(9);
    expect(ownerOf("600")).toBe(part600);
    expect(ownerOf("610")).toBe(part600);
    expect(ownerOf("490")).toBe(part500);
    expect(ownerOf("2000")).toBe(part600);
    expect(ownerOf("550")).toBe(lowestPart);
    expect(ownerOf("S:580")).toBe(part600);
  });

  it("should never use the sliver below the 5 % rule, a padron of another province or an existing padron as a receiver", async () => {
    const scan = await scanOf(database);
    await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const owners = await accessPointOwners(database);
    const part500 = await idOfNumber(database, "702");
    const part600 = await idOfNumber(database, "701");

    expect(owners.find((owner) => owner.geom === "40")?.id_padron).toBe(part500);
    expect(owners.find((owner) => owner.geom === "900")?.id_padron).toBe(part600);
    expect(owners.map((owner) => owner.id_padron).sort()).not.toContain(await idOfNumber(database, "703"));
    expect(owners.map((owner) => owner.id_padron)).not.toContain(await idOfNumber(database, "704"));
    expect(owners.map((owner) => owner.id_padron)).not.toContain(await idOfNumber(database, "100"));
  });

  it("should move a point in another SRID to the destination SRID before measuring the distance", async () => {
    const scan = await scanOf(database);
    await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const owners = await accessPointOwners(database);

    expect(owners.find((owner) => owner.geom === "W:-420")?.id_padron).toBe(await idOfNumber(database, "701"));
  });

  it("should move a row with a NULL or empty own geometry to the largest-cover part and count it as without a point (AP-111)", async () => {
    await database.exec("DELETE FROM carto.access_point");
    await database.exec(`INSERT INTO carto.access_point (id_padron, geom) VALUES (${await idOfNumber(database, "700")}, NULL), (${await idOfNumber(database, "700")}, '');`);
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const owners = await accessPointOwners(database);
    expect(Number(run.reassign.moved)).toBe(2);
    expect(Number(run.reassign.without_point)).toBe(2);
    expect(owners.map((owner) => owner.id_padron)).toEqual([await idOfNumber(database, "701"), await idOfNumber(database, "701")]);
  });

  it("should report zero without_point when every moved row has a point", async () => {
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    expect(Number(run.reassign.without_point)).toBe(0);
  });

  it("should read a geography column as a geometry when it picks the nearest part", async () => {
    await database.exec("DELETE FROM carto.access_point");
    await database.exec(`INSERT INTO carto.geog_ref (id_padron, geog) VALUES (${await idOfNumber(database, "700")}, '490');`);
    const scan = await scanOf(database);

    await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const owner = Number((await database.query<{ id_padron: number }>("SELECT id_padron FROM carto.geog_ref")).rows[0].id_padron);
    expect(owner).toBe(await idOfNumber(database, "702"));
  });

  it("should leave every reference at zero for the old padron, delete it and hand it to the delete ids", async () => {
    const scan = await scanOf(database);
    const old = await idOfNumber(database, "700");
    const others = [await idOfNumber(database, "710"), await idOfNumber(database, "720")];

    const run = await runInOpenTransaction(database, scan);
    const deleteIds = await tempIdsOf(database, "padron_delete_ids");
    await database.exec("COMMIT");

    expect(Number(run.reassign.padrones)).toBe(1);
    expect(deleteIds).toEqual([old, ...others].sort((a, b) => a - b));
    expect(Number(run.deleted.surviving)).toBe(3);
    expect(Number(run.deleted.deleted)).toBe(3);
    expect((await database.query("SELECT 1 FROM carto.padron WHERE number = '700'")).rows).toHaveLength(0);
    expect((await accessPointOwners(database)).some((owner) => owner.id_padron === old)).toBe(false);
  });

  it("should report the moved rows per table and the revert rows written, one per moved row", async () => {
    await database.exec(`INSERT INTO carto.geog_ref (id_padron, geog) VALUES (${await idOfNumber(database, "700")}, '510');`);
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    const revertR = (await database.query<Row>(`SELECT * FROM ${REVERT_TABLE_SQL} WHERE kind = 'R' ORDER BY seq`)).rows;
    await database.exec("COMMIT");

    expect(Number(run.reassign.moved)).toBe(10);
    expect(run.reassign.by_table).toEqual({ "carto.access_point": 9, "carto.geog_ref": 1 });
    expect(Number(run.reassign.revert_rows)).toBe(10);
    expect(revertR).toHaveLength(10);
  });

  it("should capture kind R with the table, the primary key column and value, and the old id_padron in id", async () => {
    const scan = await scanOf(database);
    const old = await idOfNumber(database, "700");

    await runInOpenTransaction(database, scan);
    const revertR = (await database.query<Row>(`SELECT * FROM ${REVERT_TABLE_SQL} WHERE kind = 'R' ORDER BY seq`)).rows;
    await database.exec("COMMIT");

    const keys = revertR.map((row) => String(row.ref_key)).sort((a, b) => Number(a) - Number(b));
    expect(revertR.every((row) => Number(row.id) === old)).toBe(true);
    expect(revertR.every((row) => row.ref_table === '"carto"."access_point"' && row.ref_key_column === "gid")).toBe(true);
    expect(keys).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(new Set(revertR.map((row) => Number(row.seq))).size).toBe(9);
  });

  it("should delete the address master row of each deleted padron and capture it as kind M with its jsonb payload", async () => {
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    const revertM = (await database.query<Row>(`SELECT id, payload FROM ${REVERT_TABLE_SQL} WHERE kind = 'M' ORDER BY id`)).rows;
    await database.exec("COMMIT");

    const masters = (await database.query<{ addresses_master_id: number }>("SELECT addresses_master_id FROM carto.addresses_master")).rows;
    expect(Number(run.deleted.master_deleted)).toBe(2);
    expect(Number(run.deleted.master_revert_rows)).toBe(2);
    expect(masters).toEqual([]);
    expect(revertM.map((row) => Number(row.id))).toEqual([33, 34]);
    expect(revertM[0].payload).toEqual({ addresses_master_id: 33, urn: "cgeo:padron:id:700", latitud: 1.5, longitud: 2.5 });
  });

  it("should keep the address master row when another destination row still carries its id", async () => {
    await database.exec("UPDATE carto.padron SET id_address_master = 33 WHERE number = '100'");
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const masters = (await database.query<{ addresses_master_id: number }>("SELECT addresses_master_id FROM carto.addresses_master")).rows;
    expect(Number(run.deleted.master_deleted)).toBe(1);
    expect(masters.map((row) => Number(row.addresses_master_id))).toEqual([33]);
  });

  it("should fail the statement, and leave the data to the rollback, when a foreign key still points to the master row", async () => {
    await database.exec(`
      CREATE TABLE carto.master_user (id serial PRIMARY KEY, master_id int REFERENCES carto.addresses_master (addresses_master_id));
      INSERT INTO carto.master_user (master_id) VALUES (33);
    `);
    const scan = await scanOf(database);

    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    await database.exec(buildCreateDeleteIdsTableSql());
    await database.exec(buildCreateReassignIdsTableSql());
    await database.query(buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: false, persistDeletable: true }));
    await database.exec(buildCreateInsertedIdsTableSql());
    await database.query(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true, storeInsertedIds: true }));
    await database.query(buildPadronReassignSql(LAYOUTS, scan.tables));
    await expect(database.query(buildPadronDeleteSql(LAYOUTS, scan.tables))).rejects.toThrow(/foreign key|violates/i);
    await database.exec("ROLLBACK");

    expect((await database.query("SELECT 1 FROM carto.padron WHERE number = '700'")).rows).toHaveLength(1);
    expect((await accessPointOwners(database)).every((owner) => owner.id_padron === 2)).toBe(true);
  });

  it("should leave the destination, the references and the masters as they were when the transaction rolls back", async () => {
    const scan = await scanOf(database);
    const padronBefore = (await database.query("SELECT * FROM carto.padron ORDER BY id")).rows;
    const ownersBefore = await accessPointOwners(database);
    const mastersBefore = (await database.query("SELECT * FROM carto.addresses_master ORDER BY 1")).rows;

    await runInOpenTransaction(database, scan);
    await database.exec("ROLLBACK");

    expect((await database.query("SELECT * FROM carto.padron ORDER BY id")).rows).toEqual(padronBefore);
    expect(await accessPointOwners(database)).toEqual(ownersBefore);
    expect((await database.query("SELECT * FROM carto.addresses_master ORDER BY 1")).rows).toEqual(mastersBefore);
    expect(await tempTableExists(database, "padron_inserted_ids")).toBe(false);
    expect(await tempTableExists(database, "padron_reassign_ids")).toBe(false);
  });

  it("should leave the references of the old padron when it has no receiver, moving zero rows so the caller's count check fails", async () => {
    const scan = await scanOf(database);
    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    await database.exec(buildCreateDeleteIdsTableSql());
    await database.exec(buildCreateReassignIdsTableSql());
    await database.query(buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: false, persistDeletable: true }));
    await database.exec(buildCreateInsertedIdsTableSql());

    const reassign = (await database.query<Row>(buildPadronReassignSql(LAYOUTS, scan.tables))).rows[0];
    await database.exec("ROLLBACK");

    expect(Number(reassign.moved)).toBe(0);
    expect(Number(reassign.revert_rows)).toBe(0);
  });

  it("should move nothing, capture nothing and report no table when the reference list is empty", async () => {
    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    await database.exec(buildCreateReassignIdsTableSql());
    await database.exec(buildCreateInsertedIdsTableSql());
    await database.exec(`INSERT INTO pg_temp.padron_reassign_ids (id) VALUES (2);`);
    await database.exec(buildCreateDeleteIdsTableSql());

    const reassign = (await database.query<Row>(buildPadronReassignSql(LAYOUTS, []))).rows[0];
    await database.exec("ROLLBACK");

    expect(Number(reassign.moved)).toBe(0);
    expect(reassign.by_table).toEqual({});
    expect(Number(reassign.padrones)).toBe(1);
    expect(Number(reassign.revert_rows)).toBe(0);
  });

  it("should not touch a table the scan marked as not reassignable", async () => {
    const reference = referenceScanOf([
      { schema: "carto", table: "access_point", readable: true, updatable: true, primaryKeyColumns: 1, primaryKeyColumn: "gid", geometryColumns: 1, geometryColumn: "geom", geometryType: "geometry" },
      { schema: "carto", table: "geog_ref", readable: true },
    ]);
    await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await database.query(buildCreateRevertTableSql());
    await database.exec(buildCreateReassignIdsTableSql());
    await database.exec(buildCreateInsertedIdsTableSql());
    await database.exec(buildCreateDeleteIdsTableSql());

    const reassign = (await database.query<Row>(buildPadronReassignSql(LAYOUTS, reference.tables))).rows[0];
    await database.exec("ROLLBACK");

    expect(reassign.by_table).toEqual({ "carto.access_point": 0 });
  });
});

describe("actualizar-padron revert of a reassignment and master delete on embedded Postgres (AP-72, AP-113, AP-114)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await openDatabase();
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  async function snapshotOf(): Promise<{ padron: Row[]; owners: Row[]; masters: Row[] }> {
    return {
      padron: (await database.query<Row>("SELECT * FROM carto.padron WHERE number IN ('100', '700', '710', '720') ORDER BY number")).rows,
      owners: (await database.query<Row>("SELECT * FROM carto.access_point ORDER BY gid")).rows,
      masters: (await database.query<Row>("SELECT * FROM carto.addresses_master ORDER BY 1")).rows,
    };
  }

  async function revertScriptOf(scan: ReferenceScan): Promise<{ lines: string[]; counts: Awaited<ReturnType<typeof readRevertCounts>> }> {
    const session = sessionOn(database);
    await runInOpenTransaction(database, scan);
    const counts = await readRevertCounts(session);
    const lines: string[] = [];
    for await (const line of revertScriptLines(session, {
      target: TARGET,
      addressMaster: { layout: ADDRESS_MASTER, maxIdBefore: 34 },
      counts,
      generatedAt: GENERATED_AT,
    })) {
      lines.push(line.text);
    }
    await database.exec("COMMIT");
    return { lines, counts };
  }

  it("should count the R and M revert rows the run wrote", async () => {
    const { counts } = await revertScriptOf(await scanOf(database));

    expect(counts).toMatchObject({ I: 4, D: 3, R: 9, M: 2 });
  });

  it("should restore the padron, the references and the address master rows exactly when the revert script runs after the real run", async () => {
    const before = await snapshotOf();
    const { lines } = await revertScriptOf(await scanOf(database));

    await database.exec(lines.join("\n"));
    const after = await snapshotOf();

    expect(after).toEqual(before);
  });

  it("should order the script M, then D, then R, after the inserted rows' deletion", async () => {
    const { lines } = await revertScriptOf(await scanOf(database));

    const firstOf = (predicate: (line: string) => boolean): number => lines.findIndex(predicate);
    const insertedDelete = firstOf((line) => line.startsWith('DELETE FROM "carto"."padron"'));
    const masterInsert = firstOf((line) => line.startsWith('INSERT INTO "carto"."addresses_master" SELECT * FROM jsonb_populate_record'));
    const padronInsert = firstOf((line) => line.startsWith('INSERT INTO "carto"."padron"'));
    const reassignedUpdate = firstOf((line) => line.startsWith('UPDATE "carto"."access_point" SET "id_padron"'));

    expect(insertedDelete).toBeGreaterThan(-1);
    expect(masterInsert).toBeGreaterThan(insertedDelete);
    expect(padronInsert).toBeGreaterThan(masterInsert);
    expect(reassignedUpdate).toBeGreaterThan(padronInsert);
    expect(lines.filter((line) => line.startsWith('UPDATE "carto"."access_point" SET "id_padron"'))).toHaveLength(9);
    expect(lines.filter((line) => line.includes("jsonb_populate_record"))).toHaveLength(2);
    expect(lines[lines.length - 1]).toBe("COMMIT;");
  });

  it("should write the whole master row from its jsonb copy with its original id and no placeholder", async () => {
    const { lines } = await revertScriptOf(await scanOf(database));

    const masterLine = lines.find((line) => line.includes("jsonb_populate_record") && line.includes("33"));
    expect(masterLine).toContain("cgeo:padron:id:700");
    expect(masterLine).toContain('"addresses_master_id": 33');
  });

  it("should page R and M rows by their own sequence, so rows that share an id are all written", async () => {
    const session = sessionOn(database);
    await database.exec("BEGIN");
    await database.exec(buildCreateRevertTableSql());
    await database.exec(`
      INSERT INTO ${REVERT_TABLE_SQL} (kind, id, ref_table, ref_key_column, ref_key)
        SELECT 'R', 7, '"carto"."access_point"', 'gid', g::text FROM generate_series(1, 5003) AS g;
    `);
    const counts = await readRevertCounts(session);
    const lines: string[] = [];
    for await (const line of revertScriptLines(session, { target: TARGET, counts, generatedAt: GENERATED_AT })) lines.push(line.text);
    await database.exec("ROLLBACK");

    const updates = lines.filter((line) => line.startsWith('UPDATE "carto"."access_point"'));
    expect(counts.R).toBe(5003);
    expect(updates).toHaveLength(5003);
    expect(new Set(updates).size).toBe(5003);
  });
});

/* access_point has no geometry of its own: its point is address.geometry, joined address.id = access_point.id (no foreign key, a shared id).
   Parts: 701 (area 500) and 702 (area 600), so the largest-cover part (702) is not the lowest id (701), and 703 (40) is below the 5 % rule. */
const COMPANION_SCHEMA_SQL = `
  DROP TABLE carto.access_point;
  CREATE TABLE carto.access_point (id int PRIMARY KEY, id_padron int);
  CREATE TABLE carto.address (id int PRIMARY KEY, geometry geometry);
`;

const COMPANION_STAGING_SQL = `
  UPDATE stg.padron_staging SET geom = '500' WHERE padron = 701;
  UPDATE stg.padron_staging SET geom = '600' WHERE padron = 702;
`;

const COMPANION_ROWS_SQL = `
  INSERT INTO carto.address (id, geometry) VALUES (1, '510'), (2, '590'), (3, '5000'), (5, NULL), (6, ''), (7, 'S:505');
  INSERT INTO carto.access_point (id, id_padron) VALUES
    (1, ${OLD_ID_SQL}), (2, ${OLD_ID_SQL}), (3, ${OLD_ID_SQL}), (4, ${OLD_ID_SQL}), (5, ${OLD_ID_SQL}), (6, ${OLD_ID_SQL}), (7, ${OLD_ID_SQL});
`;

async function openCompanionDatabase(extraSql = ""): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(POSTGIS_STUBS_SQL);
  await database.exec(SCHEMA_SQL);
  await database.exec(SEED_SQL);
  await database.exec(COMPANION_SCHEMA_SQL);
  await database.exec(COMPANION_STAGING_SQL);
  await database.exec(COMPANION_ROWS_SQL);
  if (extraSql !== "") await database.exec(extraSql);
  return database;
}

const companionOwners = async (database: PGlite): Promise<Map<number, number>> =>
  new Map(
    (await database.query<{ id: number; id_padron: number }>("SELECT id, id_padron FROM carto.access_point ORDER BY id")).rows.map((row) => [
      Number(row.id),
      Number(row.id_padron),
    ])
  );

describe("actualizar-padron companion point source scan facts on embedded Postgres (AP-110)", () => {
  let database: PGlite;

  afterEach(async () => {
    await database.close();
  });

  const accessPointOf = async (db: PGlite) => (await scanOf(db)).tables.find((table) => table.table === "access_point");

  it("should accept access_point with its address companion as a reassign target with the companion's geometry", async () => {
    database = await openCompanionDatabase();

    const table = await accessPointOf(database);

    expect(table).toEqual({
      schema: "carto",
      table: "access_point",
      reassign: {
        pkColumn: "id",
        geometryColumn: "geometry",
        geography: false,
        companion: { schema: "carto", table: "address", column: "id", companionColumn: "id" },
      },
    });
  }, SETUP_TIMEOUT_MS);

  it("should flag a geography companion column", async () => {
    database = await openCompanionDatabase("ALTER TABLE carto.address DROP COLUMN geometry; ALTER TABLE carto.address ADD COLUMN geog geography;");

    const table = await accessPointOf(database);

    expect(table?.reassign).toMatchObject({ geometryColumn: "geog", geography: true });
  }, SETUP_TIMEOUT_MS);

  it.each([
    ["the companion table does not exist", "DROP TABLE carto.address;"],
    ["the companion has no geometry column", "ALTER TABLE carto.address DROP COLUMN geometry;"],
    ["the companion has two geometry columns", "ALTER TABLE carto.address ADD COLUMN other geometry;"],
    ["the companion has no primary key", "ALTER TABLE carto.address DROP CONSTRAINT address_pkey;"],
    [
      "the companion primary key is not the join column",
      "ALTER TABLE carto.address DROP CONSTRAINT address_pkey; ALTER TABLE carto.address ADD COLUMN uid serial PRIMARY KEY;",
    ],
    [
      "the companion primary key is composite",
      "ALTER TABLE carto.address DROP CONSTRAINT address_pkey; ALTER TABLE carto.address ADD COLUMN uid int NOT NULL DEFAULT 0; ALTER TABLE carto.address ADD PRIMARY KEY (id, uid);",
    ],
    [
      "the companion join column is missing",
      "ALTER TABLE carto.address DROP CONSTRAINT address_pkey; ALTER TABLE carto.address RENAME COLUMN id TO other_id; ALTER TABLE carto.address ADD PRIMARY KEY (other_id);",
    ],
  ])("should block access_point as having no single geometry when %s", async (_label, sql) => {
    database = await openCompanionDatabase(sql);

    const table = await accessPointOf(database);

    expect(table?.reassign).toBeUndefined();
    expect(table?.reassignBlocker).toBe("sin una única columna de geometría");
  }, SETUP_TIMEOUT_MS);

  it("should block access_point when the role cannot read the companion, without blocking the whole scan", async () => {
    database = await openCompanionDatabase(`
      CREATE ROLE reader NOLOGIN;
      GRANT USAGE ON SCHEMA carto TO reader;
      GRANT SELECT ON carto.access_point, carto.padron TO reader;
      GRANT UPDATE (id_padron) ON carto.access_point TO reader;
      SET ROLE reader;
    `);

    const scan = await scanOf(database);
    await database.exec("RESET ROLE");

    const table = scan.tables.find((entry) => entry.table === "access_point");
    expect(table?.reassign).toBeUndefined();
    expect(table?.reassignBlocker).toBe("sin una única columna de geometría");
  }, SETUP_TIMEOUT_MS);

  it("should not give a table of another name a companion even if an address table exists", async () => {
    database = await openCompanionDatabase("CREATE TABLE carto.other_ref (id int PRIMARY KEY, id_padron int);");

    const scan = await scanOf(database);

    expect(scan.tables.find((entry) => entry.table === "other_ref")?.reassignBlocker).toBe("sin una única columna de geometría");
  }, SETUP_TIMEOUT_MS);

  it("should prefer the table's own geometry column when access_point also has one", async () => {
    database = await openCompanionDatabase("ALTER TABLE carto.access_point ADD COLUMN geom geometry;");

    const table = await accessPointOf(database);

    expect(table?.reassign).toEqual({ pkColumn: "id", geometryColumn: "geom", geography: false });
  }, SETUP_TIMEOUT_MS);
});

describe("actualizar-padron companion point source classification and real run on embedded Postgres (AP-110, AP-111)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await openCompanionDatabase();
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  it("should plan the reassignment of every row, counting the ones with no address row, NULL or empty point as without a point", async () => {
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const entry = classification.missingReview.find((review) => review.class === "SUBDIVIDED");

    expect(entry?.removalReason).toBeNull();
    expect(entry?.reassignBlockers).toEqual({});
    expect(classification.counts.reassigned).toBe(7);
    expect(classification.counts.reassignedWithoutPoint).toBe(3);
    expect(classification.counts.reassignedByTable).toEqual({ "carto.access_point": 7 });
    expect(classification.counts.removalsSkipped.byReason.NOT_REASSIGNABLE).toBe(0);
  });

  it("should move a contained point and an outside point to the nearest part", async () => {
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const part500 = await idOfNumber(database, "701");
    const part600 = await idOfNumber(database, "702");
    const owners = await companionOwners(database);
    expect(part600).toBeGreaterThan(part500);
    expect(Number(run.reassign.moved)).toBe(7);
    expect(run.reassign.by_table).toEqual({ "carto.access_point": 7, "carto.geog_ref": 0 });
    expect(owners.get(1)).toBe(part500);
    expect(owners.get(2)).toBe(part600);
    expect(owners.get(3)).toBe(part600);
    expect(owners.get(7)).toBe(part500);
  });

  it("should send an access_point with NO address row, a NULL address geometry and an empty one to the largest-cover part, never the lowest id", async () => {
    const scan = await scanOf(database);

    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const part600 = await idOfNumber(database, "702");
    const owners = await companionOwners(database);
    expect(Number(run.reassign.without_point)).toBe(3);
    expect(owners.get(4)).toBe(part600);
    expect(owners.get(5)).toBe(part600);
    expect(owners.get(6)).toBe(part600);
  });

  it("should never use the sliver below the 5 % rule as a receiver and leave no row on the deleted padron", async () => {
    const scan = await scanOf(database);
    const old = await idOfNumber(database, "700");

    const run = await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    const owners = [...(await companionOwners(database)).values()];
    expect(owners).not.toContain(await idOfNumber(database, "703"));
    expect(owners).not.toContain(old);
    expect(Number(run.reassign.padrones)).toBe(1);
    expect(Number(run.deleted.deleted)).toBe(3);
    expect((await database.query("SELECT 1 FROM carto.padron WHERE number = '700'")).rows).toHaveLength(0);
  });

  it("should keep the address table untouched and capture one kind R row per moved access_point keyed by its primary key", async () => {
    const scan = await scanOf(database);
    const old = await idOfNumber(database, "700");
    const before = (await database.query("SELECT * FROM carto.address ORDER BY id")).rows;

    await runInOpenTransaction(database, scan);
    const revertR = (await database.query<Row>(`SELECT * FROM ${REVERT_TABLE_SQL} WHERE kind = 'R' ORDER BY seq`)).rows;
    await database.exec("COMMIT");

    expect((await database.query("SELECT * FROM carto.address ORDER BY id")).rows).toEqual(before);
    expect(revertR).toHaveLength(7);
    expect(revertR.every((row) => Number(row.id) === old && row.ref_table === '"carto"."access_point"' && row.ref_key_column === "id")).toBe(true);
    expect(revertR.map((row) => String(row.ref_key)).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("should keep the access_point row count through the join", async () => {
    const scan = await scanOf(database);

    await runInOpenTransaction(database, scan);
    await database.exec("COMMIT");

    expect((await database.query<{ n: number }>("SELECT count(*)::int AS n FROM carto.access_point")).rows[0].n).toBe(7);
  });

  it("should keep a padron whose table has no point source NOT_REASSIGNABLE, naming that table only", async () => {
    await database.exec(`
      CREATE TABLE carto.no_source (gid serial PRIMARY KEY, id_padron int);
      INSERT INTO carto.no_source (id_padron) VALUES (${await idOfNumber(database, "700")});
    `);
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const entry = classification.missingReview.find((review) => review.class === "SUBDIVIDED");

    expect(entry?.removalReason).toBe("NOT_REASSIGNABLE");
    expect(entry?.reassignBlockers).toEqual({ "carto.no_source": "sin una única columna de geometría" });
    expect(classification.counts.reassigned).toBe(0);
    expect(classification.counts.removalsSkipped.byReason.NOT_REASSIGNABLE).toBe(1);
  });

  it("should not let a table with no point source block a padron it holds no row of, nor the other padrones", async () => {
    await database.exec(`
      CREATE TABLE carto.no_source (gid serial PRIMARY KEY, id_padron int);
      INSERT INTO carto.no_source (id_padron) VALUES (${await idOfNumber(database, "720")});
    `);
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const subdivided = classification.missingReview.find((review) => review.class === "SUBDIVIDED");
    const orphan = classification.missingReview.find((review) => review.number === "720");

    expect(subdivided?.removalReason).toBeNull();
    expect(subdivided?.reassignBlockers).toEqual({});
    expect(classification.counts.reassigned).toBe(7);
    expect(orphan?.removalReason).toBe("NOW_REFERENCED");
  });

  it("should make access_point NOT_REASSIGNABLE when its companion table is missing", async () => {
    await database.exec("DROP TABLE carto.address;");
    const scan = await scanOf(database);

    const classification = toPadronClassification(await analysisOf(database, scan));
    const entry = classification.missingReview.find((review) => review.class === "SUBDIVIDED");

    expect(entry?.removalReason).toBe("NOT_REASSIGNABLE");
    expect(entry?.reassignBlockers).toEqual({ "carto.access_point": "sin una única columna de geometría" });
  });
});
