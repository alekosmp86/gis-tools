import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { buildPadronReassignSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignSql";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import { buildCreateInsertedIdsTableSql, buildCreateReassignIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignTables";
import { buildCreateDeleteIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import { referenceScanOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import type { ReferenceTable } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import {
  buildCaptureAddressMasterSql,
  buildCreateRevertTableSql,
  buildRevertIndexSql,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { DESTINATION_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN, LOCALITY_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import type { ActualizarPadronOptions, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { PADRON_SUBJECT_SPEC } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const DELETE_OR_TRUNCATE = /\b(DELETE|TRUNCATE)\b/i;
/* The raw-source-file scan below greps whole file text, where legitimate English now collides with the bare word
   "DELETE" since AP-101 to AP-108 added real deletion: STEP.DELETE ("Eliminar padrones faltantes sin referencias"),
   DESTINATION_DELETE_PRIVILEGE's privilege name "DELETE", deletePadronRows identifiers, and comments
   describing delete-eligibility. None of those is a SQL statement. A real DELETE statement in Postgres is always
   "DELETE FROM ..."; TRUNCATE has no such collision in this stage, so it stays a bare-word match. This pattern is
   used only for the raw-file scan; DELETE_OR_TRUNCATE above, used against the generated SQL strings, is unchanged. */
const SOURCE_DELETE_OR_TRUNCATE = /\bDELETE\s+FROM\b|\bTRUNCATE\b/i;
const STAGE_FILE_PATTERN = /(actualizar|Actualizar|geometryOption|GeometryOption|ActualizarTarget)/;
const STAGE_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/actualizar-padron");
const REVERT_SCRIPT_FILE = path.join(STAGE_DIRECTORY, "services/revertScript.ts");
/* AP-106's own DELETE statement: kept apart from this file's blanket "no DELETE" guard, the one exception besides the
   revert script (which only ever writes DELETE text into the revert file, never runs it). */
const DELETE_SQL_FILE = path.join(STAGE_DIRECTORY, "domain/deleteSql.ts");
const NO_DELETE_OR_TRUNCATE_EXCEPTIONS: readonly string[] = [REVERT_SCRIPT_FILE, DELETE_SQL_FILE];
/* AP-113: the one statement besides the apply (targetSql.ts, its own pair and geometry updates) and the revert files (which only
   write UPDATE text into the manual revert script) that may contain an UPDATE of a referencing table. */
const REASSIGN_SQL_FILE = path.join(STAGE_DIRECTORY, "domain/reassignSql.ts");
const REVERT_REASSIGN_LINES_FILE = path.join(STAGE_DIRECTORY, "services/revertReassignLines.ts");
const TARGET_SQL_FILE = path.join(STAGE_DIRECTORY, "domain/targetSql.ts");
const UPDATE_STATEMENT_EXCEPTIONS: readonly string[] = [TARGET_SQL_FILE, REVERT_SCRIPT_FILE, REASSIGN_SQL_FILE, REVERT_REASSIGN_LINES_FILE];
const SOURCE_UPDATE_STATEMENT = /["'`]UPDATE\s+(?:\$\{|%s|")/;

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

const targetWithAddressMaster: WritableTargetLayout = {
  ...targetLayout,
  columns: { ...targetLayout.columns, [PADRON_SUBJECT_SPEC.addressMasterColumn]: PADRON_SUBJECT_SPEC.addressMasterColumn },
};

const layouts: PadronLayouts = {
  staging: tableOf("stg", "catastro_paispadron_stg", Object.values(STAGING_COLUMN)),
  target: targetLayout,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "cadastral_locality", Object.values(LOCALITY_COLUMN)),
};

const READABLE_SCAN = referenceScanOf([{ schema: "carto", table: "access_point", readable: true }]);
const REFERENCE_TABLES: readonly ReferenceTable[] = READABLE_SCAN.tables;
const NO_REFERENCE_TABLES: readonly ReferenceTable[] = [];
const REASSIGN_TABLE: ReferenceTable = {
  schema: "carto",
  table: "access_point",
  reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false },
};

const withUpdates: ActualizarPadronOptions = { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, linkAddressMaster: false, pairChoices: [] };
const withoutUpdates: ActualizarPadronOptions = { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: false, linkAddressMaster: false, pairChoices: [] };

const insertColumnsOf = (sql: string): string[] => {
  const match = /INSERT INTO\s+"carto"\."padron"\s*\(([^)]*)\)/i.exec(sql);
  return match ? match[1].split(",").map((column) => column.trim()) : [];
};

const updateSetColumnsOf = (sql: string): string[] => {
  const set = /UPDATE\s+"carto"\."padron"\s+AS\s+tgt\s+SET\s+([\s\S]*?)\s+FROM\b/.exec(sql);
  if (!set) return [];
  return set[1].split(",").map((assignment) => /^\s*"([^"]+)"\s*=/.exec(assignment)?.[1] ?? "");
};

const pairedSetColumnsOf = (sql: string): string[] => {
  const pairedBlock = sql.slice(sql.indexOf('"paired_rows" AS ('));
  const set = /SET\s+([\s\S]*?)\s+FROM\b/.exec(pairedBlock);
  if (!set) return [];
  return set[1].split(/,\s*(?=")/).map((assignment) => /^\s*"([^"]+)"\s*=/.exec(assignment)?.[1] ?? "");
};

const sourceFilesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFilesUnder(entryPath) : [entryPath];
  });

const stageSourceFiles = (): string[] => {
  const uiAndApi = ["src/modules/routine-jobs/api", "src/modules/routine-jobs/ui"]
    .map((relative) => path.join(REPOSITORY_ROOT, relative))
    .flatMap((directory) => sourceFilesUnder(directory).filter((file) => STAGE_FILE_PATTERN.test(path.basename(file))));
  return [...sourceFilesUnder(STAGE_DIRECTORY), ...uiAndApi].filter((file) => /\.(ts|tsx)$/.test(file));
};

const GENERATED_SQL: ReadonlyArray<readonly [string, () => string]> = [
  ["classify with geometry updates", () => buildPadronClassifySql(layouts, withUpdates)],
  ["classify with a scan and the persist temp table insert", () => buildPadronClassifySql(layouts, withUpdates, READABLE_SCAN, { report: false, persistDeletable: true })],
  ["classify with a blocked scan", () => buildPadronClassifySql(layouts, withUpdates, referenceScanOf([]))],
  ["create delete ids temp table", () => buildCreateDeleteIdsTableSql()],
  ["create inserted ids temp table", () => buildCreateInsertedIdsTableSql()],
  ["create reassign ids temp table", () => buildCreateReassignIdsTableSql()],
  ["apply with the inserted ids store", () => buildPadronApplySql(layouts, withUpdates, { captureRevert: true, storeInsertedIds: true })],
  ["apply with geometry updates", () => buildPadronApplySql(layouts, withUpdates)],
  ["apply without geometry updates", () => buildPadronApplySql(layouts, withoutUpdates)],
  ["apply with geometry updates and revert capture", () => buildPadronApplySql(layouts, withUpdates, { captureRevert: true })],
  ["apply without geometry updates and revert capture", () => buildPadronApplySql(layouts, withoutUpdates, { captureRevert: true })],
  ["create revert table", () => buildCreateRevertTableSql()],
  ["capture address master revert", () => buildCaptureAddressMasterSql(targetWithAddressMaster)],
  ["revert index", () => buildRevertIndexSql()],
];

const APPLY_SQL: ReadonlyArray<readonly [string, () => string]> = [
  ["apply", () => buildPadronApplySql(layouts, withUpdates)],
  ["apply with revert capture", () => buildPadronApplySql(layouts, withUpdates, { captureRevert: true })],
];

describe("actualizar-padron target SQL guards", () => {
  describe("no delete or truncate", () => {
    it.each(GENERATED_SQL)("should contain no DELETE or TRUNCATE in the %s statement", (_label, build) => {
      expect(build()).not.toMatch(DELETE_OR_TRUNCATE);
    });

    it("should contain no DELETE or TRUNCATE in the sequence repair statement", () => {
      expect(buildSequenceRepairSql(targetLayout)).not.toMatch(DELETE_OR_TRUNCATE);
    });

    it("should contain no DELETE FROM or TRUNCATE statement in any source file of the stage except the revert script and the delete statement", () => {
      const files = stageSourceFiles();
      const offenders = files.filter(
        (file) => !NO_DELETE_OR_TRUNCATE_EXCEPTIONS.includes(file) && SOURCE_DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8"))
      );

      expect(files.length).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });

    it("should include the revert script and the delete statement among the scanned stage files", () => {
      const files = stageSourceFiles();

      expect(files).toContain(REVERT_SCRIPT_FILE);
      expect(files).toContain(DELETE_SQL_FILE);
    });

    it("should still match both DELETE and TRUNCATE anywhere outside the two named exceptions (regex sanity)", () => {
      expect(DELETE_OR_TRUNCATE.test("DELETE FROM x")).toBe(true);
      expect(DELETE_OR_TRUNCATE.test("delete from x")).toBe(true);
      expect(DELETE_OR_TRUNCATE.test("TRUNCATE x")).toBe(true);
      expect(DELETE_OR_TRUNCATE.test("truncate x")).toBe(true);
      expect(DELETE_OR_TRUNCATE.test("SELECT 1")).toBe(false);
    });

    it("should still match a real DELETE FROM statement and a bare TRUNCATE in the raw-source scan's own pattern", () => {
      expect(SOURCE_DELETE_OR_TRUNCATE.test("DELETE FROM x")).toBe(true);
      expect(SOURCE_DELETE_OR_TRUNCATE.test("delete  from x")).toBe(true);
      expect(SOURCE_DELETE_OR_TRUNCATE.test("TRUNCATE x")).toBe(true);
      expect(SOURCE_DELETE_OR_TRUNCATE.test("truncate x")).toBe(true);
      expect(SOURCE_DELETE_OR_TRUNCATE.test("deletePadronRows")).toBe(false);
      expect(SOURCE_DELETE_OR_TRUNCATE.test("STEP.DELETE")).toBe(false);
      expect(SOURCE_DELETE_OR_TRUNCATE.test("SELECT 1")).toBe(false);
    });
  });

  describe("UPDATE statements stay in the files that may hold them (AP-113)", () => {
    it("should contain an UPDATE statement text in no stage source file except targetSql, the revert script, the reassign statement and the reassign revert lines", () => {
      const files = stageSourceFiles();
      const offenders = files.filter((file) => !UPDATE_STATEMENT_EXCEPTIONS.includes(file) && SOURCE_UPDATE_STATEMENT.test(readFileSync(file, "utf8")));

      expect(offenders).toEqual([]);
    });

    it("should find the UPDATE text in each named exception, so the exemption is not stale", () => {
      for (const file of UPDATE_STATEMENT_EXCEPTIONS) expect(SOURCE_UPDATE_STATEMENT.test(readFileSync(file, "utf8"))).toBe(true);
    });

    it("should never contain UPDATE of a reference table in the classify, apply or delete statements", () => {
      const statements = [
        buildPadronClassifySql(layouts, withUpdates, READABLE_SCAN, { report: false, persistDeletable: true }),
        buildPadronApplySql(layouts, withUpdates, { captureRevert: true, storeInsertedIds: true }),
        buildPadronDeleteSql(layouts, REFERENCE_TABLES),
      ];

      for (const sql of statements) expect(sql).not.toMatch(/UPDATE\s+"carto"\."access_point"/);
    });

    it("should keep TRUNCATE out of every stage source file, the reassign files included", () => {
      const offenders = stageSourceFiles().filter((file) => /TRUNCATE/i.test(readFileSync(file, "utf8")));

      expect(offenders).toEqual([]);
      expect(stageSourceFiles()).toContain(REASSIGN_SQL_FILE);
      expect(stageSourceFiles()).toContain(REVERT_REASSIGN_LINES_FILE);
    });

    it("should hold no DELETE FROM in the reassign statement files, which are not DELETE exceptions", () => {
      expect(NO_DELETE_OR_TRUNCATE_EXCEPTIONS).not.toContain(REASSIGN_SQL_FILE);
      expect(NO_DELETE_OR_TRUNCATE_EXCEPTIONS).not.toContain(REVERT_REASSIGN_LINES_FILE);
    });

    it("should scope the reassign UPDATE with a WHERE on the primary key and the old ids, never an unscoped UPDATE", () => {
      const sql = buildPadronReassignSql(layouts, [REASSIGN_TABLE]);
      const update = /UPDATE[\s\S]*?RETURNING/.exec(sql)?.[0] ?? "";

      expect(update).toMatch(/WHERE rt\."gid" = best\."pk"/);
      expect(update).toContain('src."id_padron" IN (SELECT "old_id" FROM "reassign_ids")');
    });

    it("should contain no DELETE or TRUNCATE word in the reassign statement and the insert-ids table statement", () => {
      expect(buildPadronReassignSql(layouts, [REASSIGN_TABLE])).not.toMatch(DELETE_OR_TRUNCATE);
      expect(buildCreateInsertedIdsTableSql()).not.toMatch(DELETE_OR_TRUNCATE);
      expect(buildCreateReassignIdsTableSql()).not.toMatch(DELETE_OR_TRUNCATE);
    });
  });

  describe("buildPadronDeleteSql scopes its DELETE with a WHERE clause (AP-106)", () => {
    /* The statement the builder emits is one CTE chain with no semicolons (it is never run as raw multi-statement
       text), so the unscoped-DELETE guard is the substring between "DELETE FROM" and its own "RETURNING": a DELETE
       with no WHERE before RETURNING would delete every row of the table. */
    const deleteClauseOf = (sql: string): string => {
      const match = /DELETE FROM[\s\S]*?RETURNING/.exec(sql);
      if (!match) throw new Error("no DELETE FROM ... RETURNING clause found");
      return match[0];
    };

    it("should always scope the DELETE with a WHERE clause before RETURNING, never an unscoped DELETE FROM table", () => {
      const sql = buildPadronDeleteSql(layouts, REFERENCE_TABLES);

      const clause = deleteClauseOf(sql);
      expect(clause).toMatch(/^DELETE FROM "carto"\."padron" AS tgt WHERE/);
      expect(clause).toContain("WHERE");
    });

    it("should scope the DELETE on the surviving candidate ids, also with no reference table", () => {
      const sql = buildPadronDeleteSql(layouts, NO_REFERENCE_TABLES);

      const clause = deleteClauseOf(sql);
      expect(clause).toContain('WHERE tgt."id" IN (SELECT "old_id" FROM "surviving_candidates")');
    });
  });

  describe("apply storeInsertedIds (AP-113)", () => {
    const stored = (): string => buildPadronApplySql(layouts, withUpdates, { captureRevert: true, storeInsertedIds: true });

    it("should keep the inserted ids in the session temp table through a data-modifying CTE when storeInsertedIds is set", () => {
      expect(stored()).toContain(
        '"inserted_ids_store" AS (INSERT INTO pg_temp."padron_inserted_ids" ("id") SELECT ir."id" FROM "inserted_rows" AS ir RETURNING "id")'
      );
    });

    it("should leave the temp table out when storeInsertedIds is off or absent", () => {
      expect(buildPadronApplySql(layouts, withUpdates, { captureRevert: true })).not.toContain("padron_inserted_ids");
      expect(buildPadronApplySql(layouts, withUpdates, { captureRevert: true, storeInsertedIds: false })).not.toContain("padron_inserted_ids");
      expect(buildPadronApplySql(layouts, withUpdates)).not.toContain("padron_inserted_ids");
    });

    it("should define the store right after the insert CTE, before the updates", () => {
      const sql = stored();

      expect(sql.indexOf('"inserted_ids_store" AS (')).toBeGreaterThan(sql.indexOf('"inserted_rows" AS ('));
      expect(sql.indexOf('"inserted_ids_store" AS (')).toBeLessThan(sql.indexOf('"updated_rows" AS ('));
    });

    it("should leave the inserted columns and the update SET lists unchanged when the store is on", () => {
      expect(insertColumnsOf(stored())).toEqual(insertColumnsOf(buildPadronApplySql(layouts, withUpdates, { captureRevert: true })));
      expect(updateSetColumnsOf(stored())).toEqual(["geometry"]);
    });
  });

  describe("INSERT of new padrones", () => {
    it.each(APPLY_SQL)("should never list the id column in the %s statement, so the sequence assigns it", (_label, build) => {
      expect(insertColumnsOf(build())).not.toContain('"id"');
    });

    it.each(APPLY_SQL)("should list the written key columns and the geometry in the %s statement", (_label, build) => {
      expect(insertColumnsOf(build())).toEqual([
        '"type_padron"',
        '"id_cadastral_locality"',
        '"id_province"',
        '"number"',
        '"geometry"',
      ]);
    });
  });

  describe("UPDATE of paired padrones (MJ-13)", () => {
    it.each(APPLY_SQL)(
      "should set only type_padron, id_cadastral_locality, number and geometry in the %s statement, never id, id_province or id_address_master",
      (_label, build) => {
        expect(pairedSetColumnsOf(build())).toEqual(["type_padron", "id_cadastral_locality", "number", "geometry"]);
      }
    );
  });

  describe("UPDATE of changed geometries", () => {
    it.each(APPLY_SQL)("should assign only the geometry column in the SET clause of the %s statement", (_label, build) => {
      expect(updateSetColumnsOf(build())).toEqual(["geometry"]);
    });

    it("should keep the SET clause to geometry when geometry updates are off", () => {
      expect(updateSetColumnsOf(buildPadronApplySql(layouts, withoutUpdates, { captureRevert: true }))).toEqual(["geometry"]);
    });
  });
});

describe("accept-all geometries in the generated SQL (AP-116)", () => {
  const acceptAll = (base: ActualizarPadronOptions): ActualizarPadronOptions => ({ ...base, acceptAllGeometries: true });
  const ACCEPTED_ALWAYS = /\(true OR [^)]*IS NOT NULL\) AS "accepted"/;
  const builders: Array<[string, (options: ActualizarPadronOptions) => string]> = [
    ["classify", (options) => buildPadronClassifySql(layouts, options)],
    ["apply", (options) => buildPadronApplySql(layouts, options)],
  ];

  it.each(builders)("should make the %s accepted column always true when the flag is on", (_label, build) => {
    expect(build(acceptAll(withUpdates))).toMatch(ACCEPTED_ALWAYS);
  });

  it.each(builders)("should not emit the always-true accepted column in %s when the flag is off or absent", (_label, build) => {
    expect(build(withUpdates)).not.toContain("true OR");
    expect(build({ ...withUpdates, acceptAllGeometries: false })).not.toContain("true OR");
  });

  it("should keep the acceptances in the SQL when the flag is combined with accepted geometries", () => {
    const accepted = [{ typePadron: "URBANO" as const, provinceId: 1, localityId: 10, number: "200" }];

    const sql = buildPadronApplySql(layouts, acceptAll({ ...withUpdates, acceptedGeometries: accepted }));

    expect(sql).toMatch(ACCEPTED_ALWAYS);
    expect(sql).toContain("200");
  });
});
