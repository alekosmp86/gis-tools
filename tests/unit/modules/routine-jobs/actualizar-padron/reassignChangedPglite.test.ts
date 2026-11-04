import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { buildCreateDeleteIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildPadronReassignChangedSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignChangedSql";
import type { ReferenceTable } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { buildCreateRevertTableSql, REVERT_TABLE_SQL } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { toPadronReassignChangedOutcome } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";
import { reassignedRestoreLines } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertReassignLines";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

const SETUP_TIMEOUT_MS = 60000;

/* Stand-ins for PostGIS in one numeric model: a padron's geometry is the interval 'lo:hi', a point is its number, and a padron contains a
   point when lo <= point <= hi. The real containment, SRID and point-on-surface behaviour is PostGIS's own guarantee. */
const POSTGIS_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE DOMAIN geography AS text;
  CREATE FUNCTION ST_IsEmpty(text) RETURNS boolean AS 'SELECT $1 = ''''' LANGUAGE sql;
  CREATE FUNCTION ST_GeometryType(text) RETURNS text AS 'SELECT CASE WHEN $1 LIKE ''%:%'' THEN ''ST_Polygon'' ELSE ''ST_Point'' END' LANGUAGE sql;
  CREATE FUNCTION ST_PointOnSurface(text) RETURNS text AS 'SELECT split_part($1, '':'', 1)' LANGUAGE sql;
  CREATE FUNCTION ST_SRID(text) RETURNS int AS 'SELECT 32721' LANGUAGE sql;
  CREATE FUNCTION ST_Transform(text, int) RETURNS text AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Contains(text, text) RETURNS boolean AS 'SELECT $2::numeric BETWEEN split_part($1, '':'', 1)::numeric AND split_part($1, '':'', 2)::numeric' LANGUAGE sql STRICT;
  CREATE FUNCTION geometry_overlaps(text, text) RETURNS boolean AS 'SELECT true' LANGUAGE sql;
  CREATE OPERATOR && (LEFTARG = text, RIGHTARG = text, PROCEDURE = geometry_overlaps);
`;

const SCHEMA_SQL = `
  CREATE SCHEMA carto;
  CREATE TABLE carto.padron (
    id serial PRIMARY KEY, number varchar(10), type_padron varchar(30),
    id_cadastral_locality int, id_province int, geometry geometry
  );
  CREATE TABLE carto.access_point (gid serial PRIMARY KEY, id_padron int, geom geometry);
  CREATE TABLE carto.no_pk (id_padron int, geom geometry);
`;

/* Post-apply state. Province 1: 1 reshaped (kind U, now 0:10), 2 and 3 both cover 10:20 and 15 (ambiguous), 5 inserted by the same run
   (kind I, 40:50), 6 about to be deleted (60:70), 7 paired (kind P, 80:90). Province 2: 4 covers 10:20 and is never a receiver for province 1. */
const PADRON_SQL = `
  INSERT INTO carto.padron (id, number, type_padron, id_province, geometry) VALUES
    (1, 'P1', 'URBANO', 1, '0:10'),
    (2, 'P2', 'URBANO', 1, '10:20'),
    (3, 'P3', 'URBANO', 1, '10:30'),
    (4, 'P4', 'URBANO', 2, '10:20'),
    (5, 'P5', 'URBANO', 1, '40:50'),
    (6, 'P6', 'URBANO', 1, '60:70'),
    (7, 'P7', 'URBANO', 1, '80:90');
`;

const REVERT_ROWS_SQL = `
  INSERT INTO ${REVERT_TABLE_SQL} (kind, id, geometry) VALUES ('U', 1, '0:20'), ('P', 7, '80:100'), ('I', 5, NULL);
  INSERT INTO pg_temp.padron_delete_ids (id) VALUES (6);
`;

const ACCESS_POINT_SQL = `
  INSERT INTO carto.access_point (gid, id_padron, geom) VALUES
    (1, 1, '5'),
    (2, 1, '15'),
    (3, 1, '45'),
    (4, 1, '65'),
    (5, 1, '99'),
    (6, 1, NULL),
    (7, 1, ''),
    (8, 7, '5'),
    (9, 2, '99'),
    (10, 5, '99');
`;

const identityOf = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({ schema, table, columns: identityOf(columns) });

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

const ACCESS_POINT_TABLE: ReferenceTable = {
  schema: "carto",
  table: "access_point",
  reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false },
};

const BLOCKED_TABLE: ReferenceTable = { schema: "carto", table: "no_pk", reassignBlocker: "sin clave primaria de una sola columna" };

const sessionOn = (database: PGlite): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

describe("actualizar-padron reassignment of the id_padron of changed padrones on embedded Postgres (AP-121, AP-122, AP-72)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(POSTGIS_STUBS_SQL);
    await database.exec(SCHEMA_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.exec("ROLLBACK");
  });

  afterAll(async () => {
    await database.close();
  });

  async function arrange(extraSql = ""): Promise<void> {
    await database.exec("BEGIN");
    await database.query(buildCreateRevertTableSql());
    await database.exec(buildCreateDeleteIdsTableSql());
    await database.exec(PADRON_SQL);
    await database.exec(REVERT_ROWS_SQL);
    await database.exec(ACCESS_POINT_SQL);
    if (extraSql !== "") await database.exec(extraSql);
  }

  const runStatement = async (references: readonly ReferenceTable[] = [ACCESS_POINT_TABLE]): Promise<Row> =>
    (await database.query<Row>(buildPadronReassignChangedSql(LAYOUTS, references))).rows[0];

  const ownersOf = async (): Promise<Map<number, number | null>> =>
    new Map(
      (await database.query<{ gid: number; id_padron: number | null }>("SELECT gid, id_padron FROM carto.access_point ORDER BY gid")).rows.map((row) => [
        Number(row.gid),
        row.id_padron === null ? null : Number(row.id_padron),
      ])
    );

  const revertRows = async (): Promise<Row[]> =>
    (await database.query<Row>(`SELECT * FROM ${REVERT_TABLE_SQL} WHERE kind = 'R' AND ref_table IS NOT NULL ORDER BY seq`)).rows;

  it("should reassign a row outside its reshaped padron and inside another padron of its province, and report moved, selected, ambiguous, by table and revert rows", async () => {
    await arrange();

    const row = await runStatement();
    const owners = await ownersOf();

    expect(Number(row.moved)).toBe(3);
    expect(Number(row.selected)).toBe(3);
    expect(Number(row.ambiguous)).toBe(1);
    expect(row.by_table).toEqual({ "carto.access_point": 3 });
    expect(Number(row.revert_rows)).toBe(3);
    expect(owners.get(2)).toBe(2);
    expect(toPadronReassignChangedOutcome(row)).toEqual({ moved: 3, selected: 3, ambiguous: 1, byTable: { "carto.access_point": 3 } });
  });

  it("should leave untouched a row still inside its own padron, with no point, with an empty point or inside no padron", async () => {
    await arrange();

    await runStatement();
    const owners = await ownersOf();

    expect(owners.get(1)).toBe(1);
    expect(owners.get(5)).toBe(1);
    expect(owners.get(6)).toBe(1);
    expect(owners.get(7)).toBe(1);
  });

  it("should pick the lowest id when several padrones of the same province contain the point, never counting another province", async () => {
    await arrange();

    const row = await runStatement();
    const owners = await ownersOf();

    expect(owners.get(2)).toBe(2);
    expect(Number(row.ambiguous)).toBe(1);
    expect(owners.get(2)).not.toBe(3);
    expect(owners.get(2)).not.toBe(4);
  });

  it("should count as ambiguous only the rows with more than one possible padron", async () => {
    await arrange("UPDATE carto.padron SET geometry = '30:35' WHERE id = 3;");

    const row = await runStatement();

    expect(Number(row.moved)).toBe(3);
    expect(Number(row.ambiguous)).toBe(0);
  });

  it("should use a padron inserted by the same run as a receiver", async () => {
    await arrange();

    await runStatement();
    const owners = await ownersOf();

    expect(owners.get(3)).toBe(5);
  });

  it("should never use a padron in padron_delete_ids as a receiver, leaving the row on its padron", async () => {
    await arrange();

    await runStatement();
    const owners = await ownersOf();

    expect(owners.get(4)).toBe(1);
  });

  it("should reassign the row of a padron of kind P to the padron that contains its point", async () => {
    await arrange();

    await runStatement();
    const owners = await ownersOf();

    expect(owners.get(8)).toBe(1);
  });

  it("should consider only the padrones of revert kinds U and P, leaving the rows of an inserted padron and of an untouched padron alone", async () => {
    await arrange();

    await runStatement();
    const owners = await ownersOf();

    expect(owners.get(9)).toBe(2);
    expect(owners.get(10)).toBe(5);
  });

  it("should read each changed padron once when it has both a U and a P revert row (DISTINCT)", async () => {
    await arrange(`INSERT INTO ${REVERT_TABLE_SQL} (kind, id, geometry) VALUES ('P', 1, '0:20'), ('U', 7, '80:100');`);

    const row = await runStatement();

    expect(Number(row.moved)).toBe(3);
    expect(Number(row.selected)).toBe(3);
    expect(Number(row.revert_rows)).toBe(3);
  });

  it("should write one kind R revert row per reassigned row with the table, the primary key column and value, and the old id_padron in id", async () => {
    await arrange();

    await runStatement();
    const rows = await revertRows();

    expect(rows).toHaveLength(3);
    expect(rows.map((entry) => [Number(entry.id), String(entry.ref_key)]).sort()).toEqual([
      [1, "2"],
      [1, "3"],
      [7, "8"],
    ]);
    expect(rows.every((entry) => entry.ref_table === '"carto"."access_point"' && entry.ref_key_column === "gid")).toBe(true);
  });

  it("should restore the old id_padron of every reassigned row when the kind R rows are replayed", async () => {
    await arrange();
    const before = await ownersOf();

    await runStatement();
    const lines: string[] = [];
    for await (const line of reassignedRestoreLines(sessionOn(database))) lines.push(line.text);
    await database.exec(lines.join("\n"));
    const after = await ownersOf();

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(after).toEqual(before);
  });

  it("should leave out a padron that a table not reassignable by AP-110 references, and still reassign the others", async () => {
    await arrange("INSERT INTO carto.no_pk (id_padron, geom) VALUES (1, '1');");

    const row = await runStatement([ACCESS_POINT_TABLE, BLOCKED_TABLE]);
    const owners = await ownersOf();

    expect(Number(row.moved)).toBe(1);
    expect(owners.get(2)).toBe(1);
    expect(owners.get(3)).toBe(1);
    expect(owners.get(8)).toBe(1);
    expect(row.by_table).toEqual({ "carto.access_point": 1 });
  });

  it("should not let a blocked table that references no changed padron stop the rule", async () => {
    await arrange("INSERT INTO carto.no_pk (id_padron, geom) VALUES (2, '1');");

    const row = await runStatement([ACCESS_POINT_TABLE, BLOCKED_TABLE]);

    expect(Number(row.moved)).toBe(3);
  });

  it("should report zero everywhere and an empty by_table when no table can be reassigned", async () => {
    await arrange();
    const before = await ownersOf();

    const row = await runStatement([BLOCKED_TABLE]);

    expect(Number(row.moved)).toBe(0);
    expect(Number(row.selected)).toBe(0);
    expect(Number(row.ambiguous)).toBe(0);
    expect(row.by_table).toEqual({});
    expect(Number(row.revert_rows)).toBe(0);
    expect(await ownersOf()).toEqual(before);
  });

  it("should move nothing when the revert table holds no U or P row", async () => {
    await arrange(`DELETE FROM ${REVERT_TABLE_SQL} WHERE kind IN ('U', 'P');`);
    const before = await ownersOf();

    const row = await runStatement();

    expect(Number(row.moved)).toBe(0);
    expect(Number(row.revert_rows)).toBe(0);
    expect(await ownersOf()).toEqual(before);
  });

  it("should move nothing when the point lies in no other padron of the province", async () => {
    await arrange("UPDATE carto.access_point SET geom = '99' WHERE gid IN (2, 3, 8);");
    const before = await ownersOf();

    const row = await runStatement();

    expect(Number(row.moved)).toBe(0);
    expect(await ownersOf()).toEqual(before);
  });

  it("should write only id_padron, leaving the geometry and the other columns of the moved rows as they were", async () => {
    await arrange();
    const before = (await database.query<Row>("SELECT gid, geom FROM carto.access_point ORDER BY gid")).rows;

    await runStatement();

    expect((await database.query<Row>("SELECT gid, geom FROM carto.access_point ORDER BY gid")).rows).toEqual(before);
  });
});
