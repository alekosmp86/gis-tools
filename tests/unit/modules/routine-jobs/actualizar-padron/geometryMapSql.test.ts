import { describe, expect, it } from "vitest";
import { newGeometrySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/geometryMap";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import type { GeometryMapStagingKey } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const SRID = 32721;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const STAGING: TableLayout = {
  schema: "stg",
  table: "padron_staging",
  columns: identityOf(["unidadcat", "nomdepto", "nomloccat", "padron", "geom"]),
};

const TARGET: WritableTargetLayout = {
  schema: "carto",
  table: "padron",
  columns: identityOf(["id", "number", "type_padron", "id_cadastral_locality", "id_province", "geometry"]),
  srid: SRID,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const RURAL_KEY: GeometryMapStagingKey = { typePadron: "RURAL", department: "MONTEVIDEO", locality: null, number: "100" };

/* The staging geometry is made valid and reduced to its polygonal part inside the matched CTE, before the union reads it. */
const WRAPPED_STAGING_GEOMETRY =
  'ST_CollectionExtract(ST_MakeValid(CASE WHEN ST_SRID(s."geom") = 32721 THEN s."geom" ELSE ST_Transform(s."geom", 32721) END), 3) AS geom';

describe("geometryMap newGeometrySql (new padron outline)", () => {
  it("should wrap each staging geometry in ST_CollectionExtract(ST_MakeValid(...)) before the union", () => {
    const sql = newGeometrySql(STAGING, TARGET, RURAL_KEY);

    expect(sql).toContain(WRAPPED_STAGING_GEOMETRY);
    expect(sql.indexOf(WRAPPED_STAGING_GEOMETRY)).toBeLessThan(sql.indexOf("ST_Union(geom)"));
  });

  it("should place the wrapped geometry inside the matched CTE and union only that CTE's geometries", () => {
    const sql = newGeometrySql(STAGING, TARGET, RURAL_KEY);

    const matchedStart = sql.indexOf("WITH matched AS (");
    const wrappedAt = sql.indexOf(WRAPPED_STAGING_GEOMETRY);
    expect(matchedStart).toBeGreaterThan(-1);
    expect(wrappedAt).toBeGreaterThan(matchedStart);
    expect(sql).toContain("SELECT ST_Union(geom) AS u FROM matched) AS merged");
    expect(sql).not.toMatch(/ST_Union\(s\./);
  });
});
