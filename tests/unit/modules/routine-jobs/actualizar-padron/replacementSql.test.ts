import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import {
  missingReviewSql,
  referenceCountCtes,
  referenceJoinSql,
  referenceTablesScanSql,
  referenceTotalColumnSql,
  type ReferenceTable,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const NO_REFERENCE_TABLES: readonly ReferenceTable[] = [];
const SCHEMA = "carto";
const OTHER_SCHEMA = "other_schema";
const TARGET_TABLE = "padron";

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf(SCHEMA, TARGET_TABLE, Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf(SCHEMA, "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf(SCHEMA, "loc", Object.values(LOCALITY_COLUMN)),
};

const ONE_REFERENCE_TABLE: readonly ReferenceTable[] = [{ schema: SCHEMA, table: "access_point" }];
const TWO_REFERENCE_TABLES: readonly ReferenceTable[] = [
  { schema: SCHEMA, table: "access_point" },
  { schema: SCHEMA, table: "internal_address_point" },
];

describe("referenceTablesScanSql (AP-102 catalog scan)", () => {
  it("should bind the given schema as a parameter via literal(), never the literal 'carto'", () => {
    const sql = referenceTablesScanSql(OTHER_SCHEMA, TARGET_TABLE);

    expect(sql).toContain(`n.nspname = '${OTHER_SCHEMA}'`);
    expect(sql).not.toContain("'carto'");
  });

  it("should still bind a schema literally equal to carto as data, not as a hardcoded identifier", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain(`n.nspname = '${SCHEMA}'`);
  });

  it("should filter out the destination table by name", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain(`c.relname <> '${TARGET_TABLE}'`);
  });

  it("should match only the id_padron column", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("a.attname = 'id_padron'");
    expect(sql).toContain("a.attnum > 0 AND NOT a.attisdropped");
  });

  it("should include the numeric-type filter on the column's type, so a non-numeric id_padron column never reaches the count query", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype, 'numeric'::regtype)");
  });

  it("should restrict to ordinary and partitioned tables only", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("c.relkind IN ('r', 'p')");
  });

  it("should report whether the role can SELECT the id_padron column, so an unreadable table is not read as zero references", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("has_column_privilege(c.oid, a.attnum, 'SELECT') AS \"readable\"");
  });

  it("should read pg_catalog only and never count or scan a reference table's own rows", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("pg_catalog.pg_class");
    expect(sql).toContain("pg_catalog.pg_namespace");
    expect(sql).toContain("pg_catalog.pg_attribute");
    const sources = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([^\s(]+)/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((source) => source !== "LATERAL").every((source) => source.startsWith("pg_catalog."))).toBe(true);
  });

  it("should report whether the role can UPDATE the id_padron column (AP-110)", () => {
    expect(referenceTablesScanSql(SCHEMA, TARGET_TABLE)).toContain("has_column_privilege(c.oid, a.attnum, 'UPDATE') AS \"updatable\"");
  });

  it("should count the primary key columns from pg_index.indisprimary, ignoring dropped columns (AP-110)", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("pg_catalog.pg_index");
    expect(sql).toContain("i.indisprimary");
    expect(sql).toContain("NOT pa.attisdropped");
    expect(sql).toContain('pk.pk_columns AS "pk_columns"');
    expect(sql).toContain('pk.pk_column AS "pk_column"');
  });

  it("should count the geometry and geography columns and name their type (AP-110)", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("gt.typname IN ('geometry', 'geography')");
    expect(sql).toContain("NOT ga.attisdropped");
    expect(sql).toContain('geo.geometry_columns AS "geometry_columns"');
    expect(sql).toContain('geo.geometry_column AS "geometry_column"');
    expect(sql).toContain('geo.geometry_type AS "geometry_type"');
  });

  it("should map each REFERENCE_POINT_SOURCES entry through a VALUES list joined by the referencing table name (AP-110)", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("LEFT JOIN (VALUES ('access_point', 'address', 'id', 'id')) AS pm(ref_table, companion_table, ref_column, companion_column) ON pm.ref_table = c.relname::text");
    expect(sql).toContain("LEFT JOIN pg_catalog.pg_class c2 ON c2.relnamespace = n.oid AND c2.relname = pm.companion_table AND c2.relkind IN ('r', 'p')");
  });

  it("should return the companion facts as columns the scan row mapping reads (AP-110)", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    for (const column of [
      "companion_table",
      "companion_column",
      "companion_ref_column",
      "companion_pk_columns",
      "companion_pk_column",
      "companion_geometry_columns",
      "companion_geometry_column",
      "companion_geometry_type",
      "companion_readable",
      "companion_join_columns",
    ]) {
      expect(sql, column).toContain(`AS "${column}"`);
    }
  });

  it("should read the companion's SELECT privilege and count both join columns from the catalog, never user input", () => {
    const sql = referenceTablesScanSql(SCHEMA, TARGET_TABLE);

    expect(sql).toContain("CASE WHEN c2.oid IS NULL THEN false ELSE has_table_privilege(c2.oid, 'SELECT') END AS \"companion_readable\"");
    expect(sql).toContain("ja.attrelid = c.oid AND ja.attname = pm.ref_column");
    expect(sql).toContain("ja.attrelid = c2.oid AND ja.attname = pm.companion_column");
  });

  it("should bind the schema and the excluded table as literals so a hostile name cannot add SQL", () => {
    const sql = referenceTablesScanSql("ca'rto", "pa'dron");

    expect(sql).toContain("n.nspname = 'ca''rto'");
    expect(sql).toContain("c.relname <> 'pa''dron'");
  });
});

