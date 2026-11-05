import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { referenceScanOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import type { ActualizarPadronOptions, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

/* SQL-shape tests of the automatic removal-eligibility block that buildPadronClassifySql adds (AP-101 to AP-106). The real
   behaviour (whether a row is actually judged eligible) is covered against a live database in targetSqlPglite.test.ts. */

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
  staging: tableOf("stg", "catastro_paispadron_stg", Object.values(STAGING_COLUMN)),
  target: targetLayout,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "cadastral_locality", Object.values(LOCALITY_COLUMN)),
};

const options: ActualizarPadronOptions = {
  tolerance: 1,
  geometryAreaThreshold: 0.05,
  updateGeometries: true, repairSequences: true,
  linkAddressMaster: false,
  pairChoices: [],
};

const READABLE_SCAN = referenceScanOf([{ schema: "carto", table: "access_point", readable: true }]);
const BLOCKED_SCAN = referenceScanOf([]);

const sql = buildPadronClassifySql(layouts, options, READABLE_SCAN);

const verdictsCteOf = (text: string): string => {
  const start = text.indexOf('"removal_verdicts" AS (');
  if (start < 0) throw new Error("removal_verdicts CTE not found");
  const end = text.indexOf(",\n\"", start);
  return text.slice(start, end < 0 ? undefined : end);
};

