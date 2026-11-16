import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  renumberCountColumns,
  renumberCtes,
  renumberListColumn,
  renumberSkippedListColumn,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/renumberSql";

const SETUP_TIMEOUT_MS = 30000;

/**
 * No PostGIS: a geometry is the interval "a:b" of one street line. That models exactly what the pairing needs: the length is
 * b - a, two shapes are within d when the gap between the intervals is at most d, and the Hausdorff distance of two intervals is
 * the larger difference of their ends.
 */
const FUNCTIONS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION iv_a(geometry) RETURNS float8 AS $$ SELECT split_part($1::text, ':', 1)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION iv_b(geometry) RETURNS float8 AS $$ SELECT split_part($1::text, ':', 2)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION ST_Length(geometry) RETURNS float8 AS $$ SELECT iv_b($1) - iv_a($1) $$ LANGUAGE sql;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8
    AS $$ SELECT greatest(abs(iv_a($1) - iv_a($2)), abs(iv_b($1) - iv_b($2))) $$ LANGUAGE sql;
  CREATE FUNCTION ST_DWithin(geometry, geometry, float8) RETURNS boolean
    AS $$ SELECT greatest(iv_a($1), iv_a($2)) - least(iv_b($1), iv_b($2)) <= $3 $$ LANGUAGE sql;
`;

const SETUP_SQL = `
  ${FUNCTIONS_SQL}

  CREATE TABLE t_removed (id int, ref text, idcalle text, geometry geometry, len float8);
  CREATE TABLE t_new (ref text, idcalle text, geom geometry);
  CREATE TABLE t_ap (ref text, points bigint);
  CREATE TABLE t_cur (id int, ref text);
  CREATE TABLE t_copy_refs (ref text, copies bigint);

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

  INSERT INTO t_cur VALUES (1, 'o1'), (2, 'o2'), (3, 'o3'), (4, 'o4'), (5, 'o5'), (6, 'o6a'), (7, 'o6b'), (8, 'o7'),
    (9, 'o8'), (10, 'o9'), (11, 'o10'), (12, 'o11');

  INSERT INTO t_copy_refs VALUES ('n1', 1), ('n2', 1), ('n3', 1), ('n4', 1), ('n5a', 1), ('n5b', 1), ('n6', 1), ('n7', 1),
    ('n8', 1), ('n9', 1), ('n10', 1), ('n11', 1);
`;

/** The reasons fixture: one pair per case of EJL-17, each on its own street stretch so no other pair is a candidate. */
const REASONS_SQL = `
  ${FUNCTIONS_SQL}

  CREATE TABLE t_removed (id int, ref text, idcalle text, geometry geometry, len float8);
  CREATE TABLE t_new (ref text, idcalle text, geom geometry);
  CREATE TABLE t_ap (ref text, points bigint);
  CREATE TABLE t_cur (id int, ref text);
  CREATE TABLE t_copy_refs (ref text, copies bigint);

  INSERT INTO t_removed VALUES
    (20, 'r1', 'X', '200:300', 100),
    (30, 'a1', 'X', '400:500', 100),
    (40, 'b1', 'X', '600:700', 100),
    (41, 'b2', 'X', '600:700.1', 100.1),
    (50, 'c1', 'X', '800:900', 100),
    (51, 'c2', 'X', '1000:1100', 100),
    (60, 'u1', 'X', '0:100', 100),
    (70, 'k1', 'X', '1200:1300', 100);

  INSERT INTO t_new VALUES
    ('m2', 'X', '200:300'),
    ('m3a', 'X', '400:500'),
    ('m3b', 'X', '400:500.1'),
    ('m4', 'X', '600:700'),
    ('m5', 'X', '800:900'),
    ('m6', 'X', '1000:1100'),
    ('m7', 'X', '0:100.2');

  INSERT INTO t_cur VALUES (20, 'r1'), (21, 'r1'), (30, 'a1'), (40, 'b1'), (41, 'b2'), (50, 'c1'), (51, 'c2'), (60, 'u1'), (70, 'k1');

  INSERT INTO t_copy_refs VALUES ('m2', 1), ('m3a', 1), ('m3b', 1), ('m4', 1), ('m6', 2), ('m7', 1);

  INSERT INTO t_ap VALUES ('r1', 2), ('a1', 1), ('c1', 4), ('u1', 5);
