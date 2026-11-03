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
    expect(sql).not.toMatch(/count\(/i);
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
