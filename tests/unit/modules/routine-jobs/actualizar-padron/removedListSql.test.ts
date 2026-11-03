import { describe, expect, it } from "vitest";
import { LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { buildCreateDeleteIdsTableSql, DELETE_IDS_ID_COLUMN, DELETE_IDS_TABLE_SQL } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { removedListSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/removedListSql";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const identity = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({ schema, table, columns: identity(columns) });

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: {
    ...tableOf("carto", "padron", ["id", "type_padron", "id_cadastral_locality", "id_province", "number", "geometry"]),
    srid: 32721,
    idColumn: "id",
    idSequence: "carto.padron_id_seq",
    identityColumns: [],
    catalog: [],
  } as WritableTargetLayout,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "cadastral_locality", Object.values(LOCALITY_COLUMN)),
};

describe("removedListSql (AP-108)", () => {
  const sql = removedListSql(LAYOUTS, "SELECT * FROM somewhere");

  it("should cap the list at DETAIL_LIST_LIMIT", () => {
    expect(sql).toContain(`LIMIT ${DETAIL_LIST_LIMIT}`);
    expect(DETAIL_LIST_LIMIT).toBe(500);
  });

  it("should order by department, locality, number and id so the cut is deterministic", () => {
    expect(sql).toContain('ORDER BY "department", "locality", "number", "id"');
  });

  it("should name the output keys the report reads, with the destination's own names for department and locality", () => {
    for (const key of ["id", "typePadron", "provinceId", "department", "localityId", "locality", "number"]) {
      expect(sql, key).toContain(`AS "${key}"`);
    }
  });

  it("should keep a removed padron whose province or locality is not found, by left joining the names", () => {
    expect(sql).toContain('LEFT JOIN "carto"."province" AS prov');
    expect(sql).toContain('LEFT JOIN "carto"."cadastral_locality" AS loc');
    expect(sql).not.toMatch(/\bINNER JOIN\b|(?<!LEFT )\bJOIN\b/);
  });

  it("should wrap the caller's select as its source, whatever it is", () => {
    expect(sql).toContain("FROM (SELECT * FROM somewhere) AS rm");
  });

  it("should return the rows as a json array named removed_list", () => {
    expect(sql).toContain("removed_list");
    expect(sql).toMatch(/json_agg/);
  });
});

describe("deleteIdsTable (AP-106)", () => {
  it("should create a session temp table with an integer primary key that drops at COMMIT or ROLLBACK", () => {
    expect(buildCreateDeleteIdsTableSql()).toBe('CREATE TEMP TABLE "padron_delete_ids" ("id" integer PRIMARY KEY) ON COMMIT DROP;');
  });

  it("should address the temp table through pg_temp so another schema's table of the same name is never touched", () => {
    expect(DELETE_IDS_TABLE_SQL).toBe('pg_temp."padron_delete_ids"');
    expect(DELETE_IDS_ID_COLUMN).toBe("id");
  });
});