`;

/** The same CTE chain the analysis builds, over the test tables instead of the classification. */
const withRenumber = (select: string): string =>
  [
    'WITH "removed" AS (SELECT * FROM t_removed),',
    '"new_sections" AS (SELECT * FROM t_new),',
    '"ap" AS (SELECT * FROM t_ap),',
    '"cur" AS (SELECT * FROM t_cur),',
    '"copy_refs" AS (SELECT * FROM t_copy_refs),',
    `${renumberCtes().join(",\n")}`,
    select,
  ].join("\n");

const openDatabase = async (setup: string): Promise<PGlite> => {
  const database = new PGlite();
  await database.exec(setup);
  return database;
};

describe("renumbered pairs against PostgreSQL (ER-1, ER-2, ER-3, EJL-12, EJL-17)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await openDatabase(SETUP_SQL);
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

  it("should leave in removed_rest every removed section that is neither renumbered nor held, and no renumbered one", async () => {
    const result = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "removed_rest" ORDER BY ref'));

    expect(result.rows.map((row) => row.ref)).toEqual(["o11", "o2", "o3", "o4", "o7", "o8"]);
  });

  it("should leave in new_rest every new section that is neither renumbered nor held, and no renumbered one", async () => {
    const result = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "new_rest" ORDER BY ref'));

    expect(result.rows.map((row) => row.ref)).toEqual(["n11", "n2", "n3", "n4", "n7", "n8"]);
  });

  it("should split the raw removed count into the renumbered pairs, the removed rest and the held old sections (EJL-12)", async () => {
    const result = await database.query<{ removed: string; renumbered: string; rest: string; held: string }>(
      withRenumber(
        'SELECT (SELECT count(*) FROM "removed") AS removed, (SELECT count(*) FROM "renumbered") AS renumbered, (SELECT count(*) FROM "removed_rest") AS rest, (SELECT count(DISTINCT old_id) FROM "renum_skipped") AS held'
      )
    );
    const row = result.rows[0];

    expect(Number(row.removed)).toBe(12);
    expect(Number(row.renumbered) + Number(row.rest) + Number(row.held)).toBe(12);
    expect(Number(row.held)).toBe(3);
  });

  it("should count the pairs, the pairs with points, the points and the held pairs", async () => {
    const select = `SELECT ${renumberCountColumns().join(", ")}`;
    const result = await database.query<Record<string, unknown>>(withRenumber(select));
    const row = result.rows[0];

    expect(Number(row.renumbered)).toBe(3);
    expect(Number(row.renumbered_with_points)).toBe(2);
    expect(Number(row.renumbered_points)).toBe(10);
    expect(Number(row.renumber_skipped)).toBe(4);
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

describe("renumber refusal reasons against PostgreSQL (EJL-12, EJL-17)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await openDatabase(REASONS_SQL);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  const skipped = async (): Promise<Array<{ old_ref: string; new_ref: string; idcalle: string; points: number; reason: string }>> => {
    const result = await database.query<{ old_ref: string; new_ref: string; idcalle: string; points: string | number; reason: string }>(
      withRenumber('SELECT old_ref, new_ref, idcalle, points, reason FROM "renum_skipped" ORDER BY old_ref, new_ref')
    );
    return result.rows.map((row) => ({ ...row, points: Number(row.points) }));
  };

  const renumbered = async (): Promise<Array<{ old_ref: string; new_ref: string; points: number }>> => {
    const result = await database.query<{ old_ref: string; new_ref: string; points: string | number }>(
      withRenumber('SELECT old_ref, new_ref, points FROM "renumbered" ORDER BY old_ref')
    );
    return result.rows.map((row) => ({ ...row, points: Number(row.points) }));
  };

  it("should renumber a unique pair: one candidate on each side and one kept copy of the new reftramo", async () => {
    expect(await renumbered()).toEqual([{ old_ref: "u1", new_ref: "m7", points: 5 }]);
  });

  it("should refuse an old reftramo that names more than one row as repeated_old_ref, the row count of the old reftramo", async () => {
    expect((await skipped()).find((row) => row.old_ref === "r1")).toEqual({
      old_ref: "r1",
      new_ref: "m2",
      idcalle: "X",
      points: 2,
      reason: "repeated_old_ref",
    });
  });

  it("should refuse both candidates of an old section with two candidates as ambiguous_old_ref", async () => {
    const pairs = (await skipped()).filter((row) => row.old_ref === "a1");

    expect(pairs.map((row) => [row.new_ref, row.reason])).toEqual([
      ["m3a", "ambiguous_old_ref"],
      ["m3b", "ambiguous_old_ref"],
    ]);
  });

  it("should refuse both old candidates of a new reftramo with two candidates as ambiguous_new_ref", async () => {
    const pairs = (await skipped()).filter((row) => row.new_ref === "m4");

    expect(pairs.map((row) => [row.old_ref, row.reason])).toEqual([
      ["b1", "ambiguous_new_ref"],
      ["b2", "ambiguous_new_ref"],
    ]);
  });

  it("should refuse a new reftramo with no kept copy as not_single_copy", async () => {
    expect((await skipped()).find((row) => row.new_ref === "m5")).toMatchObject({ old_ref: "c1", reason: "not_single_copy" });
  });

  it("should refuse a new reftramo with several kept copies as not_single_copy", async () => {
    expect((await skipped()).find((row) => row.new_ref === "m6")).toMatchObject({ old_ref: "c2", reason: "not_single_copy" });
  });

  it("should give each skipped pair exactly one reason", async () => {
    const found = await skipped();

    expect(found.every((row) => typeof row.reason === "string" && row.reason !== "")).toBe(true);
    expect(new Set(found.map((row) => row.reason))).toEqual(
      new Set(["repeated_old_ref", "ambiguous_old_ref", "ambiguous_new_ref", "not_single_copy"])
    );
  });

  it("should keep the points of the old reftramo on every skipped pair, and move none", async () => {
    const found = await skipped();

    expect(found.find((row) => row.old_ref === "c1")?.points).toBe(4);
    expect(found.find((row) => row.old_ref === "a1")?.points).toBe(1);
    expect(found.find((row) => row.old_ref === "r1")?.points).toBe(2);
    expect(found.find((row) => row.old_ref === "c2")?.points).toBe(0);
  });

  it("should give one skipped row per candidate pair, each with both refs", async () => {
    expect((await skipped()).map((row) => `${row.old_ref}/${row.new_ref}`)).toEqual([
      "a1/m3a",
      "a1/m3b",
      "b1/m4",
      "b2/m4",
      "c1/m5",
      "c2/m6",
      "r1/m2",
    ]);
  });

  it("should hold both sections of a skipped pair: the old out of removed_rest, the new out of new_rest", async () => {
    const removedRest = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "removed_rest" ORDER BY ref'));
    const newRest = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "new_rest" ORDER BY ref'));

    expect(removedRest.rows.map((row) => row.ref)).toEqual(["k1"]);
    expect(newRest.rows).toEqual([]);
  });

  it("should count the held pairs as renumber_skipped and not as renumbered", async () => {
    const result = await database.query<Record<string, unknown>>(withRenumber(`SELECT ${renumberCountColumns().join(", ")}`));

    expect(Number(result.rows[0].renumbered)).toBe(1);
    expect(Number(result.rows[0].renumber_skipped)).toBe(7);
  });

  it("should list the held pairs with their refs, street, points and reason, points descending then old reftramo", async () => {
    const result = await database.query<{ list: Array<{ old_ref: string; new_ref: string; points: number; reason: string }> }>(
      withRenumber(`SELECT ${renumberSkippedListColumn("list")}`)
    );

    expect(result.rows[0].list.map((entry) => [entry.old_ref, entry.points, entry.reason])).toEqual([
      ["c1", 4, "not_single_copy"],
      ["r1", 2, "repeated_old_ref"],
      ["a1", 1, "ambiguous_old_ref"],
      ["a1", 1, "ambiguous_old_ref"],
      ["b1", 0, "ambiguous_new_ref"],
      ["b2", 0, "ambiguous_new_ref"],
      ["c2", 0, "not_single_copy"],
    ]);
  });
});