describe("referenceCountCtes (shared by AP-96's refs and AP-103's eligibility)", () => {
  const IDS_CTE = "missing_target_ids";
  const ID_COLUMN = "old_id";

  it("should return exactly two CTEs: the raw per-table counts and the aggregated total and by-table json", () => {
    const ctes = referenceCountCtes("removal_refs", IDS_CTE, ID_COLUMN, ONE_REFERENCE_TABLE);

    expect(ctes).toHaveLength(2);
    expect(ctes[0]).toContain('"removal_refs_raw" AS (');
    expect(ctes[1]).toContain('"removal_refs" AS (');
  });

  it("should produce a typed empty raw set when there is no reference table, contributing no row and never an error", () => {
    const [raw] = referenceCountCtes("removal_refs", IDS_CTE, ID_COLUMN, NO_REFERENCE_TABLES);

    expect(raw).toContain("CAST(NULL AS integer)");
    expect(raw).toContain("WHERE false");
    expect(raw).not.toMatch(/UNION ALL/);
  });

  it("should produce one grouped aggregate per discovered table, joined by UNION ALL, over the ids CTE and never one query per listed row", () => {
    const [raw] = referenceCountCtes("removal_refs", IDS_CTE, ID_COLUMN, TWO_REFERENCE_TABLES);

    expect(raw.match(/GROUP BY/g)).toHaveLength(2);
    expect(raw).toContain("UNION ALL");
    expect(raw).toContain(`FROM "${SCHEMA}"."access_point"`);
    expect(raw).toContain(`FROM "${SCHEMA}"."internal_address_point"`);
    expect(raw).toContain(`FROM "${IDS_CTE}"`);
    expect(raw).not.toMatch(/\(\s*SELECT\s+count\(\*\)\s+FROM[\s\S]*WHERE[\s\S]*\bid_padron\b[\s\S]*=\s*\$/i);
  });

  it("should aggregate the raw rows into one total and one by-table json object per id", () => {
    const [, agg] = referenceCountCtes("removal_refs", IDS_CTE, ID_COLUMN, ONE_REFERENCE_TABLE);

    expect(agg).toContain('sum("refs") AS "total"');
    expect(agg).toContain('json_object_agg("table_label", "refs") AS "by_table"');
    expect(agg).toContain('GROUP BY "old_id"');
  });
});

describe("referenceJoinSql / referenceTotalColumnSql", () => {
  it("should left join the named reference CTE on its old_id against the given id expression", () => {
    expect(referenceJoinSql("missing_refs", `"listed"."oldId"`)).toBe(
      `LEFT JOIN "missing_refs" ON "missing_refs"."old_id" = "listed"."oldId"`
    );
  });

  it("should coalesce a joined total to zero", () => {
    expect(referenceTotalColumnSql("missing_refs")).toBe(`COALESCE("missing_refs"."total", 0)`);
  });

});

describe("missingReviewSql reference columns (AP-96's refs, {total, byTable})", () => {
  const sql = missingReviewSql(LAYOUTS);

  it("should add the refsTotal and refsByTable output columns in place of the old accessPointRefs/addressesRefs columns", () => {
    expect(sql).toContain('AS "refsTotal"');
    expect(sql).toContain('AS "refsByTable"');
    expect(sql).not.toContain("accessPointRefs");
    expect(sql).not.toContain("addressesRefs");
  });

  it("should read the classify chain's removal_refs, coalesced to zero and an empty object, instead of counting by itself", () => {
    expect(sql).toContain('LEFT JOIN "removal_refs"');
    expect(sql).toContain('COALESCE("removal_refs"."total", 0)');
    expect(sql).toContain("COALESCE(\"removal_refs\".\"by_table\", '{}'::json)");
    expect(sql).not.toContain("GROUP BY");
  });

  it("should expose the removalReason of the classify chain's verdicts, null when the padron will be deleted", () => {
    expect(sql).toContain('LEFT JOIN "removal_verdicts" AS rv ON rv."old_id" = listed."oldId"');
    expect(sql).toContain('rv."reason" AS "removalReason"');
  });

  it("should cap the listed rows at DETAIL_LIST_LIMIT and order by class, department, locality and number", () => {
    expect(sql).toContain("LIMIT 500");
    expect(sql).toMatch(/ORDER BY[^)]*"department"[^)]*"locality"[^)]*"number"/);
  });
});

