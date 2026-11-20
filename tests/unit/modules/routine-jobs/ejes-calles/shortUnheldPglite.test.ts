import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { buildStagingChecksSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/stagingSql";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertPoints, insertStaging, type StagingRow } from "./ejesLoadHarness";

const SETUP_TIMEOUT_MS = 60_000;

const NO_GEO_LOSERS_CTE = '"geo_losers" AS (SELECT NULL::text AS ref WHERE false)';

const stagedRow = (ref: string | null, calle: string, geom: string): StagingRow => ({
  ref,
  calle,
  nombre: "CALLE",
  localidad: "TRINIDAD",
  departamento: "FLORES",
  geom,
});

/** The short_unheld CTE and the stg CTE of the analysis, runnable on their own. */
const stgQuery = (): string => {
  const sql = buildEjesAnalysisSql(ejesLayouts());
  const shortUnheldAt = sql.indexOf('"short_unheld" AS (');
  const shortUnheld = sql.slice(shortUnheldAt, sql.indexOf(",\n", shortUnheldAt));
  const stgAt = sql.indexOf('"stg" AS (');
  const stg = sql.slice(stgAt, sql.indexOf(",\n", stgAt));
  return `WITH ${shortUnheld}, ${NO_GEO_LOSERS_CTE}, ${stg} SELECT ref FROM stg ORDER BY ref`;
};

describe("short sections against PostgreSQL, short_unheld rewrite (ET-18)", () => {
  describe("a short section with and without access points, a null reference, and a section of 1 m", () => {
    let database: PGlite;

    beforeAll(async () => {
      database = await createEjesDatabase(PGlite);
      await insertStaging(database, [
        stagedRow("21", "210", "0:0.5"),
        stagedRow("22", "220", "0:0.5"),
        stagedRow(null, "230", "0:0.5"),
        stagedRow("23", "240", "0:1"),
      ]);
      await insertPoints(database, "21", 1);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await database.close();
    });

    it("should keep a section shorter than 1 m whose reftramo has an access point, and discard the same length without one", async () => {
      const result = await database.query<{ ref: string }>(stgQuery());

      expect(result.rows.map((row) => row.ref)).toEqual(["21", "23"]);
    });

    it("should report a short section with a null reftramo as invalid, next to the short section without points", async () => {
      const result = await database.query<Record<string, unknown>>(buildStagingChecksSql(ejesLayouts()));
      const row = result.rows[0];

      expect(Number(row.invalid_geometry_rows)).toBe(2);
      expect(row.invalid_geometries).toEqual([
        { ref: "22", idcalle: "220", localidad: "TRINIDAD", departamento: "FLORES" },
        { ref: null, idcalle: "230", localidad: "TRINIDAD", departamento: "FLORES" },
      ]);
    });

    it("should not report a section of exactly 1 m as invalid", async () => {
      const result = await database.query<{ invalid_geometries: Array<{ ref: string | null }> }>(buildStagingChecksSql(ejesLayouts()));

      expect(result.rows[0].invalid_geometries.map((entry) => entry.ref)).not.toContain("23");
    });
  });

  describe("a null-reference short section when no other short section is unheld", () => {
    let database: PGlite;

    beforeAll(async () => {
      database = await createEjesDatabase(PGlite);
      await insertStaging(database, [stagedRow(null, "310", "0:0.5"), stagedRow("31", "320", "0:2")]);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await database.close();
    });

    it("should report the null-reference short section as invalid, as the IN form did, while short_unheld is empty", async () => {
      const result = await database.query<Record<string, unknown>>(buildStagingChecksSql(ejesLayouts()));

      expect(Number(result.rows[0].invalid_geometry_rows)).toBe(1);
      expect(result.rows[0].invalid_geometries).toEqual([{ ref: null, idcalle: "310", localidad: "TRINIDAD", departamento: "FLORES" }]);
    });

    it("should discard the null-reference short section from stg", async () => {
      const result = await database.query<{ ref: string }>(stgQuery());

      expect(result.rows.map((row) => row.ref)).toEqual(["31"]);
    });
  });
});
