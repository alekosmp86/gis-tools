import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
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