describe("buildPadronClassifySql removal-eligibility block (AP-101 to AP-106)", () => {
  it("should define the missing ids, reference counts, open pair ids and verdict CTEs without any mark CTE", () => {
    expect(sql).toContain('"missing_target_ids" AS (');
    expect(sql).toContain('"removal_refs_raw" AS (');
    expect(sql).toContain('"removal_refs" AS (');
    expect(sql).toContain('"open_pair_ids" AS (');
    expect(sql).toContain('"removal_verdicts" AS (');
    expect(sql).not.toContain("removal_marks");
    expect(sql).not.toContain("deletable_marks");
  });

  it("should count the references of the discovered readable tables over the missing ids", () => {
    expect(sql).toContain('FROM "carto"."access_point"');
  });

  it("should take the open pair ids from the pending and ambiguous pair statuses only", () => {
    const start = sql.indexOf('"open_pair_ids" AS (');
    const clause = sql.slice(start, sql.indexOf('"removal_verdicts" AS (', start));

    expect(clause).toContain("'NOT_APPLIED_PENDING'");
    expect(clause).toContain("'NOT_APPLIED_AMBIGUOUS'");
    expect(clause).not.toContain("'APPLIED'");
  });

  it("should order the verdict precedence STILL_PAIRABLE, reassignable (NULL), NOT_REASSIGNABLE, then NOW_REFERENCED, with no UNVERIFIED branch when the scan is not blocked", () => {
    const clause = verdictsCteOf(sql);

    const pairable = clause.indexOf("'STILL_PAIRABLE'");
    const reassignable = clause.indexOf("THEN NULL");
    const notReassignable = clause.indexOf("'NOT_REASSIGNABLE'");
    const referenced = clause.indexOf("'NOW_REFERENCED'");
    expect(pairable).toBeGreaterThan(-1);
    expect(reassignable).toBeGreaterThan(pairable);
    expect(notReassignable).toBeGreaterThan(reassignable);
    expect(referenced).toBeGreaterThan(notReassignable);
    expect(clause).not.toContain("'UNVERIFIED'");
    expect(clause).not.toContain("NO_LONGER_MISSING");
  });

  it("should add an UNVERIFIED fallback after the other reasons when the scan is blocked", () => {
    const clause = verdictsCteOf(buildPadronClassifySql(layouts, options, BLOCKED_SCAN));

    expect(clause.indexOf("'UNVERIFIED'")).toBeGreaterThan(clause.indexOf("'NOW_REFERENCED'"));
    expect(clause).toContain("ELSE 'UNVERIFIED'");
  });

  it("should name removed and the four removalsSkipped reasons as output columns, without the dropped no-longer-missing one", () => {
    expect(sql).toContain('AS "removed"');
    expect(sql).toContain('AS "removals_skipped_still_pairable"');
    expect(sql).toContain('AS "removals_skipped_now_referenced"');
    expect(sql).toContain('AS "removals_skipped_not_reassignable"');
    expect(sql).toContain('AS "removals_skipped_unverified"');
    expect(sql).not.toContain("removals_skipped_no_longer_missing");
  });

  it("should add a single 'D' digest entry holding the count and the md5 of the sorted deletable ids", () => {
    const tagIndex = sql.indexOf("'D'");
    expect(tagIndex).toBeGreaterThan(-1);
    const entrySegment = sql.slice(tagIndex, sql.indexOf(') AS "entries"', tagIndex));

    expect(entrySegment).toContain("count(*)");
    expect(entrySegment).toContain(`md5(string_agg("old_id"::text, ',' ORDER BY "old_id"))`);
    expect(entrySegment).toContain('FROM "removal_verdicts" WHERE "reason" IS NULL UNION ALL');
    expect(sql.match(/'D'/g)).toHaveLength(1);
  });

  it("should add a single 'S' digest entry with the count, the md5 of the sorted reassigned padron ids and the md5 of their reference counts per table", () => {
    const tagIndex = sql.indexOf("'S'");
    expect(tagIndex).toBeGreaterThan(-1);
    const entrySegment = sql.slice(tagIndex, sql.indexOf(') AS "entries"', tagIndex));

    expect(sql.match(/'S'/g)).toHaveLength(1);
    expect(entrySegment).toContain('SELECT count(*) FROM "removal_verdicts" WHERE "reassign"');
    expect(entrySegment).toContain(`md5(string_agg("old_id"::text, ',' ORDER BY "old_id"))`);
    expect(entrySegment).toContain(`r."old_id"::text || ':' || r."table_label" || ':' || r."refs"::text`);
    expect(entrySegment).toContain('ORDER BY r."old_id", r."table_label"');
  });

  it("should define the reassign flag as no reason and at least one reference, and keep S in the blocked statement too", () => {
    expect(verdictsCteOf(sql)).toContain('(vd."reason" IS NULL AND vd."refs_total" > 0) AS "reassign"');
    expect(buildPadronClassifySql(layouts, options, BLOCKED_SCAN)).toContain("'S'");
  });

  it("should never reassign when the scan is blocked: the reassignable test is the constant false", () => {
    const clause = verdictsCteOf(buildPadronClassifySql(layouts, options, BLOCKED_SCAN));

    expect(clause).toContain("AND false THEN NULL");
    expect(clause).toContain("ELSE 'UNVERIFIED'");
  });

  it("should make a subdivided padron reassignable only when no reference table reports a blocker", () => {
    const clause = verdictsCteOf(sql);

    expect(clause).toContain(`"missing_scored"."class" = 'SUBDIVIDED'`);
    expect(clause).toContain('COALESCE("removal_refs"."blocked", 0) = 0 THEN NULL');
  });

  it("should add the reassigned counts: rows, padrones and rows per table", () => {
    expect(sql).toContain('AS "reassigned"');
    expect(sql).toContain('AS "subdivided_deleted"');
    expect(sql).toContain('AS "reassigned_by_table"');
  });

  it("should insert the reassign ids into their own temp table in the persist classify only", () => {
    const persist = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false, persistDeletable: true });

    expect(persist).toContain('"reassign_ids_insert" AS (INSERT INTO pg_temp."padron_reassign_ids" ("id") SELECT "old_id" FROM "removal_verdicts" WHERE "reassign" RETURNING "id")');
    expect(sql).not.toContain("padron_reassign_ids");
  });

  it("should carry the SUBDIVIDED classification CTEs in the analysis, the report-less and the persist statements alike", () => {
    const persist = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false, persistDeletable: true });
    const plain = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false });

    for (const text of [sql, persist, plain]) expect(text).toContain('"missing_scored" AS (');
  });

  it("should leave the part labels to the report variant only", () => {
    const plain = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false });

    expect(plain).not.toContain('"missing_labels" AS (');
  });

  it("should always carry the removal CTEs and the digest entry, even when the scan is blocked", () => {
    const blocked = buildPadronClassifySql(layouts, options, BLOCKED_SCAN);

    expect(blocked).toContain('"removal_verdicts" AS (');
    expect(blocked).toContain("'D'");
    expect(blocked).toContain('AS "removed"');
  });

  it("should not write the delete ids table in an analysis or in a default classify", () => {
    expect(sql).not.toContain("padron_delete_ids");
    expect(sql).not.toContain("INSERT INTO");
  });

  it("should insert the deletable ids into the temp table as a data-modifying CTE when persistDeletable is set", () => {
    const persist = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false, persistDeletable: true });

    expect(persist).toContain(
      '"deleted_ids_insert" AS (INSERT INTO pg_temp."padron_delete_ids" ("id") SELECT "old_id" FROM "removal_verdicts" WHERE "reason" IS NULL AND NOT "reassign" RETURNING "id")'
    );
  });

  it("should keep the digest expression identical between the analysis and the persist variants of the statement", () => {
    const digestOf = (text: string): string => text.slice(text.indexOf("(SELECT md5(coalesce("), text.indexOf('AS "plan_digest"'));

    const persist = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false, persistDeletable: true });

    expect(digestOf(persist)).toBe(digestOf(sql));
  });

  it("should list the deletable rows in an analysis only, capped, under removed_list", () => {
    const persist = buildPadronClassifySql(layouts, options, READABLE_SCAN, { report: false, persistDeletable: true });

    expect(sql).toContain('"removed_list"');
    expect(persist).not.toContain('"removed_list"');
  });
});
