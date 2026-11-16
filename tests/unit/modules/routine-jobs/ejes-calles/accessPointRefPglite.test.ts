import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessPointRefMatchSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { buildCreateRenumberTableSql, buildSurplusTableSql, LOAD_TEMP } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import { buildMovePointsSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadWriteSql";
import { buildRevertPointsSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/revertSql";
import { canonicalTextSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/stagingSql";
import type { EjesLoadContext } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import { type AccessPointRefType, createEjesDatabase, loadContextOn, type Row, rowsOf } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;
const CANONICAL_COLUMN = 'a."id_road_section"';
const NEW_REF = "777";
const INTEGER_MATCH_SQL = `${CANONICAL_COLUMN} = CASE WHEN v.old_ref ~ '^(0|-?[1-9][0-9]*)$' THEN (CASE WHEN v.old_ref::numeric BETWEEN -2147483648 AND 2147483647 THEN v.old_ref::integer END) END`;
const TEXT_MATCH_SQL = `${canonicalTextSql(CANONICAL_COLUMN)} = v.old_ref`;
const RENUM_ROW_SQL = `INSERT INTO pg_temp."${LOAD_TEMP.RENUM}" (old_id, old_ref, new_ref, points) VALUES (1, $1, $2, 0)`;

const OLD_REFS = ["12", "0", "-5", "0012", "abc", "99999999999", "-2147483648", "2147483647", "-2147483649", "2147483648"];

const POINT_VALUES: Record<AccessPointRefType, ReadonlyArray<string | number>> = {
  integer: [12, 12, 0, -5, 2147483647, -2147483648, 99999],
  varchar: ["12", "0012", "12 ", "0", "-5", "abc", "2147483647", "-2147483648", "99999999999", "99999"],
};

const EXPECTED_POINTS: Record<AccessPointRefType, Record<string, number>> = {
  integer: { "12": 2, "0": 1, "-5": 1, "0012": 0, abc: 0, "99999999999": 0, "-2147483648": 1, "2147483647": 1, "-2147483649": 0, "2147483648": 0 },
  varchar: { "12": 3, "0": 1, "-5": 1, "0012": 0, abc: 1, "99999999999": 1, "-2147483648": 1, "2147483647": 1, "-2147483649": 0, "2147483648": 0 },
};

const seedPoints = async (database: PGlite, refType: AccessPointRefType): Promise<void> => {
  for (const value of POINT_VALUES[refType]) {
    await database.query("INSERT INTO carto.access_point (id_road_section) VALUES ($1)", [value]);
  }
};

const pointRows = async (database: PGlite): Promise<Row[]> =>
  rowsOf(database, "SELECT id, id_road_section::text AS value FROM carto.access_point ORDER BY id");

/** The ids of the points that `matchSql` relates to `oldRef`; the value comes from a text column, as in production. */
const matchingIds = async (database: PGlite, matchSql: string, oldRef: string): Promise<number[]> => {
  const result = await database.query<{ id: number }>(
    `SELECT a.id FROM carto.access_point AS a, (SELECT $1::text AS old_ref) AS v WHERE ${matchSql} ORDER BY a.id`,
    [oldRef]
  );
  return result.rows.map((row) => Number(row.id));
};

const surplusRowsOf = async (database: PGlite): Promise<Array<{ id: number; ref: string; points: number }>> =>
  (await rowsOf(database, 'SELECT id, ref, points FROM pg_temp."ej_surplus" ORDER BY id')).map((row) => ({
    id: Number(row.id),
    ref: String(row.ref),
    points: Number(row.points),
  }));

describe.each<AccessPointRefType>(["integer", "varchar"])(
  "access point reference match on a %s id_road_section column (EJL-10, EJL-11, EJL-19)",
  (refType) => {
    let database: PGlite;
    let context: EjesLoadContext;

    beforeEach(async () => {
      database = await createEjesDatabase(PGlite, refType);
      await seedPoints(database, refType);
      context = await loadContextOn(database);
    }, HOOK_TIMEOUT_MS);

    afterEach(async () => {
      await database.close();
    }, HOOK_TIMEOUT_MS);

    describe("match", () => {
      it.each(OLD_REFS)("should match the same points as the canonical text compare for old reftramo %s, with no cast error", async (oldRef) => {
        const branch = await matchingIds(database, accessPointRefMatchSql(context, "v.old_ref"), oldRef);
        const canonical = await matchingIds(database, TEXT_MATCH_SQL, oldRef);

        expect(branch).toEqual(canonical);
        expect(branch).toHaveLength(EXPECTED_POINTS[refType][oldRef]);
      });

      it("should emit the bare integer compare for an integer column and the canonical text compare for a text column", () => {
        const expected = refType === "integer" ? INTEGER_MATCH_SQL : TEXT_MATCH_SQL;

        expect(accessPointRefMatchSql(context, "v.old_ref")).toBe(expected);
      });
    });

    describe("move of the points (EJL-10)", () => {
      it.each(OLD_REFS)("should move exactly the points the canonical text compare matches for old reftramo %s, with no cast error", async (oldRef) => {
        const canonical = await matchingIds(database, TEXT_MATCH_SQL, oldRef);
        await database.exec("BEGIN");
        await database.exec(buildCreateRenumberTableSql(LOAD_TEMP.RENUM));
        await database.query(RENUM_ROW_SQL, [oldRef, NEW_REF]);

        const written = await database.query<{ written: number | string }>(buildMovePointsSql(context));
        const moved = await matchingIds(database, TEXT_MATCH_SQL, NEW_REF);
        await database.exec("ROLLBACK");

        expect(moved).toEqual(canonical);
        expect(Number(written.rows[0].written)).toBe(canonical.length);
      });
    });

    describe("revert of the points (EJL-4)", () => {
      it.each(OLD_REFS)("should restore exactly the points of old reftramo %s from the revert SQL written before the move", async (oldRef) => {
        const before = await pointRows(database);
        const canonical = await matchingIds(database, TEXT_MATCH_SQL, oldRef);
        await database.exec("BEGIN");
        await database.exec(buildCreateRenumberTableSql(LOAD_TEMP.RENUM));
        await database.query(RENUM_ROW_SQL, [oldRef, NEW_REF]);
        await database.exec(buildRevertPointsSql(context, ejesLayouts()));
        await database.query(buildMovePointsSql(context));
        const moved = await matchingIds(database, TEXT_MATCH_SQL, NEW_REF);
        const lines = await rowsOf<{ line: string }>(database, 'SELECT line FROM pg_temp."ej_rev_points" ORDER BY n');
        for (const row of lines) {
          await database.exec(row.line);
        }
        const restored = await pointRows(database);
        await database.exec("ROLLBACK");

        expect(moved).toEqual(canonical);
        expect(restored).toEqual(before);
      });
    });

    describe("surplus points (EJL-19)", () => {
      it.each(OLD_REFS)("should count the points the canonical text compare matches for existing reftramo %s as its surplus points", async (oldRef) => {
        const canonical = await matchingIds(database, TEXT_MATCH_SQL, oldRef);
        await database.exec("BEGIN");
        await database.exec('CREATE TEMP TABLE "ej_copy" (copy_id bigint, ref text) ON COMMIT DROP');
        await database.exec('CREATE TEMP TABLE "ej_pair" (copy_id bigint, road_id bigint, renum_old text, renum_new text) ON COMMIT DROP');
        await database.exec('CREATE TEMP TABLE "ej_exist" (id bigint, ref text, idcalle text, name text, type_id text, font_id text) ON COMMIT DROP');
        await database.query('INSERT INTO pg_temp."ej_copy" (copy_id, ref) VALUES (1, $1)', [oldRef]);
        await database.query('INSERT INTO pg_temp."ej_exist" (id, ref, idcalle, name, type_id, font_id) VALUES (501, $1, \'10\', \'CALLE\', \'4\', \'1\')', [
          oldRef,
        ]);

        await database.exec(buildSurplusTableSql(context));
        const surplus = await surplusRowsOf(database);
        await database.exec("ROLLBACK");

        expect(surplus).toEqual([{ id: 501, ref: oldRef, points: canonical.length }]);
      });
    });
  }
);

describe("integer id_road_section SQL shape (EJL-10, EJL-11)", () => {
  let database: PGlite;
  let context: EjesLoadContext;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite, "integer");
    await seedPoints(database, "integer");
    context = await loadContextOn(database);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  it("should compare the column as stored, with the regex and the casts applied to the value only", () => {
    const sql = accessPointRefMatchSql(context, "v.old_ref");

    expect(sql).toBe(INTEGER_MATCH_SQL);
    expect(sql.startsWith(`${CANONICAL_COLUMN} = `)).toBe(true);
    expect(sql).not.toMatch(/btrim|NULLIF|::text/);
  });

  it("should keep the bare integer compare in the move, the revert and the surplus of an integer column", () => {
    const move = buildMovePointsSql(context);
    const revert = buildRevertPointsSql(context, ejesLayouts());
    const surplus = buildSurplusTableSql(context);

    expect(move).toContain('SET "id_road_section" = (n.new_ref)::integer');
    expect(move).toContain(`WHERE a."id_road_section" = CASE WHEN n.old_ref ~ '^(0|-?[1-9][0-9]*)$' THEN`);
    expect(move).not.toMatch(/btrim|NULLIF/);
    expect(revert).toContain(`ON a."id_road_section" = CASE WHEN n.old_ref ~ '^(0|-?[1-9][0-9]*)$' THEN`);
    expect(surplus).toContain(`a."id_road_section" = CASE WHEN e.ref ~ '^(0|-?[1-9][0-9]*)$' THEN`);
  });
});