describe("referenceCountCtes block_reason and blockers (AP-110)", () => {
  const reassignable: ReferenceTable = {
    schema: SCHEMA,
    table: "access_point",
    reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false },
  };
  const blocked: ReferenceTable = { schema: SCHEMA, table: "audit_log", reassignBlocker: "sin clave primaria de una sola columna" };

  const withCompanion: ReferenceTable = {
    schema: SCHEMA,
    table: "access_point",
    reassign: {
      pkColumn: "id",
      geometryColumn: "geometry",
      geography: false,
      companion: { schema: SCHEMA, table: "address", column: "id", companionColumn: "id" },
    },
  };

  it("should never block a reassignable table, even for rows with a NULL or empty point (AP-111)", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", [reassignable]);

    expect(raw).toContain('CAST(NULL AS text) AS "block_reason"');
    expect(raw).not.toContain("tiene filas sin geometría");
    expect(raw).not.toContain("IS NULL OR ST_IsEmpty(rt0.\"geom\"::geometry)) > 0");
  });

  it("should count the rows without a usable point per table as no_point, over the table's own geometry", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", [reassignable]);

    expect(raw).toContain(
      'count(*) FILTER (WHERE CASE WHEN rt0."geom" IS NULL OR ST_IsEmpty(rt0."geom") THEN NULL WHEN ST_GeometryType(rt0."geom") = \'ST_Point\' THEN rt0."geom" ELSE ST_PointOnSurface(rt0."geom") END IS NULL) AS "no_point"'
    );
    expect(raw).toContain('FROM "carto"."access_point" AS rt0  WHERE');
  });

  it("should count no_point over the LEFT JOINed companion geometry when the table has no point of its own", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", [withCompanion]);

    expect(raw).toContain('FROM "carto"."access_point" AS rt0 LEFT JOIN "carto"."address" AS rt0c ON rt0c."id" = rt0."id" WHERE');
    expect(raw).toContain('CASE WHEN rt0c."geometry" IS NULL OR ST_IsEmpty(rt0c."geometry") THEN NULL');
    expect(raw).toContain('IS NULL) AS "no_point"');
    expect(raw).toContain('CAST(NULL AS text) AS "block_reason"');
  });

  it("should cast a geography point to geometry before testing it", () => {
    const geography: ReferenceTable = { schema: SCHEMA, table: "g", reassign: { pkColumn: "gid", geometryColumn: "geog", geography: true } };

    const [raw] = referenceCountCtes("r", "ids", "old_id", [geography]);

    expect(raw).toContain('rt0."geog"::geometry IS NULL OR ST_IsEmpty(rt0."geog"::geometry)');
  });

  it("should count zero no_point rows for a table that cannot be reassigned, and add no join", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", [blocked]);

    expect(raw).toContain('CAST(0 AS bigint) AS "no_point"');
    expect(raw).not.toContain("LEFT JOIN");
  });

  it("should type the empty raw set with the no_point column too", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", []);

    expect(raw).toContain('CAST(NULL AS bigint) AS "no_point"');
  });

  it("should report the table's own blocker as a constant for every id of a table that cannot be reassigned", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", [blocked]);

    expect(raw).toContain("CAST('sin clave primaria de una sola columna' AS text) AS \"block_reason\"");
    expect(raw).not.toContain("ST_IsEmpty");
    expect(raw).not.toContain("tiene filas sin geometría");
  });

  it("should fall back to the no-primary-key reason when a table carries neither a target nor a blocker (fail closed)", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", [{ schema: SCHEMA, table: "bare" }]);

    expect(raw).toContain("CAST('sin clave primaria de una sola columna' AS text) AS \"block_reason\"");
  });

  it("should type the empty raw set with the block_reason column too", () => {
    const [raw] = referenceCountCtes("r", "ids", "old_id", []);

    expect(raw).toContain('CAST(NULL AS text) AS "block_reason"');
  });

  it("should aggregate the number of blocking tables and a table to reason json object, empty when none", () => {
    const [, agg] = referenceCountCtes("r", "ids", "old_id", [reassignable, blocked]);

    expect(agg).toContain('count("block_reason") AS "blocked"');
    expect(agg).toContain(`COALESCE(json_object_agg("table_label", "block_reason") FILTER (WHERE "block_reason" IS NOT NULL), '{}'::json) AS "blockers"`);
  });

  it("should expose reassignBlockers in the missing review rows from the removal refs, coalesced to an empty object", () => {
    expect(missingReviewSql(LAYOUTS)).toContain(`COALESCE("removal_refs"."blockers", '{}'::json) AS "reassignBlockers"`);
  });
});
