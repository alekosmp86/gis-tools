import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GEO_TWIN_ROLE, RENUMBER_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import {
  renumberCountColumns,
  renumberCtes,
  renumberDroppedListColumn,
  renumberListColumn,
  renumberOutcomeCtes,
  renumberPruneCtes,
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
  CREATE TABLE t_geo_roles (ref text, role text);

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
    ('101', 'A', '0:100.2'),
    ('102', 'B', '200:300.5'),
    ('103', 'X', '400:500'),
    ('104', NULL, '600:700'),
    ('105', 'D', '800:900.1'),
    ('106', 'D', '800:900.2'),
    ('107', 'E', '1000:1100'),
    ('108', 'F', '1200:1200'),
    ('109', 'G', '1305:1405'),
    ('110', 'H', '1500:1600'),
    ('111', 'I', '1700:1800.49'),
    ('112', 'J', '1901.5:2000');

  INSERT INTO t_ap VALUES ('o1', 3), ('o9', 0), ('o10', 7), ('o2', 2);

  INSERT INTO t_cur VALUES (1, 'o1'), (2, 'o2'), (3, 'o3'), (4, 'o4'), (5, 'o5'), (6, 'o6a'), (7, 'o6b'), (8, 'o7'),
    (9, 'o8'), (10, 'o9'), (11, 'o10'), (12, 'o11');

  INSERT INTO t_copy_refs VALUES ('101', 1), ('102', 1), ('103', 1), ('104', 1), ('105', 1), ('106', 1), ('107', 1), ('108', 1),
    ('109', 1), ('110', 1), ('111', 1), ('112', 1);
`;

/** The reasons fixture: one pair per case of EJL-17, each on its own street stretch so no other pair is a candidate. */
const REASONS_SQL = `
  ${FUNCTIONS_SQL}

  CREATE TABLE t_removed (id int, ref text, idcalle text, geometry geometry, len float8);
  CREATE TABLE t_new (ref text, idcalle text, geom geometry);
  CREATE TABLE t_ap (ref text, points bigint);
  CREATE TABLE t_cur (id int, ref text);
  CREATE TABLE t_copy_refs (ref text, copies bigint);
  CREATE TABLE t_geo_roles (ref text, role text);

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
    ('201', 'X', '200:300'),
    ('202', 'X', '400:500'),
    ('203', 'X', '400:500.1'),
    ('204', 'X', '600:700'),
    ('205', 'X', '800:900'),
    ('206', 'X', '1000:1100'),
    ('207', 'X', '0:100.2');

  INSERT INTO t_cur VALUES (20, 'r1'), (21, 'r1'), (30, 'a1'), (40, 'b1'), (41, 'b2'), (50, 'c1'), (51, 'c2'), (60, 'u1'), (70, 'k1');

  INSERT INTO t_copy_refs VALUES ('201', 1), ('202', 1), ('203', 1), ('204', 1), ('206', 2), ('207', 1);

  INSERT INTO t_ap VALUES ('r1', 2), ('a1', 1), ('c1', 4), ('u1', 5);
`;

/**
 * The pruning fixture: p1 has two candidates (the nearer wins), p2 a tie on Hausdorff distance (the lowest numeric reftramo wins),
 * p3 and p4 share the candidate 42, which is the second choice of p3 and the only candidate of p4, so it is kept, not discarded.
 */
const PRUNE_SQL = `
  ${FUNCTIONS_SQL}

  CREATE TABLE t_removed (id int, ref text, idcalle text, geometry geometry, len float8);
  CREATE TABLE t_new (ref text, idcalle text, geom geometry);
  CREATE TABLE t_ap (ref text, points bigint);
  CREATE TABLE t_cur (id int, ref text);
  CREATE TABLE t_copy_refs (ref text, copies bigint);
  CREATE TABLE t_geo_roles (ref text, role text);

  INSERT INTO t_removed VALUES
    (1, 'p1', 'Y', '0:100', 100),
    (2, 'p2', 'Y', '200:300', 100),
    (3, 'p3', 'Y', '400:500', 100),
    (4, 'p4', 'Y', '400:500.8', 100.8);

  INSERT INTO t_new VALUES
    ('31', 'Y', '0:100.375'),
    ('32', 'Y', '0:100.125'),
    ('10', 'Y', '200:300.25'),
    ('9', 'Y', '200.25:300'),
    ('41', 'Y', '400:500'),
    ('42', 'Y', '400:500.4');

  INSERT INTO t_ap VALUES ('p3', 4);

  INSERT INTO t_cur VALUES (1, 'p1'), (2, 'p2'), (3, 'p3'), (4, 'p4');

  INSERT INTO t_copy_refs VALUES ('31', 1), ('32', 1), ('9', 1), ('10', 1), ('41', 1), ('42', 1);
`;

/**
 * The outcome fixture: one street stretch per case, so no pair is a candidate of another. `k1` loses 402 to 401 and 402 holds nothing
 * (dropped). `m1` names two rows (repeated_old_ref), so its best 601 and its loser 602 are held, not dropped. `n1` renumbers to 701,
 * and its loser 702 holds points (held as candidate_has_points). `g1` renumbers to 801, and its loser 802 is a geometric twin winner
 * (kept as a new section, neither dropped nor held).
 */
const OUTCOME_SQL = `
  ${FUNCTIONS_SQL}

  CREATE TABLE t_removed (id int, ref text, idcalle text, geometry geometry, len float8);
  CREATE TABLE t_new (ref text, idcalle text, geom geometry);
  CREATE TABLE t_ap (ref text, points bigint);
  CREATE TABLE t_cur (id int, ref text);
  CREATE TABLE t_copy_refs (ref text, copies bigint);
  CREATE TABLE t_geo_roles (ref text, role text);

  INSERT INTO t_removed VALUES
    (1, 'k1', 'K', '0:100', 100),
    (4, 'm1', 'M', '2000:2100', 100),
    (6, 'n1', 'N', '3000:3100', 100),
    (7, 'g1', 'G2', '4000:4100', 100);

  INSERT INTO t_new VALUES
    ('401', 'K', '0:100.1'),
    ('402', 'K', '0:100.3'),
    ('601', 'M', '2000:2100.1'),
    ('602', 'M', '2000:2100.3'),
    ('701', 'N', '3000:3100.1'),
    ('702', 'N', '3000:3100.3'),
    ('801', 'G2', '4000:4100.1'),
    ('802', 'G2', '4000:4100.3');

  INSERT INTO t_cur VALUES (1, 'k1'), (4, 'm1'), (5, 'm1'), (6, 'n1'), (7, 'g1');

  INSERT INTO t_copy_refs VALUES ('401', 1), ('402', 1), ('601', 1), ('602', 1), ('701', 1), ('702', 1), ('801', 1), ('802', 1);

  INSERT INTO t_ap VALUES ('702', 2);

  INSERT INTO t_geo_roles VALUES ('802', 'winner');
`;

/** The same CTE chain the analysis builds, over the test tables instead of the classification. */
const withRenumber = (select: string): string =>
  [
    'WITH "removed" AS (SELECT * FROM t_removed),',
    '"new_sections" AS (SELECT * FROM t_new),',
    '"ap" AS (SELECT * FROM t_ap),',
    '"cur" AS (SELECT * FROM t_cur),',
    '"copy_kept" AS (SELECT c.ref FROM t_copy_refs AS c, generate_series(1, c.copies::int) AS g(i)),',
    '"geo_roles" AS (SELECT * FROM t_geo_roles),',
    `"geo_losers" AS (SELECT r.ref FROM "geo_roles" AS r WHERE r.role = '${GEO_TWIN_ROLE.LOSER}'),`,
    `${[...renumberPruneCtes(), ...renumberOutcomeCtes(), ...renumberCtes()].join(",\n")}`,
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

  it("should pair exactly the one-to-one candidates of the same idcalle with a Hausdorff distance under 0.5 m, and the nearer candidate of an old section with two", async () => {
    const found = await pairs();

    expect(found.map((row) => [row.old_ref, row.new_ref])).toEqual([
      ["o1", "101"],
      ["o10", "111"],
      ["o5", "105"],
      ["o9", "110"],
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

  it("should discard the farther candidate of an old section with two, and hold neither side of it", async () => {
    const dropped = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "renum_dropped" ORDER BY ref'));
    const skipped = await database.query<{ old_ref: string }>(withRenumber('SELECT old_ref FROM "renum_skipped"'));

    expect(dropped.rows.map((row) => row.ref)).toEqual(["106"]);
    expect(skipped.rows.map((row) => row.old_ref)).not.toContain("o5");
  });

  it("should not pair a new section that has two old candidates", async () => {
    const found = await pairs();

    expect(found.map((row) => row.new_ref)).not.toContain("107");
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

  it("should leave in new_rest every new section that is neither renumbered, held nor discarded, and no renumbered one", async () => {
    const result = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "new_rest" ORDER BY ref'));

    expect(result.rows.map((row) => row.ref)).toEqual(["102", "103", "104", "108", "109", "112"]);
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
    expect(Number(row.held)).toBe(2);
  });

  it("should count the pairs, the pairs with points, the points, the pairs chosen by geometry, the discarded candidates and the held pairs", async () => {
    const select = `SELECT ${renumberCountColumns().join(", ")}`;
    const result = await database.query<Record<string, unknown>>(withRenumber(select));
    const row = result.rows[0];

    expect(Number(row.renumbered)).toBe(4);
    expect(Number(row.renumbered_with_points)).toBe(2);
    expect(Number(row.renumbered_points)).toBe(10);
    expect(Number(row.renumbered_by_geometry)).toBe(1);
    expect(Number(row.renumber_dropped_candidates)).toBe(1);
    expect(Number(row.renumber_skipped)).toBe(2);
  });

  it("should list the pairs by points descending, then old reftramo", async () => {
    const result = await database.query<{ list: Array<{ old_ref: string; new_ref: string; points: number }> }>(
      withRenumber(`SELECT ${renumberListColumn("list")}`)
    );

    expect(result.rows[0].list.map((entry) => [entry.old_ref, entry.points])).toEqual([
      ["o10", 7],
      ["o1", 3],
      ["o5", 0],
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
    expect(await renumbered()).toEqual([
      { old_ref: "a1", new_ref: "202", points: 1 },
      { old_ref: "u1", new_ref: "207", points: 5 },
    ]);
  });

  it("should refuse an old reftramo that names more than one row as repeated_old_ref, the row count of the old reftramo", async () => {
    expect((await skipped()).find((row) => row.old_ref === "r1")).toEqual({
      old_ref: "r1",
      new_ref: "201",
      idcalle: "X",
      points: 2,
      reason: "repeated_old_ref",
    });
  });

  it("should renumber the nearer candidate of an old section with two candidates and discard the other, holding neither", async () => {
    const dropped = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "renum_dropped" ORDER BY ref'));
    const held = (await skipped()).filter((row) => row.old_ref === "a1");

    expect(dropped.rows.map((row) => row.ref)).toEqual(["203"]);
    expect(held).toEqual([]);
  });

  it("should refuse both old candidates of a new reftramo with two candidates as ambiguous_new_ref", async () => {
    const pairs = (await skipped()).filter((row) => row.new_ref === "204");

    expect(pairs.map((row) => [row.old_ref, row.reason])).toEqual([
      ["b1", "ambiguous_new_ref"],
      ["b2", "ambiguous_new_ref"],
    ]);
  });

  it("should refuse a new reftramo with no kept copy as not_single_copy", async () => {
    expect((await skipped()).find((row) => row.new_ref === "205")).toMatchObject({ old_ref: "c1", reason: "not_single_copy" });
  });

  it("should refuse a new reftramo with several kept copies as not_single_copy", async () => {
    expect((await skipped()).find((row) => row.new_ref === "206")).toMatchObject({ old_ref: "c2", reason: "not_single_copy" });
  });

  it("should give each skipped pair exactly one reason", async () => {
    const found = await skipped();

    expect(found.every((row) => typeof row.reason === "string" && row.reason !== "")).toBe(true);
    expect(new Set(found.map((row) => row.reason))).toEqual(new Set(["repeated_old_ref", "ambiguous_new_ref", "not_single_copy"]));
  });

  it("should keep the points of the old reftramo on every skipped pair, and move none", async () => {
    const found = await skipped();

    expect(found.find((row) => row.old_ref === "c1")?.points).toBe(4);
    expect(found.find((row) => row.old_ref === "r1")?.points).toBe(2);
    expect(found.find((row) => row.old_ref === "c2")?.points).toBe(0);
  });

  it("should give one skipped row per candidate pair, each with both refs", async () => {
    expect((await skipped()).map((row) => `${row.old_ref}/${row.new_ref}`)).toEqual(["b1/204", "b2/204", "c1/205", "c2/206", "r1/201"]);
  });

  it("should hold both sections of a skipped pair: the old out of removed_rest, the new out of new_rest", async () => {
    const removedRest = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "removed_rest" ORDER BY ref'));
    const newRest = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "new_rest" ORDER BY ref'));

    expect(removedRest.rows.map((row) => row.ref)).toEqual(["k1"]);
    expect(newRest.rows).toEqual([]);
  });

  it("should count the held pairs as renumber_skipped and not as renumbered", async () => {
    const result = await database.query<Record<string, unknown>>(withRenumber(`SELECT ${renumberCountColumns().join(", ")}`));

    expect(Number(result.rows[0].renumbered)).toBe(2);
    expect(Number(result.rows[0].renumber_skipped)).toBe(5);
  });

  it("should list the held pairs with their refs, street, points and reason, points descending then old reftramo", async () => {
    const result = await database.query<{ list: Array<{ old_ref: string; new_ref: string; points: number; reason: string }> }>(
      withRenumber(`SELECT ${renumberSkippedListColumn("list")}`)
    );

    expect(result.rows[0].list.map((entry) => [entry.old_ref, entry.points, entry.reason])).toEqual([
      ["c1", 4, "not_single_copy"],
      ["r1", 2, "repeated_old_ref"],
      ["b1", 0, "ambiguous_new_ref"],
      ["b2", 0, "ambiguous_new_ref"],
      ["c2", 0, "not_single_copy"],
    ]);
  });
});

describe("renumber candidate pruning against PostgreSQL (EJL-27, EJL-28)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await openDatabase(PRUNE_SQL);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  const renumbered = async (): Promise<Array<{ old_ref: string; new_ref: string; points: number; hausdorff: number }>> => {
    const result = await database.query<{ old_ref: string; new_ref: string; points: string | number; hausdorff: number }>(
      withRenumber('SELECT old_ref, new_ref, points, hausdorff FROM "renumbered" ORDER BY old_ref')
    );
    return result.rows.map((row) => ({ ...row, points: Number(row.points) }));
  };

  it("should renumber each old section to its candidate with the smallest Hausdorff distance", async () => {
    const found = await renumbered();

    expect(found.map((row) => [row.old_ref, row.new_ref])).toEqual([
      ["p1", "32"],
      ["p2", "9"],
      ["p3", "41"],
      ["p4", "42"],
    ]);
    expect(found[0].hausdorff).toBeCloseTo(0.125, 6);
  });

  it("should break a Hausdorff tie by the lowest numeric reftramo, not the lowest text", async () => {
    const found = await renumbered();

    expect(found.find((row) => row.old_ref === "p2")?.new_ref).toBe("9");
  });

  it("should discard the candidates that lost to a better one of their old section", async () => {
    const dropped = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "renum_dropped" ORDER BY ref'));

    expect(dropped.rows.map((row) => row.ref)).toEqual(["10", "31"]);
  });

  it("should keep a discarded-candidate reftramo that is the sole candidate of another old section, renumbering that section to it", async () => {
    const found = await renumbered();
    const dropped = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "renum_dropped"'));

    expect(found.find((row) => row.old_ref === "p4")?.new_ref).toBe("42");
    expect(dropped.rows.map((row) => row.ref)).not.toContain("42");
  });

  it("should leave no discarded reftramo in new_rest, and no removed section in removed_rest", async () => {
    const newRest = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "new_rest"'));
    const removedRest = await database.query<{ ref: string }>(withRenumber('SELECT ref FROM "removed_rest"'));

    expect(newRest.rows).toEqual([]);
    expect(removedRest.rows).toEqual([]);
  });

  it("should count the pairs chosen by geometry and the discarded candidates", async () => {
    const result = await database.query<Record<string, unknown>>(withRenumber(`SELECT ${renumberCountColumns().join(", ")}`));

    expect(Number(result.rows[0].renumbered)).toBe(4);
    expect(Number(result.rows[0].renumbered_by_geometry)).toBe(3);
    expect(Number(result.rows[0].renumber_dropped_candidates)).toBe(2);
    expect(Number(result.rows[0].renumber_skipped)).toBe(0);
  });
});

describe("renumber losing candidates against PostgreSQL (EJL-27, EJL-28)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await openDatabase(OUTCOME_SQL);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  const refsOf = async (relation: string): Promise<string[]> => {
    const result = await database.query<{ ref: string }>(withRenumber(`SELECT ref FROM "${relation}" ORDER BY ref`));
    return result.rows.map((row) => row.ref);
  };

  it("should drop a losing candidate of a renumbering old section when it holds no points and is no geometric winner", async () => {
    expect(await refsOf("renum_dropped")).toEqual(["402"]);
  });

  it("should list each dropped candidate with its dropped reftramo, old reftramo, kept reftramo, Hausdorff distance and points", async () => {
    const result = await database.query<{ list: Array<Record<string, unknown>> }>(withRenumber(`SELECT ${renumberDroppedListColumn("list")}`));

    expect(result.rows[0].list).toEqual([{ ref: "402", old_ref: "k1", kept_ref: "401", hausdorff: expect.any(Number), points: 0 }]);
    expect(Number((result.rows[0].list[0] as { hausdorff: number }).hausdorff)).toBeCloseTo(0.3, 6);
  });

  it("should hold, not drop, the candidates of an old section whose best candidate is refused as repeated_old_ref", async () => {
    const skipped = await database.query<{ old_ref: string; new_ref: string; reason: string }>(
      withRenumber('SELECT old_ref, new_ref, reason FROM "renum_skipped" ORDER BY new_ref')
    );

    expect(skipped.rows).toEqual([
      { old_ref: "m1", new_ref: "601", reason: RENUMBER_SKIP_REASON.REPEATED_OLD_REF },
      { old_ref: "m1", new_ref: "602", reason: RENUMBER_SKIP_REASON.REPEATED_OLD_REF },
      { old_ref: "n1", new_ref: "702", reason: RENUMBER_SKIP_REASON.CANDIDATE_HAS_POINTS },
    ]);
    expect(await refsOf("renum_dropped")).not.toContain("602");
  });

  it("should hold a losing candidate that holds access points as candidate_has_points, not drop it", async () => {
    const skipped = await database.query<{ reason: string }>(withRenumber('SELECT reason FROM "renum_skipped" WHERE new_ref = \'702\''));

    expect(skipped.rows).toEqual([{ reason: RENUMBER_SKIP_REASON.CANDIDATE_HAS_POINTS }]);
    expect(await refsOf("renum_dropped")).not.toContain("702");
  });

  it("should keep a geometric twin winner as a new section, neither dropped nor held, although it loses the Hausdorff pick", async () => {
    const newRest = await refsOf("new_rest");

    expect(newRest).toEqual(["802"]);
    expect(await refsOf("renum_dropped")).not.toContain("802");
    const held = await database.query<{ ref: string }>(withRenumber('SELECT new_ref AS ref FROM "renum_skipped"'));

    expect(held.rows.map((row) => row.ref)).not.toContain("802");
  });

  it("should count the discarded candidates and the held pairs, the held pairs counted by their distinct reftramo pairs", async () => {
    const result = await database.query<Record<string, unknown>>(withRenumber(`SELECT ${renumberCountColumns().join(", ")}`));

    expect(Number(result.rows[0].renumbered)).toBe(3);
    expect(Number(result.rows[0].renumber_dropped_candidates)).toBe(1);
    expect(Number(result.rows[0].renumber_skipped)).toBe(3);
  });
});
