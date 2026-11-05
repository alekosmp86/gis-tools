import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import {
  buildPadronReassignChangedSql,
  plannedReassignChangedCountsSql,
  plannedReassignChangedCtes,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignChangedSql";
import type { ReferenceTable } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { referenceScanOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import type { ActualizarPadronOptions, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const identityOf = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({ schema, table, columns: identityOf(columns) });

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", Object.values(LOCALITY_COLUMN)),
};

const OPTIONS: ActualizarPadronOptions = { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, repairSequences: true, linkAddressMaster: false, pairChoices: [] };

const ACCESS_POINT: ReferenceTable = {
  schema: "carto",
  table: "access_point",
  reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false },
};

const GEOG_REF: ReferenceTable = {
  schema: "carto",
  table: "geog_ref",
  reassign: { pkColumn: "gid", geometryColumn: "geog", geography: true },
};

const BLOCKED: ReferenceTable = { schema: "carto", table: "no_pk", reassignBlocker: "sin clave primaria de una sola columna" };

describe("buildPadronReassignChangedSql (AP-122)", () => {
  it("should read the changed padrones as the distinct ids of the revert rows of kinds U and P only", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    expect(sql).toContain('SELECT DISTINCT rv."id" AS "id" FROM pg_temp."padron_revert" AS rv WHERE rv."kind" IN (\'U\', \'P\')');
    expect(sql).not.toMatch(/IN \([^)]*'[IDARM]'/);
  });

  it("should exclude the padrones in padron_delete_ids from the receivers and the padron itself", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    expect(sql).toContain('NOT IN (SELECT "id" FROM pg_temp."padron_delete_ids")');
    expect(sql).toContain('<> c."old_id"');
  });

  it("should restrict the receivers to the province of the row and the lowest id wins", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    expect(sql).toContain('= c."id_province"');
    expect(sql).toContain('min(t."id") AS "new_id", count(*) AS "n"');
    expect(sql).toContain('WHERE r."n" > 0');
  });

  it("should select a row only when its point is known and outside its own padron's geometry", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    expect(sql).toContain('WHERE pt."point" IS NOT NULL AND NOT COALESCE(ST_Contains(ch."geometry", pt."point"), false)');
  });

  it("should write only id_padron of the table, by primary key, and capture a kind R revert row per moved row", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    expect(sql).toContain('UPDATE "carto"."access_point" AS rt SET "id_padron" = pc."new_id" FROM "reassign_changed_pick_0" AS pc WHERE rt."gid" = pc."pk"');
    expect(sql).toContain("INSERT INTO pg_temp.\"padron_revert\"");
    expect(sql).toContain("SELECT 'R', mv.\"old_id\"::integer");
    expect(sql.match(/SET "/g)).toHaveLength(1);
  });

  it("should return moved, selected, ambiguous, by_table and revert_rows", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    for (const column of ["moved", "selected", "ambiguous", "by_table", "revert_rows"]) expect(sql).toContain(`AS "${column}"`);
    expect(sql).toContain('(SELECT count(*) FROM "reassign_changed_moved_0") AS "moved"');
    expect(sql).toContain('(SELECT count(*) FROM "reassign_changed_pick_0") AS "selected"');
    expect(sql).toContain('(SELECT count(*) FROM "reassign_changed_pick_0" WHERE "n" > 1) AS "ambiguous"');
    expect(sql).toContain("json_build_object('carto.access_point', (SELECT count(*) FROM \"reassign_changed_moved_0\")) AS \"by_table\"");
    expect(sql).toContain('(SELECT count(*) FROM "reassign_changed_revert_0") AS "revert_rows"');
  });

  it("should add the counts of every reassignable table and name each one in by_table", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT, GEOG_REF]);

    expect(sql).toContain('(SELECT count(*) FROM "reassign_changed_moved_0") + (SELECT count(*) FROM "reassign_changed_moved_1") AS "moved"');
    expect(sql).toContain("'carto.access_point'");
    expect(sql).toContain("'carto.geog_ref'");
  });

  it("should read a geography column as a geometry", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [GEOG_REF]);

    expect(sql).toContain('src."geog"::geometry');
  });

  it("should filter the padrones referenced by a table that cannot be reassigned, one clause per such table", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT, BLOCKED]);

    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM "carto"."no_pk" AS bt WHERE bt."id_padron" = ca."id")');
    expect(sql).not.toContain('"carto"."access_point" AS bt');
  });

  it("should add no filter when every referencing table can be reassigned", () => {
    expect(buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT])).not.toContain("NOT EXISTS");
  });

  it("should report zero counts and an empty by_table, with no per-table statement, when the table list is empty", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, []);

    expect(sql).toContain('0 AS "moved"');
    expect(sql).toContain('0 AS "selected"');
    expect(sql).toContain('0 AS "ambiguous"');
    expect(sql).toContain("'{}'::json AS \"by_table\"");
    expect(sql).toContain('0 AS "revert_rows"');
    expect(sql).not.toContain("UPDATE ");
  });

  it("should report zero counts when the only tables cannot be reassigned", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [BLOCKED]);

    expect(sql).toContain('0 AS "moved"');
    expect(sql).not.toContain("UPDATE ");
  });

  it("should read the geometry of the changed padron from the destination, after the apply", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT]);

    expect(sql).toContain('JOIN "carto"."padron" AS t ON t."id" = ci."id"');
    expect(sql).toContain('t."geometry" AS "geometry"');
  });

  it("should never write the geometry or any other column of the destination", () => {
    const sql = buildPadronReassignChangedSql(LAYOUTS, [ACCESS_POINT, GEOG_REF]);

    expect(sql).not.toMatch(/UPDATE "carto"\."padron"/);
    expect(sql).not.toMatch(/DELETE FROM/);
  });
});

