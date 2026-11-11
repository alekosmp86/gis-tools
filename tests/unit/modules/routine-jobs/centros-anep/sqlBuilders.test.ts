import { describe, expect, it } from "vitest";
import { planColumns } from "@/modules/routine-jobs/jobs/centros-anep/domain/columnPlan";
import {
  buildAnalyzeFinalSql,
  buildDeleteFinalSql,
  buildInsertFromStagingSql,
  buildLockFinalSql,
  buildRevertHeadSql,
  buildRevertInsertHead,
  buildRevertPageSql,
  REVERT_TAIL_SQL,
  revertColumnsOf,
} from "@/modules/routine-jobs/jobs/centros-anep/domain/replaceSql";
import { buildFinalCountsSql, buildStagingChecksSql } from "@/modules/routine-jobs/jobs/centros-anep/domain/stagingSql";
import { finalCatalog, finalLayout, stagingCatalog, stagingLayout } from "./centrosFixtures";

const planOf = () =>
  planColumns({
    stagingCatalog: stagingCatalog(),
    finalCatalog: finalCatalog(),
    stagingGeometry: "geom",
    finalGeometry: "geom",
    identityColumns: [],
  });

describe("replace SQL builders (CA-11, CA-13)", () => {
  it("should lock the final table in SHARE ROW EXCLUSIVE mode", () => {
    expect(buildLockFinalSql(finalLayout())).toBe('LOCK TABLE "carto"."ine_centros_anep" IN SHARE ROW EXCLUSIVE MODE');
  });

  it("should delete with DELETE and never TRUNCATE, counting the deleted rows", () => {
    const sql = buildDeleteFinalSql(finalLayout());

    expect(sql).toContain('DELETE FROM "carto"."ine_centros_anep"');
    expect(sql).toContain('AS "deleted"');
    expect(sql.toUpperCase()).not.toContain("TRUNCATE");
  });

  it("should insert from staging by name, transforming only the geometry to the final SRID", () => {
    const sql = buildInsertFromStagingSql(stagingLayout(), finalLayout(32721), planOf());

    expect(sql).toContain('INSERT INTO "carto"."ine_centros_anep"');
    expect(sql).toContain('FROM "bdj_carto"."ine_centros_anep" AS s');
    expect(sql).toContain('ST_Transform(s."geom", 32721)');
    expect(sql).toContain('s."ruee"');
    expect(sql).toContain('AS "inserted"');
    expect(sql.match(/ST_Transform/g)).toHaveLength(1);
  });

  it("should not insert the serial id column", () => {
    const sql = buildInsertFromStagingSql(stagingLayout(), finalLayout(), planOf());

    expect(sql).not.toContain('"id"');
  });

  it("should read the SRID from the final layout and never use a literal", () => {
    const sql = buildInsertFromStagingSql(stagingLayout(), finalLayout(4326), planOf());

    expect(sql).toContain('ST_Transform(s."geom", 4326)');
    expect(sql).not.toContain("32721, ");
    expect(sql).not.toContain("ST_Transform(s.\"geom\", 32721)");
  });

  it("should list the target columns in the same order as the source expressions", () => {
    const sql = buildInsertFromStagingSql(stagingLayout(), finalLayout(), planOf());

    expect(sql).toContain('("geom", "ruee", "x", "y", "subsistema", "nombre", "depto", "rule_est")');
  });

  it("should analyze the final table", () => {
    expect(buildAnalyzeFinalSql(finalLayout())).toMatch(/^ANALYZE /);
    expect(buildAnalyzeFinalSql(finalLayout())).toContain("ine_centros_anep");
  });
});

describe("revert SQL builders (CA-12)", () => {
  it("should open a transaction and empty the final table before the inserts", () => {
    expect(buildRevertHeadSql(finalLayout())).toEqual(["BEGIN;", 'DELETE FROM "carto"."ine_centros_anep";']);
    expect(REVERT_TAIL_SQL).toBe("COMMIT;");
  });

  it("should restore every column, id included, with OVERRIDING SYSTEM VALUE", () => {
    const head = buildRevertInsertHead(finalLayout());

    expect(revertColumnsOf(finalLayout())).toEqual(["id", "ruee", "x", "y", "subsistema", "nombre", "depto", "rule_est", "geom"]);
    expect(head).toBe(
      'INSERT INTO "carto"."ine_centros_anep" ("id", "ruee", "x", "y", "subsistema", "nombre", "depto", "rule_est", "geom") OVERRIDING SYSTEM VALUE VALUES'
    );
  });

  it("should page by ctid with format(%L) so values are quoted by the server", () => {
    const first = buildRevertPageSql(finalLayout(), 500, false);
    const next = buildRevertPageSql(finalLayout(), 500, true);

    expect(first).toContain("format('(%L, %L, %L, %L, %L, %L, %L, %L, %L)'");
    expect(first).toContain("ORDER BY ctid LIMIT 500");
    expect(first).not.toContain("WHERE ctid");
    expect(next).toContain("WHERE ctid > $1::tid");
  });
});

describe("staging check SQL (CA-8, CA-9)", () => {
  it("should reference the staging table and count every check", () => {
    const sql = buildStagingChecksSql(stagingLayout().layout, ["nombre", "subsistema"]);

    for (const alias of ['"rows"', '"empty_geometry"', '"null_ruee"', '"null_subsistema"', '"damaged_text_rows"', '"repeated_groups"', '"repeated_rows"', '"repeated_ruee"', '"by_subsistema"']) {
      expect(sql).toContain(alias);
    }
    expect(sql).toContain('FROM "bdj_carto"."ine_centros_anep" AS s');
    expect(sql).toContain("ST_IsEmpty");
    expect(sql).toContain("chr(65533)");
    expect(sql).toContain('s."nombre"');
  });

  it("should not search for U+FFFD when the staging has no text column", () => {
    const sql = buildStagingChecksSql(stagingLayout().layout, []);

    expect(sql).not.toContain("chr(65533)");
    expect(sql).toContain("false AS damaged_text");
  });

  it("should never write", () => {
    const sql = buildStagingChecksSql(stagingLayout().layout, ["nombre"]) + buildFinalCountsSql(finalLayout());

    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
  });

  it("should count the final table by subsistema", () => {
    const sql = buildFinalCountsSql(finalLayout());

    expect(sql).toContain('FROM "carto"."ine_centros_anep"');
    expect(sql).toContain('"by_subsistema"');
    expect(sql).toContain('"rows"');
  });
});
