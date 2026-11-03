import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, REMOVAL_SKIP_REASON } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { REASSIGN_BLOCKER, reassignBlockerOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignBlockers";
import {
  DELETE_WITHOUT_REASSIGN,
  reassignCountsSql,
  reassignDigestEntrySql,
  reassignFlagSql,
  reassignIdsInsertCte,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignClassifySql";
import { buildPadronReassignSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignSql";
import {
  buildCreateInsertedIdsTableSql,
  buildCreateReassignIdsTableSql,
  INSERTED_IDS_TABLE_SQL,
  REASSIGN_IDS_TABLE_SQL,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignTables";
import type { ReferenceTable } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import {
  buildCreateRevertTableSql,
  REVERT_EXTRA_COLUMN,
  REVERT_KIND,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const identity = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({ schema, table, columns: identity(columns) });

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", [...Object.values(DESTINATION_COLUMN), "id_address_master"]),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf("carto", "addresses_master", ["addresses_master_id", "urn", "latitud", "longitud"]),
  srid: 0,
  idColumn: "addresses_master_id",
  idSequence: null,
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", ["padron"]),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "cadastral_locality", Object.values(LOCALITY_COLUMN)),
  addressMaster: ADDRESS_MASTER,
};

const LAYOUTS_WITHOUT_MASTER: PadronLayouts = { ...LAYOUTS, addressMaster: undefined };

const GEOMETRY_TABLE: ReferenceTable = {
  schema: "carto",
  table: "access_point",
  reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false },
};
const GEOGRAPHY_TABLE: ReferenceTable = {
  schema: "carto",
  table: "geog_ref",
  reassign: { pkColumn: "ref_id", geometryColumn: "geog", geography: true },
};
const BLOCKED_TABLE: ReferenceTable = { schema: "carto", table: "audit", reassignBlocker: REASSIGN_BLOCKER.NO_PRIMARY_KEY };

describe("reassignBlockerOf (AP-110)", () => {
  it("should be null for a table with a reassign target", () => {
    expect(reassignBlockerOf(GEOMETRY_TABLE)).toBeNull();
  });

  it("should return the table's own blocker when it has no target", () => {
    expect(reassignBlockerOf({ schema: "carto", table: "t", reassignBlocker: REASSIGN_BLOCKER.NO_GEOMETRY })).toBe(REASSIGN_BLOCKER.NO_GEOMETRY);
  });

  it("should fail closed with the no-primary-key reason for a table with neither target nor blocker", () => {
    expect(reassignBlockerOf({ schema: "carto", table: "t" })).toBe(REASSIGN_BLOCKER.NO_PRIMARY_KEY);
  });

  it("should name four distinct non-empty Spanish reasons, none about a row without a geometry (AP-111)", () => {
    const reasons = Object.values(REASSIGN_BLOCKER);

    expect(new Set(reasons).size).toBe(4);
    expect(reasons.every((reason) => reason.length > 0)).toBe(true);
    expect(reasons).not.toContain("tiene filas sin geometría");
    expect(Object.keys(REASSIGN_BLOCKER)).not.toContain("EMPTY_GEOMETRY");
  });

  it("should return null for a reassignable table with a companion point source", () => {
    const companionTable: ReferenceTable = {
      schema: "carto",
      table: "access_point",
      reassign: { pkColumn: "id", geometryColumn: "geometry", geography: false, companion: { schema: "carto", table: "address", column: "id", companionColumn: "id" } },
    };

    expect(reassignBlockerOf(companionTable)).toBeNull();
  });
});

describe("reassign temp tables (AP-112, AP-113)", () => {
  it("should create both session tables as temp, with an integer primary key, dropped at commit", () => {
    for (const sql of [buildCreateInsertedIdsTableSql(), buildCreateReassignIdsTableSql()]) {
      expect(sql).toMatch(/^CREATE TEMP TABLE "padron_(inserted|reassign)_ids" \("id" integer PRIMARY KEY\) ON COMMIT DROP;$/);
    }
  });

  it("should address them in pg_temp so a same-named table elsewhere is never read", () => {
    expect(INSERTED_IDS_TABLE_SQL).toBe('pg_temp."padron_inserted_ids"');
    expect(REASSIGN_IDS_TABLE_SQL).toBe('pg_temp."padron_reassign_ids"');
  });
});

describe("reassignClassifySql (AP-112)", () => {
  it("should flag a verdict with no reason and at least one reference as reassigning", () => {
    expect(reassignFlagSql("vd")).toBe('(vd."reason" IS NULL AND vd."refs_total" > 0)');
  });

  it("should keep the reassigning padrones out of the delete ids insert", () => {
    expect(DELETE_WITHOUT_REASSIGN).toBe('"reason" IS NULL AND NOT "reassign"');
  });

  it("should insert the reassigning ids into the reassign temp table as a data-modifying CTE", () => {
    expect(reassignIdsInsertCte()).toBe(
      '"reassign_ids_insert" AS (INSERT INTO pg_temp."padron_reassign_ids" ("id") SELECT "old_id" FROM "removal_verdicts" WHERE "reassign" RETURNING "id")'
    );
  });

  it("should count rows, padrones and rows per table from the verdicts and the raw counts", () => {
    const counts = reassignCountsSql().join(" ");

    expect(counts).toContain('COALESCE(sum("refs_total"), 0) FROM "removal_verdicts" WHERE "reassign") AS "reassigned"');
    expect(counts).toContain('(SELECT count(*) FROM "removal_verdicts" WHERE "reassign") AS "subdivided_deleted"');
    expect(counts).toContain('json_object_agg(g."table_label", g."n")');
    expect(counts).toContain('GROUP BY r."table_label"');
    expect(counts).toContain('AS "reassigned_by_table"');
    expect(reassignCountsSql().every((part) => part.endsWith(","))).toBe(true);
  });

  it("should count the reassigned rows without a point from the raw no_point counts of the reassigning verdicts only", () => {
    const counts = reassignCountsSql().join(" ");

    expect(counts).toContain('(SELECT COALESCE(sum(r."no_point"), 0) FROM "removal_refs_raw" AS r');
    expect(counts).toContain('JOIN "removal_verdicts" AS v ON v."old_id" = r."old_id" WHERE v."reassign") AS "reassigned_without_point"');
  });

  it("should build one S digest entry from the count, the id hash and the per-table reference hash", () => {
    const entry = reassignDigestEntrySql();

    expect(entry.startsWith("SELECT concat_ws('|', 'S', ")).toBe(true);
    expect(entry).toContain("md5(string_agg(\"old_id\"::text, ',' ORDER BY \"old_id\"))");
    expect(entry).toContain("r.\"old_id\"::text || ':' || r.\"table_label\" || ':' || r.\"refs\"::text");
    expect(entry.endsWith('AS "entry"')).toBe(true);
  });
});

describe("buildPadronReassignSql (AP-109, AP-111, AP-113)", () => {
  const sql = buildPadronReassignSql(LAYOUTS, [GEOMETRY_TABLE]);

  it("should read the old ids from the reassign temp table, never from ids written in the text", () => {
    expect(sql).toContain('"reassign_ids" AS (SELECT "id" AS "old_id" FROM pg_temp."padron_reassign_ids")');
    expect(sql).not.toContain("VALUES");
  });

  it("should take receivers among the ids this run inserted, of the same province, at or above the 5 % area share", () => {
    expect(sql).toContain('JOIN pg_temp."padron_inserted_ids" AS ins ON ins."id" = n."id"');
    expect(sql).toContain('n."id_province" = o."id_province"');
    expect(sql).toContain('ov."overlap" * 100.0 / NULLIF(ov."area", 0) >= 5');
  });

  it("should guard the overlap with ST_IsValid on both geometries, so an invalid one is never intersected", () => {
    expect(sql).toContain('CASE WHEN ST_IsValid(o."geometry") AND ST_IsValid(n."geometry") THEN ST_Area(ST_Intersection(o."geometry", n."geometry")) END');
  });

  it("should pick the nearest receiver by ST_Distance with a tie to the lowest part id, one per referencing row", () => {
    expect(sql).toContain('ORDER BY ST_Distance(rc."part_geometry"');
    expect(sql).toContain('rc."part_id" LIMIT 1');
  });

  it("should use a point as it is and any other geometry through ST_PointOnSurface", () => {
    expect(sql).toContain(
      "CASE WHEN src.\"geom\" IS NULL OR ST_IsEmpty(src.\"geom\") THEN NULL WHEN ST_GeometryType(src.\"geom\") = 'ST_Point' THEN src.\"geom\" ELSE ST_PointOnSurface(src.\"geom\") END AS \"point\""
    );
  });

  it("should not join any companion for a table with a geometry of its own", () => {
    expect(sql).not.toContain("LEFT JOIN");
    expect(sql).toMatch(/FROM "carto"\."access_point" AS src\s+CROSS JOIN LATERAL/);
  });

  it("should read a geography column as a geometry", () => {
    const geography = buildPadronReassignSql(LAYOUTS, [GEOGRAPHY_TABLE]);

    expect(geography).toContain(
      "ST_GeometryType(src.\"geog\"::geometry) = 'ST_Point' THEN src.\"geog\"::geometry ELSE ST_PointOnSurface(src.\"geog\"::geometry)"
    );
  });

  it("should read the point of a geography companion as a geometry too", () => {
    const geographyCompanion: ReferenceTable = {
      schema: "carto",
      table: "access_point",
      reassign: { pkColumn: "id", geometryColumn: "geog", geography: true, companion: { schema: "carto", table: "address", column: "id", companionColumn: "id" } },
    };

    const text = buildPadronReassignSql(LAYOUTS, [geographyCompanion]);

    expect(text).toContain('cp."geog"::geometry IS NULL OR ST_IsEmpty(cp."geog"::geometry)');
    expect(text).toContain('ST_PointOnSurface(cp."geog"::geometry)');
  });

  describe("companion point source (AP-110, AP-111)", () => {
    const COMPANION_TABLE: ReferenceTable = {
      schema: "carto",
      table: "access_point",
      reassign: { pkColumn: "id", geometryColumn: "geometry", geography: false, companion: { schema: "carto", table: "address", column: "id", companionColumn: "id" } },
    };
    const companionSql = buildPadronReassignSql(LAYOUTS, [COMPANION_TABLE]);

    it("should LEFT JOIN the companion on its join column, never an inner join that would drop a row without an address", () => {
      expect(companionSql).toContain('FROM "carto"."access_point" AS src LEFT JOIN "carto"."address" AS cp ON cp."id" = src."id" CROSS JOIN LATERAL');
      expect(companionSql).not.toMatch(/(?<!LEFT )JOIN "carto"\."address"/);
    });

    it("should read the point from the companion geometry, not from the referencing table", () => {
      expect(companionSql).toContain('CASE WHEN cp."geometry" IS NULL OR ST_IsEmpty(cp."geometry") THEN NULL');
      expect(companionSql).not.toContain('src."geometry"');
    });

    it("should update by the referencing table's own primary key, which stays unique after the join", () => {
      expect(companionSql).toContain('SELECT src."id" AS "pk"');
      expect(companionSql).toContain('WHERE rt."id" = best."pk"');
      expect(companionSql).toContain('RETURNING best."old_id" AS "old_id", rt."id"::text AS "pk", best."no_point" AS "no_point"');
    });

    it("should quote a hostile companion table and column names as identifiers", () => {
      const hostile: ReferenceTable = {
        schema: "carto",
        table: "access_point",
        reassign: {
          pkColumn: "id",
          geometryColumn: 'g"eom',
          geography: false,
          companion: { schema: "carto", table: 'ad"; DROP TABLE x; --', column: 'j"c', companionColumn: 'c"c' },
        },
      };

      const text = buildPadronReassignSql(LAYOUTS, [hostile]);

      expect(text).toContain('"ad""; DROP TABLE x; --"');
      expect(text).toContain('cp."c""c" = src."j""c"');
      expect(text).toContain('cp."g""eom"');
    });
  });

  describe("rows without a point (AP-111)", () => {
    it("should order by distance, then by the largest cover only for a NULL point, then by the lowest part id", () => {
      expect(sql).toContain(
        'ORDER BY ST_Distance(rc."part_geometry", CASE WHEN ST_SRID(pt."point") = ST_SRID(rc."part_geometry") THEN pt."point" ELSE ST_Transform(pt."point", ST_SRID(rc."part_geometry")) END), CASE WHEN pt."point" IS NULL THEN -rc."part_cover" END, rc."part_id" LIMIT 1'
      );
    });

    it("should carry the area share of each receiver as part_cover", () => {
      expect(sql).toContain('ov."overlap" * 100.0 / NULLIF(ov."area", 0) AS "part_cover"');
    });

    it("should flag each moved row without a point and return the count as without_point", () => {
      expect(sql).toContain('pt."point" IS NULL AS "no_point"');
      expect(sql).toContain('best."no_point" AS "no_point"');
      expect(sql).toContain('(SELECT count(*) FROM "reassign_moved_0" WHERE "no_point") AS "without_point"');
    });

    it("should sum the no_point counts of every moved table", () => {
      const two = buildPadronReassignSql(LAYOUTS, [GEOMETRY_TABLE, GEOGRAPHY_TABLE]);

      expect(two).toContain(
        '(SELECT count(*) FROM "reassign_moved_0" WHERE "no_point") + (SELECT count(*) FROM "reassign_moved_1" WHERE "no_point") AS "without_point"'
      );
    });

    it.each([
      ["an empty list", [] as ReferenceTable[]],
      ["only blocked tables", [BLOCKED_TABLE]],
    ])("should report zero without_point for %s", (_label, references) => {
      expect(buildPadronReassignSql(LAYOUTS, references)).toContain('0 AS "without_point"');
    });

    it("should still never DELETE or TRUNCATE", () => {
      expect(buildPadronReassignSql(LAYOUTS, [GEOMETRY_TABLE])).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
    });
  });

  it("should transform the point to the receiver's SRID only when the SRIDs differ", () => {
    expect(sql).toContain(
      'CASE WHEN ST_SRID(pt."point") = ST_SRID(rc."part_geometry") THEN pt."point" ELSE ST_Transform(pt."point", ST_SRID(rc."part_geometry")) END'
    );
  });

  it("should update id_padron of the rows of the old ids by primary key and return the old id from the joined subquery", () => {
    expect(sql).toContain('UPDATE "carto"."access_point" AS rt SET "id_padron" = best."part_id"');
    expect(sql).toContain('WHERE rt."gid" = best."pk"');
    expect(sql).toContain('WHERE src."id_padron" IN (SELECT "old_id" FROM "reassign_ids")');
    expect(sql).toContain('RETURNING best."old_id" AS "old_id", rt."gid"::text AS "pk"');
  });

  it("should capture kind R with the quoted table, the primary key column and value, and the old id", () => {
    expect(sql).toContain('INSERT INTO pg_temp."padron_revert" ("kind", "id", "ref_table", "ref_key_column", "ref_key")');
    expect(sql).toContain("SELECT 'R', mv.\"old_id\"::integer, '\"carto\".\"access_point\"', 'gid', mv.\"pk\"");
    expect(REVERT_KIND.REASSIGNED).toBe("R");
  });

  it("should add every padron of the set to the delete ids", () => {
    expect(sql).toContain('INSERT INTO pg_temp."padron_delete_ids" ("id") SELECT "old_id" FROM "reassign_ids" RETURNING "id"');
  });

  it("should select the moved rows, the per-table object, the padron count and the revert rows", () => {
    expect(sql).toContain('(SELECT count(*) FROM "reassign_moved_0") AS "moved"');
    expect(sql).toContain("json_build_object('carto.access_point', (SELECT count(*) FROM \"reassign_moved_0\")) AS \"by_table\"");
    expect(sql).toContain('(SELECT count(*) FROM "reassign_delete_ids") AS "padrones"');
    expect(sql).toContain('(SELECT count(*) FROM "reassign_revert_0") AS "revert_rows"');
  });

  it("should write one moved and one revert CTE per reassignable table and sum their counts", () => {
    const two = buildPadronReassignSql(LAYOUTS, [GEOMETRY_TABLE, GEOGRAPHY_TABLE]);

    expect(two).toContain('"reassign_moved_0" AS (');
    expect(two).toContain('"reassign_moved_1" AS (');
    expect(two).toContain('"reassign_revert_1" AS (');
    expect(two).toContain('(SELECT count(*) FROM "reassign_moved_0") + (SELECT count(*) FROM "reassign_moved_1") AS "moved"');
  });

  it("should leave out the tables that are not reassignable", () => {
    const mixed = buildPadronReassignSql(LAYOUTS, [BLOCKED_TABLE, GEOMETRY_TABLE]);

    expect(mixed).not.toContain('"carto"."audit"');
    expect(mixed).toContain('"carto"."access_point"');
    expect(mixed).toContain('"reassign_moved_0" AS (');
    expect(mixed).not.toContain('"reassign_moved_1"');
  });

  it.each([
    ["an empty list", [] as ReferenceTable[]],
    ["only blocked tables", [BLOCKED_TABLE]],
  ])("should move nothing and report no table for %s", (_label, references) => {
    const empty = buildPadronReassignSql(LAYOUTS, references);

    expect(empty).not.toContain("UPDATE");
    expect(empty).toContain('0 AS "moved"');
    expect(empty).toContain("'{}'::json AS \"by_table\"");
    expect(empty).toContain('0 AS "revert_rows"');
    expect(empty).toContain('INSERT INTO pg_temp."padron_delete_ids"');
  });

  it("should never DELETE or TRUNCATE", () => {
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
  });

  it("should bind a hostile table or column name as an identifier, never as SQL text", () => {
    const hostile: ReferenceTable = {
      schema: "carto",
      table: 'x"; DROP TABLE carto.padron; --',
      reassign: { pkColumn: 'g"id', geometryColumn: "geom", geography: false },
    };

    const text = buildPadronReassignSql(LAYOUTS, [hostile]);

    expect(text).toContain('"x""; DROP TABLE carto.padron; --"');
    expect(text).toContain('"g""id"');
  });
});

describe("buildPadronDeleteSql master entry (AP-114)", () => {
  const sql = buildPadronDeleteSql(LAYOUTS, [GEOMETRY_TABLE]);

  it("should select the master ids of the deleted rows that no other destination row still carries", () => {
    expect(sql).toContain('"master_candidates" AS (SELECT DISTINCT dr."id_address_master" AS "master_id" FROM "deleted_rows" AS dr');
    expect(sql).toContain('dr."id_address_master" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "carto"."padron" AS other');
    expect(sql).toContain('other."id_address_master" = dr."id_address_master"');
    expect(sql).toContain('other."id" NOT IN (SELECT "id" FROM "deleted_rows")');
  });

  it("should delete the candidate master rows by id, returning the id and the jsonb copy of the row", () => {
    expect(sql).toContain(
      'DELETE FROM "carto"."addresses_master" AS am WHERE am."addresses_master_id" IN (SELECT "master_id" FROM "master_candidates")'
    );
    expect(sql).toContain('RETURNING am."addresses_master_id" AS "id", to_jsonb(am) AS "payload"');
  });

  it("should capture kind M with the id and the payload", () => {
    expect(sql).toContain(
      "INSERT INTO pg_temp.\"padron_revert\" (\"kind\", \"id\", \"payload\") SELECT 'M', mr.\"id\", mr.\"payload\" FROM \"master_deleted_rows\" AS mr"
    );
  });

  it("should count the master rows deleted and captured", () => {
    expect(sql).toContain('(SELECT count(*) FROM "master_deleted_rows") AS "master_deleted"');
    expect(sql).toContain('(SELECT count(*) FROM "master_revert_rows") AS "master_revert_rows"');
  });

  it("should delete the padrones before the masters, in the CTE order", () => {
    expect(sql.indexOf('"deleted_rows" AS (')).toBeLessThan(sql.indexOf('"master_candidates" AS ('));
    expect(sql.indexOf('"master_candidates" AS (')).toBeLessThan(sql.indexOf('"master_deleted_rows" AS ('));
  });

  it("should carry no master CTE and report zero masters when no address master table is defined", () => {
    const without = buildPadronDeleteSql(LAYOUTS_WITHOUT_MASTER, [GEOMETRY_TABLE]);

    expect(without).not.toContain("master_candidates");
    expect(without).not.toContain("addresses_master");
    expect(without).toContain('0 AS "master_deleted"');
    expect(without).toContain('0 AS "master_revert_rows"');
  });

  it("should keep the padron delete scoped on the surviving candidates when the master CTEs are present", () => {
    expect(sql).toMatch(/DELETE FROM "carto"\."padron" AS tgt WHERE tgt\."id" IN \(SELECT "old_id" FROM "surviving_candidates"\)/);
    expect(sql.match(/DELETE FROM/g)).toHaveLength(2);
  });
});

describe("padron_revert table (AP-113, AP-114)", () => {
  const sql = buildCreateRevertTableSql();

  it("should add the sequence, reference and payload columns after the padron columns", () => {
    expect(sql).toContain('"seq" bigint GENERATED ALWAYS AS IDENTITY');
    expect(sql).toContain('"ref_table" text');
    expect(sql).toContain('"ref_key_column" text');
    expect(sql).toContain('"ref_key" text');
    expect(sql).toContain('"payload" jsonb');
    expect(Object.values(REVERT_EXTRA_COLUMN)).toEqual(["seq", "ref_table", "ref_key_column", "ref_key", "payload"]);
  });

  it("should stay a transaction-local temp table", () => {
    expect(sql).toMatch(/^CREATE TEMP TABLE "padron_revert"/);
    expect(sql.endsWith("ON COMMIT DROP;")).toBe(true);
  });

  it("should add the two new kinds to the revert kinds and the new removal reason to the reasons", () => {
    expect(REVERT_KIND.REASSIGNED).toBe("R");
    expect(REVERT_KIND.MASTER_DELETED).toBe("M");
    expect(REMOVAL_SKIP_REASON.NOT_REASSIGNABLE).toBe("NOT_REASSIGNABLE");
  });
});
