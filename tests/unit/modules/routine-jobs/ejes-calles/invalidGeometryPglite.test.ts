import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { buildStagingChecksSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/stagingSql";
import { ejesLayouts } from "./ejesFixtures";

const SETUP_TIMEOUT_MS = 30000;

/** No PostGIS: the geometry is text, empty is '', invalid is 'BAD', collapsed is 'SHORT' (0.0005 m) and 'EDGE' is exactly 0.001 m. */
const SETUP_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS 'SELECT $1 = ''''' LANGUAGE sql;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS 'SELECT $1 <> ''BAD''' LANGUAGE sql;
  CREATE FUNCTION ST_Length(geometry) RETURNS float8 AS 'SELECT CASE $1 WHEN ''SHORT'' THEN 0.0005 WHEN ''EDGE'' THEN 0.001 ELSE 10 END' LANGUAGE sql;
  CREATE FUNCTION ST_AsEWKB(geometry) RETURNS bytea AS 'SELECT convert_to($1::text, ''UTF8'')' LANGUAGE sql;
  CREATE SCHEMA bdj_carto;
  CREATE TABLE bdj_carto.ide_ejesviacirculacion (
    reftramo text, idcalle text, nombre text, tipo_vialidad text, fuente text, localidad text, departamento text, geom geometry
  );
  INSERT INTO bdj_carto.ide_ejesviacirculacion VALUES
    ('1', '10', 'A', 'CALLE', 'MTOP', 'TRINIDAD', 'FLORES', 'LINE'),
    ('2', '20', 'B', 'CALLE', 'MTOP', 'Y LOC', 'FLORES', 'BAD'),
    ('2', '20', 'B', 'CALLE', 'MTOP', 'X LOC', 'FLORES', 'BAD'),
    ('3', '30', 'C', 'CALLE', 'MTOP', 'TRINIDAD', 'FLORES', 'LINE'),
    ('3', '30', 'C', 'CALLE', 'MTOP', 'FLORES RURAL', 'FLORES', 'BAD'),
    ('4', '40', 'D', 'CALLE', 'MTOP', 'TRINIDAD', 'FLORES', NULL),
    ('5', '50', 'E', 'CALLE', 'MTOP', 'TRINIDAD', 'FLORES', ''),
    ('6', '60', 'F', 'CALLE', 'MTOP', 'TRINIDAD', 'FLORES', 'SHORT'),
    ('7', '70', 'G', 'CALLE', 'MTOP', 'TRINIDAD', 'FLORES', 'EDGE');
`;

/** No geometric twin loser is in this file: `stg` reads the losers of the geometric rule, which are none here. */
const NO_GEO_LOSERS_CTE = '"geo_losers" AS (SELECT NULL::text AS ref WHERE false)';

const analysisCtes = (): { stgKeys: string; stg: string } => {
  const sql = buildEjesAnalysisSql(ejesLayouts());
  const keysAt = sql.indexOf('"stg_keys" AS (');
  const stgAt = sql.indexOf('"stg" AS (');
  const stgEnd = sql.indexOf(",\n", stgAt);
  return {
    stgKeys: sql.slice(keysAt, sql.indexOf(",\n", keysAt)),
    stg: `${NO_GEO_LOSERS_CTE}, ${sql.slice(stgAt, stgEnd)}`,
  };
};

describe("invalid geometries against PostgreSQL (ET-18)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(SETUP_SQL);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  it("should keep every reftramo of the file in stg_keys, invalid, empty and null geometries included", async () => {
    const { stgKeys } = analysisCtes();

    const result = await database.query<{ ref: string }>(`WITH ${stgKeys} SELECT ref FROM stg_keys ORDER BY ref`);

    expect(result.rows.map((row) => row.ref)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("should make stg skip the invalid, empty and null geometries and keep the valid row of a reftramo with an invalid copy", async () => {
    const { stg } = analysisCtes();

    const result = await database.query<{ ref: string; localidad: string; geom: string }>(
      `WITH ${stg} SELECT ref, localidad, geom FROM stg ORDER BY ref`
    );

    expect(result.rows).toEqual([
      { ref: "1", localidad: "TRINIDAD", geom: "LINE" },
      { ref: "3", localidad: "TRINIDAD", geom: "LINE" },
      { ref: "7", localidad: "TRINIDAD", geom: "EDGE" },
    ]);
  });

  it("should leave the raw file counts untouched and count the invalid rows and distinct reftramo", async () => {
    const result = await database.query<Record<string, unknown>>(buildStagingChecksSql(ejesLayouts()));
    const row = result.rows[0];

    expect(Number(row.rows)).toBe(9);
    expect(Number(row.distinct_refs)).toBe(7);
    expect(Number(row.repeated_groups)).toBe(2);
    expect(Number(row.repeated_rows)).toBe(4);
    expect(Number(row.empty_geometry)).toBe(2);
    expect(Number(row.invalid_geometry_rows)).toBe(4);
    expect(Number(row.invalid_geometry_refs)).toBe(3);
  });

  it("should list the invalid rows ordered by reftramo and locality, with idcalle and department", async () => {
    const result = await database.query<{ invalid_geometries: unknown }>(buildStagingChecksSql(ejesLayouts()));

    expect(result.rows[0].invalid_geometries).toEqual([
      { ref: "2", idcalle: "20", localidad: "X LOC", departamento: "FLORES" },
      { ref: "2", idcalle: "20", localidad: "Y LOC", departamento: "FLORES" },
      { ref: "3", idcalle: "30", localidad: "FLORES RURAL", departamento: "FLORES" },
      { ref: "6", idcalle: "60", localidad: "TRINIDAD", departamento: "FLORES" },
    ]);
  });

  it("should skip a collapsed row in stg and report it like an invalid one", async () => {
    const { stg } = analysisCtes();

    const kept = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg`);
    const checks = await database.query<{ invalid_geometries: Array<{ ref: string }> }>(buildStagingChecksSql(ejesLayouts()));

    expect(kept.rows.map((row) => row.ref)).not.toContain("6");
    expect(checks.rows[0].invalid_geometries.map((entry) => entry.ref)).toContain("6");
  });

  it("should keep a row whose length is exactly the tolerance", async () => {
    const { stg } = analysisCtes();

    const kept = await database.query<{ ref: string }>(`WITH ${stg} SELECT ref FROM stg`);
    const checks = await database.query<{ invalid_geometries: Array<{ ref: string }> }>(buildStagingChecksSql(ejesLayouts()));

    expect(kept.rows.map((row) => row.ref)).toContain("7");
    expect(checks.rows[0].invalid_geometries.map((entry) => entry.ref)).not.toContain("7");
  });

  it("should still count as present in stg_keys a reftramo whose only rows are collapsed", async () => {
    const { stgKeys } = analysisCtes();

    const result = await database.query<{ ref: string }>(`WITH ${stgKeys} SELECT ref FROM stg_keys WHERE ref = '6'`);

    expect(result.rows).toHaveLength(1);
  });

  it("should not count a null or empty geometry as invalid", async () => {
    const result = await database.query<{ invalid_geometries: Array<{ ref: string }> }>(buildStagingChecksSql(ejesLayouts()));

    expect(result.rows[0].invalid_geometries.map((entry) => entry.ref)).not.toContain("4");
    expect(result.rows[0].invalid_geometries.map((entry) => entry.ref)).not.toContain("5");
  });
});
