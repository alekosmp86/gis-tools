import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  renumberCountColumns,
  renumberCtes,
  renumberListColumn,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/renumberSql";

const SETUP_TIMEOUT_MS = 30000;

/**
 * No PostGIS: a geometry is the interval "a:b" of one street line. That models exactly what the pairing needs: the length is
 * b - a, two shapes are within d when the gap between the intervals is at most d, and the Hausdorff distance of two intervals is
 * the larger difference of their ends.
 */
const SETUP_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION iv_a(geometry) RETURNS float8 AS $$ SELECT split_part($1::text, ':', 1)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION iv_b(geometry) RETURNS float8 AS $$ SELECT split_part($1::text, ':', 2)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Length(geometry) RETURNS float8 AS $$ SELECT iv_b($1) - iv_a($1) $$ LANGUAGE sql;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8
    AS $$ SELECT greatest(abs(iv_a($1) - iv_a($2)), abs(iv_b($1) - iv_b($2))) $$ LANGUAGE sql;
  CREATE FUNCTION ST_DWithin(geometry, geometry, float8) RETURNS boolean
    AS $$ SELECT greatest(iv_a($1), iv_a($2)) - least(iv_b($1), iv_b($2)) <= $3 $$ LANGUAGE sql;

  CREATE TABLE t_removed (id int, ref text, idcalle text, geometry geometry, len float8);
  CREATE TABLE t_new (ref text, idcalle text, geom geometry);
  CREATE TABLE t_ap (ref text, points bigint);

  INSERT INTO t_removed VALUES
    (1, 'o1', 'A', '0:100', 100),
    (2, 'o2', 'B', '200:300', 100),
    (3, 'o3', 'C', '400:500', 100),
    (4, 'o4', NULL, '600:700', 100),
    (5, 'o5', 'D', '800:900', 100),
    (6, 'o6a', 'E', '1000:1100', 100),
    (7, 'o6b', 'E', '1000:1100.1', 100.1),
    (8, 'o7', 'F', '1200:1200', 0),
    (9, 'o8', 'G', '1300:1400', 100),
    (10, 'o9', 'H', '1500:1600', 100),
    (11, 'o10', 'I', '1700:1800', 100),
    (12, 'o11', 'J', '1900:2000', 100);

  INSERT INTO t_new VALUES
    ('n1', 'A', '0:100.2'),
    ('n2', 'B', '200:300.5'),
    ('n3', 'X', '400:500'),
    ('n4', NULL, '600:700'),
    ('n5a', 'D', '800:900.1'),
    ('n5b', 'D', '800:900.2'),
    ('n6', 'E', '1000:1100'),
    ('n7', 'F', '1200:1200'),
    ('n8', 'G', '1305:1405'),
    ('n9', 'H', '1500:1600'),
    ('n10', 'I', '1700:1800.49'),
    ('n11', 'J', '1901.5:2000');

  INSERT INTO t_ap VALUES ('o1', 3), ('o9', 0), ('o10', 7), ('o2', 2);
