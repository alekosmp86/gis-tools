import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { type ReferenceTable } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { revertColumnList } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const identity = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identity(columns),
});

const targetLayout: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const layouts: PadronLayouts = {
  staging: tableOf("stg", "catastro_paispadron_stg", ["padron"]),
  target: targetLayout,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "cadastral_locality", Object.values(LOCALITY_COLUMN)),
};

const NO_TABLES: readonly ReferenceTable[] = [];
const ONE_REFERENCE_TABLE: readonly ReferenceTable[] = [{ schema: "carto", table: "access_point" }];

describe("buildPadronDeleteSql (AP-106)", () => {
  it("should read the candidates from the session temp table, never from ids written in the statement text", () => {
    const sql = buildPadronDeleteSql(layouts, ONE_REFERENCE_TABLE);

    expect(sql).toContain('"delete_candidates" AS (SELECT "id" AS "old_id" FROM pg_temp."padron_delete_ids")');
    expect(sql).not.toContain("VALUES");
  });

  it("should scope the DELETE on surviving_candidates, the ids whose reference re-check still reads zero", () => {
    const sql = buildPadronDeleteSql(layouts, ONE_REFERENCE_TABLE);

    expect(sql).toMatch(/DELETE FROM "carto"\."padron" AS tgt WHERE tgt\."id" IN \(SELECT "old_id" FROM "surviving_candidates"\)/);
  });

  it("should scan no reference table and union nothing when the reference table list is empty", () => {
    const sql = buildPadronDeleteSql(layouts, NO_TABLES);

    expect(sql).not.toMatch(/UNION ALL/);
    expect(sql).toContain('"delete_refs_raw" AS (SELECT CAST(NULL AS integer)');
  });

  it("should add one grouped reference-count select per readable table when the reference table list is not empty", () => {
    const two: readonly ReferenceTable[] = [...ONE_REFERENCE_TABLE, { schema: "carto", table: "address" }];

    const sql = buildPadronDeleteSql(layouts, two);

    expect(sql).toContain('FROM "carto"."access_point"');
    expect(sql).toContain('FROM "carto"."address"');
    expect(sql.match(/UNION ALL/g)).toHaveLength(1);
  });

  it("should re-check only the reference condition: the surviving CTE filters on the reference total being zero", () => {
    const sql = buildPadronDeleteSql(layouts, ONE_REFERENCE_TABLE);

    expect(sql).toContain('WHERE COALESCE("delete_refs"."total", 0) = 0');
    expect(sql).not.toContain("NOT_APPLIED");
    expect(sql).not.toContain("missing_target_ids");
  });

  it("should capture the deleted rows into the revert table with all columns, in the same order as revertColumnList()", () => {
    const sql = buildPadronDeleteSql(layouts, NO_TABLES);

    expect(sql).toContain(`INSERT INTO pg_temp."padron_revert" (${revertColumnList()})`);
  });

  it("should tag the revert capture with the deleted kind 'D' and the full row, including id_province and the explicit id", () => {
    const sql = buildPadronDeleteSql(layouts, NO_TABLES);

    expect(sql).toMatch(/SELECT 'D', dr\."id", dr\."type_padron", dr\."id_cadastral_locality", dr\."number", dr\."geometry",\s*dr\."id_province"/);
  });

  it("should never write id or id_address_master in the DELETE itself, reading them only through RETURNING for the revert capture", () => {
    const sql = buildPadronDeleteSql(layouts, NO_TABLES);

    expect(sql).not.toMatch(/DELETE FROM[\s\S]*?SET/);
    expect(sql).toContain('RETURNING tgt."id" AS "id"');
  });

  it("should report surviving, deleted and revert_rows counts plus the capped removed_list", () => {
    const sql = buildPadronDeleteSql(layouts, NO_TABLES);

    expect(sql).toContain('AS "surviving"');
    expect(sql).toContain('AS "deleted"');
    expect(sql).toContain('AS "revert_rows"');
    expect(sql).toContain('AS "removed_list"');
    expect(sql).toContain("LIMIT 500");
  });

  it("should contain exactly one DELETE statement and no TRUNCATE", () => {
    const sql = buildPadronDeleteSql(layouts, ONE_REFERENCE_TABLE);

    expect(sql.match(/DELETE FROM/g)).toHaveLength(1);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
