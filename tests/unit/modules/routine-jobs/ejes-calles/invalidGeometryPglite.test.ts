import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { buildStagingChecksSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/stagingSql";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertPoints, insertStaging, type StagingRow } from "./ejesLoadHarness";

const SETUP_TIMEOUT_MS = 60_000;

const at = (ref: string, idcalle: string, localidad: string, geom: string | null): StagingRow => ({
  ref,
  calle: idcalle,
  nombre: "CALLE",
  localidad,
  departamento: "FLORES",
  geom,
});

/**
 * Geometries of the harness: "a:b" is a line of length b - a, 'BAD' is invalid, '' is empty, NULL is missing.
 * Ref 3 has one valid copy and one invalid copy; refs 9 and 11 have access points, so a short section of theirs is read by the points.
 */
const FIXTURE: StagingRow[] = [
  at("1", "10", "TRINIDAD", "0:10"),
  at("2", "20", "Y LOC", "BAD"),
  at("2", "20", "X LOC", "BAD"),
  at("3", "30", "TRINIDAD", "0:10"),
  at("3", "30", "FLORES RURAL", "BAD"),
  at("4", "40", "TRINIDAD", null),
  at("5", "50", "TRINIDAD", ""),
  at("6", "60", "TRINIDAD", "0:0.0005"),
  at("7", "70", "TRINIDAD", "0:0.001"),
  at("8", "80", "TRINIDAD", "0:1.5"),
  at("9", "90", "TRINIDAD", "0:0.5"),
  at("10", "100", "TRINIDAD", "0:0.5"),
  at("11", "110", "TRINIDAD", "0:0.0005"),
  at("12", "120", "TRINIDAD", "0:1"),
];

const NO_GEO_LOSERS_CTE = '"geo_losers" AS (SELECT NULL::text AS ref WHERE false)';

const analysisCtes = (): { stgKeys: string; stg: string } => {
  const sql = buildEjesAnalysisSql(ejesLayouts());
  const shortUnheldAt = sql.indexOf('"short_unheld" AS (');
  const shortUnheld = sql.slice(shortUnheldAt, sql.indexOf(",\n", shortUnheldAt));
  const keysAt = sql.indexOf('"stg_keys" AS (');
  const stgAt = sql.indexOf('"stg" AS (');
  const stgEnd = sql.indexOf(",\n", stgAt);
  return {
    stgKeys: `${shortUnheld}, ${sql.slice(keysAt, sql.indexOf(",\n", keysAt))}`,
    stg: `${shortUnheld}, ${NO_GEO_LOSERS_CTE}, ${sql.slice(stgAt, stgEnd)}`,
  };
};

describe("invalid and short geometries against PostgreSQL (ET-18, ET-18a)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await createEjesDatabase(PGlite);
    await insertStaging(database, FIXTURE);
    await insertPoints(database, "9", 1);
    await insertPoints(database, "11", 1);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  describe("stg_keys (ET-18)", () => {
    it("should list in stg_keys only the references with at least one kept row", async () => {
      const { stgKeys } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stgKeys} SELECT ref FROM stg_keys ORDER BY ref`);

      expect(result.rows.map((row) => row.ref)).toEqual(["1", "12", "3", "8", "9"]);
    });

    it("should leave out of stg_keys a reftramo whose only rows are too short, so its section counts as removed", async () => {
      const { stgKeys } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stgKeys} SELECT ref FROM stg_keys WHERE ref IN ('6', '7', '10', '11')`);

      expect(result.rows).toEqual([]);
    });

    it("should leave out of stg_keys a reftramo whose only geometry is null, empty or invalid", async () => {
      const { stgKeys } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stgKeys} SELECT ref FROM stg_keys WHERE ref IN ('2', '4', '5')`);

      expect(result.rows).toEqual([]);
    });
  });

  describe("stg (ET-18, ET-18a)", () => {
    it("should keep one valid row per reftramo and skip the invalid, empty, null, collapsed and short-without-points rows", async () => {
      const { stg } = analysisCtes();

      const result = await database.query<{ ref: string; localidad: string; geom: string }>(
        `WITH ${stg} SELECT ref, localidad, geom FROM stg ORDER BY ref`
      );

      expect(result.rows).toEqual([
        { ref: "1", localidad: "TRINIDAD", geom: "0:10" },
        { ref: "12", localidad: "TRINIDAD", geom: "0:1" },
        { ref: "3", localidad: "TRINIDAD", geom: "0:10" },
        { ref: "8", localidad: "TRINIDAD", geom: "0:1.5" },
        { ref: "9", localidad: "TRINIDAD", geom: "0:0.5" },
      ]);
    });

    it("should keep a section of 1.5 m with no access point", async () => {
      const { stg } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg WHERE ref = '8'`);

      expect(result.rows).toHaveLength(1);
    });

    it("should discard a section of 0.5 m with no access point", async () => {
      const { stg } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg WHERE ref = '10'`);

      expect(result.rows).toEqual([]);
    });

    it("should keep a section of 0.5 m whose reftramo has an access point", async () => {
      const { stg } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg WHERE ref = '9'`);

      expect(result.rows).toHaveLength(1);
    });

    it("should discard a section of 0.0005 m even when its reftramo has an access point", async () => {
      const { stg } = analysisCtes();

      const result = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg WHERE ref IN ('6', '11')`);

      expect(result.rows).toEqual([]);
    });

    it("should keep a section of exactly 1 m and discard one of exactly the 0.001 m tolerance without access points", async () => {
      const { stg } = analysisCtes();

      const kept = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg WHERE ref = '12'`);
      const discarded = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg WHERE ref = '7'`);

      expect(kept.rows).toHaveLength(1);
      expect(discarded.rows).toEqual([]);
    });
  });

  describe("buildStagingChecksSql counts and list (ET-18)", () => {
    it("should leave the raw file counts untouched and count the discarded rows and distinct reftramo", async () => {
      const result = await database.query<Record<string, unknown>>(buildStagingChecksSql(ejesLayouts()));
      const row = result.rows[0];

      expect(Number(row.rows)).toBe(14);
      expect(Number(row.distinct_refs)).toBe(12);
      expect(Number(row.repeated_groups)).toBe(2);
      expect(Number(row.repeated_rows)).toBe(4);
      expect(Number(row.empty_geometry)).toBe(2);
      expect(Number(row.invalid_geometry_rows)).toBe(7);
      expect(Number(row.invalid_geometry_refs)).toBe(6);
    });

    it("should list the discarded rows ordered by reftramo and locality, with idcalle and department", async () => {
      const result = await database.query<{ invalid_geometries: unknown }>(buildStagingChecksSql(ejesLayouts()));

      expect(result.rows[0].invalid_geometries).toEqual([
        { ref: "10", idcalle: "100", localidad: "TRINIDAD", departamento: "FLORES" },
        { ref: "11", idcalle: "110", localidad: "TRINIDAD", departamento: "FLORES" },
        { ref: "2", idcalle: "20", localidad: "X LOC", departamento: "FLORES" },
        { ref: "2", idcalle: "20", localidad: "Y LOC", departamento: "FLORES" },
        { ref: "3", idcalle: "30", localidad: "FLORES RURAL", departamento: "FLORES" },
        { ref: "6", idcalle: "60", localidad: "TRINIDAD", departamento: "FLORES" },
        { ref: "7", idcalle: "70", localidad: "TRINIDAD", departamento: "FLORES" },
      ]);
    });

    it("should report a collapsed row and a short row without points like an invalid one", async () => {
      const result = await database.query<{ invalid_geometries: Array<{ ref: string }> }>(buildStagingChecksSql(ejesLayouts()));
      const refs = result.rows[0].invalid_geometries.map((entry) => entry.ref);

      expect(refs).toEqual(expect.arrayContaining(["6", "7", "10", "11"]));
    });

    it("should not report a section of 1 m or a short section with access points as invalid", async () => {
      const result = await database.query<{ invalid_geometries: Array<{ ref: string }> }>(buildStagingChecksSql(ejesLayouts()));
      const refs = result.rows[0].invalid_geometries.map((entry) => entry.ref);

      expect(refs).not.toContain("12");
      expect(refs).not.toContain("9");
      expect(refs).not.toContain("8");
    });

    it("should not count a null or empty geometry as invalid", async () => {
      const result = await database.query<{ invalid_geometries: Array<{ ref: string }> }>(buildStagingChecksSql(ejesLayouts()));
      const refs = result.rows[0].invalid_geometries.map((entry) => entry.ref);

      expect(refs).not.toContain("4");
      expect(refs).not.toContain("5");
    });
  });
});