`;

/** The same CTE chain the analysis builds, over the test tables instead of the classification. */
const withRenumber = (select: string): string =>
  [
    'WITH "removed" AS (SELECT * FROM t_removed),',
    '"new_sections" AS (SELECT * FROM t_new),',
    '"ap" AS (SELECT * FROM t_ap),',
    `${renumberCtes().join(",\n")}`,
    select,
  ].join("\n");

describe("renumbered pairs against PostgreSQL (ER-1, ER-2, ER-3)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(SETUP_SQL);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  const pairs = async (): Promise<Array<{ old_ref: string; new_ref: string; points: number; hausdorff: number }>> => {
    const result = await database.query<{ old_ref: string; new_ref: string; points: string | number; hausdorff: number }>(
      withRenumber('SELECT old_ref, new_ref, points, hausdorff FROM "renumbered" ORDER BY old_ref')
    );
    return result.rows.map((row) => ({ ...row, points: Number(row.points) }));
  };

  it("should pair exactly the one-to-one candidates of the same idcalle with a Hausdorff distance under 0.5 m", async () => {
    const found = await pairs();

    expect(found.map((row) => [row.old_ref, row.new_ref])).toEqual([
      ["o1", "n1"],
      ["o10", "n10"],
      ["o9", "n9"],
    ]);
  });

  it("should carry the points of the old section, 0 when it has none, and the Hausdorff distance", async () => {
    const found = await pairs();
    const byOld = Object.fromEntries(found.map((row) => [row.old_ref, row]));

    expect(byOld.o1.points).toBe(3);
    expect(byOld.o9.points).toBe(0);
    expect(byOld.o10.points).toBe(7);
    expect(byOld.o1.hausdorff).toBeCloseTo(0.2, 6);
    expect(byOld.o10.hausdorff).toBeCloseTo(0.49, 6);
  });

  it("should not pair a Hausdorff distance of exactly 0.5 m", async () => {
    const found = await pairs();

    expect(found.map((row) => row.old_ref)).not.toContain("o2");
  });

  it("should not pair sections of a different idcalle, nor a null idcalle on both sides", async () => {
    const found = await pairs();

    expect(found.map((row) => row.old_ref)).not.toContain("o3");
    expect(found.map((row) => row.old_ref)).not.toContain("o4");
  });

  it("should not pair an old section with two candidates, and leave both candidates unpaired", async () => {
    const found = await pairs();

    expect(found.map((row) => row.old_ref)).not.toContain("o5");
    expect(found.map((row) => row.new_ref)).not.toContain("n5a");
    expect(found.map((row) => row.new_ref)).not.toContain("n5b");
  });

  it("should not pair a new section that has two old candidates", async () => {
    const found = await pairs();

    expect(found.map((row) => row.new_ref)).not.toContain("n6");
    expect(found.map((row) => row.old_ref)).not.toContain("o6a");
    expect(found.map((row) => row.old_ref)).not.toContain("o6b");
  });

  it("should not pair a removed section of zero length", async () => {
    expect((await pairs()).map((row) => row.old_ref)).not.toContain("o7");
  });

  it("should not pair sections farther than the candidate distance, however alike their shape", async () => {
    expect((await pairs()).map((row) => row.old_ref)).not.toContain("o8");
  });

  it("should not pair sections whose ends differ by more than the Hausdorff threshold even when they touch", async () => {
    expect((await pairs()).map((row) => row.old_ref)).not.toContain("o11");
  });

  it("should leave in removed_rest every removed section that is not renumbered, and no renumbered one", async () => {
    const result = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "removed_rest" ORDER BY ref'));

    expect(result.rows.map((row) => row.ref)).toEqual(["o11", "o2", "o3", "o4", "o5", "o6a", "o6b", "o7", "o8"]);
  });

  it("should leave in new_rest every new section that is not renumbered, and no renumbered one", async () => {
    const result = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "new_rest" ORDER BY ref'));

    expect(result.rows.map((row) => row.ref)).toEqual(["n11", "n2", "n3", "n4", "n5a", "n5b", "n6", "n7", "n8"]);
  });

  it("should keep the raw removed count equal to the renumbered pairs plus the removed rest", async () => {
    const result = await database.query<{ removed: string; renumbered: string; rest: string }>(
      withRenumber(
        'SELECT (SELECT count(*) FROM "removed") AS removed, (SELECT count(*) FROM "renumbered") AS renumbered, (SELECT count(*) FROM "removed_rest") AS rest'
      )
    );
    const row = result.rows[0];

    expect(Number(row.removed)).toBe(Number(row.renumbered) + Number(row.rest));
    expect(Number(row.removed)).toBe(12);
  });

  it("should count the pairs, the pairs with points and the points", async () => {
    const select = `SELECT ${renumberCountColumns().join(", ")}`;
    const result = await database.query<Record<string, unknown>>(withRenumber(select));
    const row = result.rows[0];

    expect(Number(row.renumbered)).toBe(3);
    expect(Number(row.renumbered_with_points)).toBe(2);
    expect(Number(row.renumbered_points)).toBe(10);
  });

  it("should list the pairs by points descending, then old reftramo", async () => {
    const result = await database.query<{ list: Array<{ old_ref: string; new_ref: string; points: number }> }>(
      withRenumber(`SELECT ${renumberListColumn("list")}`)
    );

    expect(result.rows[0].list.map((entry) => [entry.old_ref, entry.points])).toEqual([
      ["o10", 7],
      ["o1", 3],
      ["o9", 0],
    ]);
    expect(Object.keys(result.rows[0].list[0]).sort()).toEqual(
      ["hausdorff", "idcalle", "new_length", "new_ref", "old_length", "old_ref", "points"].sort()
    );
  });
});
