import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
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
const STAGE_FILE_PATTERN = /(actualizar|Actualizar|geometryOption|GeometryOption|ActualizarTarget)/;
const STAGE_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/actualizar-padron");
const REVERT_SCRIPT_FILE = path.join(STAGE_DIRECTORY, "services/revertScript.ts");

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

const withUpdates: ActualizarPadronOptions = { tolerance: 1, updateGeometries: true, linkAddressMaster: false };
const withoutUpdates: ActualizarPadronOptions = { tolerance: 1, updateGeometries: false, linkAddressMaster: false };

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

    it("should contain no DELETE or TRUNCATE in any source file of the stage except the revert script", () => {
      const files = stageSourceFiles();
      const offenders = files.filter(
        (file) => file !== REVERT_SCRIPT_FILE && DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8"))
      );

      expect(files.length).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });

    it("should include the revert script among the scanned stage files", () => {
      expect(stageSourceFiles()).toContain(REVERT_SCRIPT_FILE);
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
