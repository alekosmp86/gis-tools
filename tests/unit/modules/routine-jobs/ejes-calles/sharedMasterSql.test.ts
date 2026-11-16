import { describe, expect, it } from "vitest";
import { EJES_LOAD_ROLES } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { accessPointRefMatchSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { ejesLoadContextOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadContext";
import { buildDeleteMastersSql, buildDeleteSectionsSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadWriteSql";
import { buildRevertMastersSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/revertSql";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { ejesLayouts, ejesTables } from "./ejesFixtures";

const targetOf = (role: (typeof EJES_LOAD_ROLES)[number]): WritableTargetLayout => {
  const layout = ejesLayouts()[role];
  return {
    ...layout,
    srid: 32721,
    idColumn: "id",
    idSequence: null,
    identityColumns: [],
    catalog: Object.keys(layout.columns).map((column) => ({ column_name: column, data_type: "text", is_nullable: true, column_default: null })),
  };
};

const contextOf = () => ejesLoadContextOf(ejesLayouts(), ejesTables(), EJES_LOAD_ROLES.map(targetOf));

describe("shared master SQL (EJ-21, F2)", () => {
  describe("buildDeleteMastersSql", () => {
    it("should delete only the masters flagged master_deleted in the delete plan", () => {
      const sql = buildDeleteMastersSql(contextOf());

      expect(sql).toContain('SELECT DISTINCT d.master_id FROM pg_temp."ej_del" AS d WHERE d.master_deleted');
    });

    it("should guard each master with a NOT EXISTS on road_section, carto.address and carto.padron", () => {
      const sql = buildDeleteMastersSql(contextOf());

      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "carto"."road_section" AS r WHERE r."id_address_master" = m."addresses_master_id")');
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "carto"."address" AS h WHERE h."id_address_master" = m."addresses_master_id")');
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "carto"."padron" AS h WHERE h."id_address_master" = m."addresses_master_id")');
    });

    it("should count the deleted masters in the written alias, so the load can compare it with the plan", () => {
      const sql = buildDeleteMastersSql(contextOf());

      expect(sql).toMatch(/^WITH "written" AS \(DELETE FROM "carto"\."addresses_master" AS m USING/);
      expect(sql).toMatch(/SELECT count\(\*\) AS "written" FROM "written"$/);
    });
  });

  describe("buildRevertMastersSql", () => {
    it("should restore only the masters flagged master_deleted, never every master the delete plan lists", () => {
      const sql = buildRevertMastersSql(contextOf());

      expect(sql).toContain('SELECT d.master_id FROM pg_temp."ej_del" AS d WHERE d.master_deleted');
      expect(sql).toMatch(/CREATE TEMP TABLE "ej_rev_masters" ON COMMIT DROP AS/);
    });

    it("should re-insert a restored master with its original id and row, read as JSON before the first write", () => {
      const sql = buildRevertMastersSql(contextOf());

      expect(sql).toContain("jsonb_populate_record(NULL::");
      expect(sql).toContain('FROM (SELECT t."addresses_master_id" AS row_id, to_jsonb(t)::text AS row_json FROM "carto"."addresses_master" AS t');
    });
  });

  describe("buildDeleteSectionsSql id guard (EJS-10, F6)", () => {
    it("should guard the section delete by road_section.id with accessPointRefMatchSql, the only id matcher", () => {
      const sql = buildDeleteSectionsSql(contextOf());

      expect(sql).toContain(`AND NOT EXISTS (SELECT 1 FROM "carto"."access_point" AS a WHERE ${accessPointRefMatchSql(contextOf(), "d.road_id::text")})`);
    });

    it("should guard the section delete by reftramo with accessPointRefMatchSql too", () => {
      const sql = buildDeleteSectionsSql(contextOf());

      expect(sql).toContain(`AND NOT EXISTS (SELECT 1 FROM "carto"."access_point" AS a WHERE ${accessPointRefMatchSql(contextOf(), "d.ref")})`);
    });
  });
});
