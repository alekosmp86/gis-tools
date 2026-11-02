import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import {
  missingReviewSql,
  NO_REFERENCE_TABLES,
  referenceTablesProbeSql,
  type ReferenceTableFlags,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const SCHEMA = "carto";
const REFERENCE_ID_COLUMN = '"id_padron"';
const GROUPED_REFERENCE_COUNT = /GROUP BY ar\."id_padron"/g;
const REFERENCE_COUNT_COLUMN = /count\(\*\) AS "refs"/g;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf(SCHEMA, "padron", Object.values(DESTINATION_COLUMN)),
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

const BOTH_REFERENCES: ReferenceTableFlags = { accessPoint: true, addresses: true };

describe("referenceTablesProbeSql (reference table probe)", () => {
  it("should test the id_padron column against the integer types and numeric", () => {
    const sql = referenceTablesProbeSql(SCHEMA);

    expect(sql).toContain("attname = 'id_padron'");
    expect(sql).toContain("atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype, 'numeric'::regtype)");
  });

  it("should read the catalog only and never count or scan a reference table's rows", () => {
    const sql = referenceTablesProbeSql(SCHEMA);

    expect(sql).toContain("pg_attribute");
    expect(sql).toContain("has_table_privilege");
    expect(sql).not.toMatch(/count\(/i);
  });
});

describe("missingReviewSql reference counts (one grouped aggregate per table)", () => {
  it("should count each reference table with exactly one grouped aggregate over the listed old ids", () => {
    const sql = missingReviewSql(LAYOUTS, BOTH_REFERENCES);

    expect(sql.match(GROUPED_REFERENCE_COUNT)).toHaveLength(2);
    expect(sql.match(REFERENCE_COUNT_COLUMN)).toHaveLength(2);
    expect(sql).toContain(`WHERE ar.${REFERENCE_ID_COLUMN} IN (SELECT "listed"."oldId" FROM "listed")`);
    expect(sql).toContain(`FROM "${SCHEMA}"."access_point" AS ar`);
    expect(sql).toContain(`FROM "${SCHEMA}"."addresses_2_0_edit" AS ar`);
  });

  it("should join each grouped count to the listed rows and never compute a count per listed row", () => {
    const sql = missingReviewSql(LAYOUTS, BOTH_REFERENCES);

    expect(sql.match(/LEFT JOIN "access_point_refs"/g)).toHaveLength(1);
    expect(sql.match(/LEFT JOIN "addresses_refs"/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\(\s*SELECT\s+count\(\*\)/i);
  });

  it("should count only the reference tables that the probe found", () => {
    const sql = missingReviewSql(LAYOUTS, { accessPoint: true, addresses: false });

    expect(sql.match(GROUPED_REFERENCE_COUNT)).toHaveLength(1);
    expect(sql).toContain('AS "accessPointRefs"');
    expect(sql).not.toContain('"addressesRefs"');
  });

  it("should add no reference aggregate and no reference column when no reference table exists", () => {
    const sql = missingReviewSql(LAYOUTS, NO_REFERENCE_TABLES);

    expect(sql).not.toMatch(/GROUP BY/);
    expect(sql).not.toContain('"accessPointRefs"');
    expect(sql).not.toContain('"addressesRefs"');
  });
});