describe("plannedReassignChangedCtes (AP-123)", () => {
  const POST_APPLY = "SELECT 1 AS id, NULL AS geometry";

  it("should return no CTE when no table can be reassigned", () => {
    expect(plannedReassignChangedCtes(LAYOUTS, [], POST_APPLY)).toEqual([]);
    expect(plannedReassignChangedCtes(LAYOUTS, [BLOCKED], POST_APPLY)).toEqual([]);
  });

  it("should build the post-apply, changed, excluded, candidate and pick CTEs per table", () => {
    const ctes = plannedReassignChangedCtes(LAYOUTS, [ACCESS_POINT, GEOG_REF], POST_APPLY);

    expect(ctes.map((entry) => entry.slice(0, entry.indexOf(" AS")))).toEqual([
      '"reassign_changed_post"',
      '"reassign_changed_all"',
      '"reassign_changed"',
      '"reassign_changed_excluded"',
      '"reassign_changed_cand_0"',
      '"reassign_changed_pick_0"',
      '"reassign_changed_cand_1"',
      '"reassign_changed_pick_1"',
    ]);
  });

  it("should take the changed padrones and their geometry from the given post-apply select, not from the revert table", () => {
    const joined = plannedReassignChangedCtes(LAYOUTS, [ACCESS_POINT], POST_APPLY).join(" ");

    expect(joined).toContain(POST_APPLY);
    expect(joined).toContain('FROM "reassign_changed_post" AS ci');
    expect(joined).toContain('ci."geometry" AS "geometry"');
    expect(joined).not.toContain("padron_revert");
  });

  it("should exclude the changed padrones and the deletable verdicts from the existing receivers and add the changed ones with their planned geometry", () => {
    const joined = plannedReassignChangedCtes(LAYOUTS, [ACCESS_POINT], POST_APPLY).join(" ");

    expect(joined).toContain('NOT IN (SELECT "id" FROM "reassign_changed_excluded")');
    expect(joined).toContain('SELECT ca."id" FROM "reassign_changed_all" AS ca');
    expect(joined).toContain('ca."geometry" && ');
  });

  it("should add the padrones the insert would create as receivers of their province", () => {
    const joined = plannedReassignChangedCtes(LAYOUTS, [ACCESS_POINT], POST_APPLY).join(" ");

    expect(joined).toContain("CAST(NULL AS integer) AS \"id\"");
    expect(joined).toContain('nw."id_province" = c."id_province"');
  });

  it("should filter the padrones referenced by a table that cannot be reassigned", () => {
    const joined = plannedReassignChangedCtes(LAYOUTS, [ACCESS_POINT, BLOCKED], POST_APPLY).join(" ");

    expect(joined).toContain('FROM "carto"."no_pk" AS bt WHERE bt."id_padron" = ca."id"');
  });

  it("should never write anything", () => {
    const joined = plannedReassignChangedCtes(LAYOUTS, [ACCESS_POINT, GEOG_REF], POST_APPLY).join(" ");

    expect(joined).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });
});

describe("plannedReassignChangedCountsSql (AP-123)", () => {
  it("should return the zero columns and an empty map for an empty table list", () => {
    expect(plannedReassignChangedCountsSql([])).toEqual([
      '0 AS "reassigned_changed",',
      '0 AS "reassigned_changed_ambiguous",',
      "'{}'::json AS \"reassigned_changed_by_table\",",
    ]);
  });

  it("should return zeros when no table can be reassigned", () => {
    expect(plannedReassignChangedCountsSql([BLOCKED])[0]).toBe('0 AS "reassigned_changed",');
  });

  it("should count the picks, the ambiguous picks and the picks per table", () => {
    const [count, ambiguous, byTable] = plannedReassignChangedCountsSql([ACCESS_POINT, GEOG_REF]);

    expect(count).toBe('(SELECT count(*) FROM "reassign_changed_pick_0") + (SELECT count(*) FROM "reassign_changed_pick_1") AS "reassigned_changed",');
    expect(ambiguous).toBe(
      '(SELECT count(*) FROM "reassign_changed_pick_0" WHERE "n" > 1) + (SELECT count(*) FROM "reassign_changed_pick_1" WHERE "n" > 1) AS "reassigned_changed_ambiguous",'
    );
    expect(byTable).toBe(
      "json_build_object('carto.access_point', (SELECT count(*) FROM \"reassign_changed_pick_0\"), 'carto.geog_ref', (SELECT count(*) FROM \"reassign_changed_pick_1\")) AS \"reassigned_changed_by_table\","
    );
  });
});

describe("buildPadronClassifySql changed-padron wiring (AP-123)", () => {
  const scanOf = (tables: ReferenceTable[]) => ({ ...referenceScanOf([]), tables });

  it("should plan the changed-padron reassignment in an analysis, with the pair geometry that follows updateGeometries", () => {
    const sql = buildPadronClassifySql(LAYOUTS, OPTIONS, scanOf([ACCESS_POINT]), { report: true });

    expect(sql).toContain('"reassign_changed_post"');
    expect(sql).toContain('AS "reassigned_changed"');
    expect(sql).toContain('AS "reassigned_changed_ambiguous"');
    expect(sql).toContain('AS "reassigned_changed_by_table"');
  });

  it("should use the staging geometry of a pair when updateGeometries is on and keep the target's when it is off", () => {
    const on = buildPadronClassifySql(LAYOUTS, OPTIONS, scanOf([ACCESS_POINT]), { report: true });
    const off = buildPadronClassifySql(LAYOUTS, { ...OPTIONS, updateGeometries: false, repairSequences: true }, scanOf([ACCESS_POINT]), { report: true });

    expect(on).not.toBe(off);
    const postOf = (sql: string): string => sql.slice(sql.indexOf('"reassign_changed_post" AS'), sql.indexOf('"reassign_changed_all" AS'));
    expect(postOf(on)).not.toBe(postOf(off));
  });

  it("should add no changed-padron wiring to the persist classify", () => {
    const sql = buildPadronClassifySql(LAYOUTS, OPTIONS, scanOf([ACCESS_POINT]), { report: false, persistDeletable: true });

    expect(sql).not.toContain("reassign_changed");
  });

  it("should add no CTE but still return the zero columns in an analysis when no table can be reassigned", () => {
    const sql = buildPadronClassifySql(LAYOUTS, OPTIONS, scanOf([BLOCKED]), { report: true });

    expect(sql).not.toContain('"reassign_changed_post"');
    expect(sql).toContain('0 AS "reassigned_changed"');
  });
});
