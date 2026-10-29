import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { DESTINATION_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN, LOCALITY_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import type { ActualizarPadronOptions, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const DELETE_OR_TRUNCATE = /\b(DELETE|TRUNCATE)\b/i;
const STAGE_FILE_PATTERN = /(actualizar|Actualizar|geometryOption|GeometryOption|ActualizarTarget)/;

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

const withUpdates: ActualizarPadronOptions = { tolerance: 1, updateGeometries: true, linkAddressMaster: false };
const withoutUpdates: ActualizarPadronOptions = { tolerance: 1, updateGeometries: false, linkAddressMaster: false };

const insertColumnsOf = (sql: string): string[] => {
  const match = /INSERT INTO\s+[^(]+\(([^)]*)\)/i.exec(sql);
  return match ? match[1].split(",").map((column) => column.trim()) : [];
};

const updateSetColumnsOf = (sql: string): string[] => {
  const set = /UPDATE\s+"carto"\."padron"\s+AS\s+tgt\s+SET\s+([\s\S]*?)\s+FROM\b/.exec(sql);
  if (!set) return [];
  return set[1].split(",").map((assignment) => /^\s*"([^"]+)"\s*=/.exec(assignment)?.[1] ?? "");
};

const sourceFilesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFilesUnder(entryPath) : [entryPath];
  });

const stageSourceFiles = (): string[] => {
  const stageDirectory = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/actualizar-padron");
  const uiAndApi = ["src/modules/routine-jobs/api", "src/modules/routine-jobs/ui"]
    .map((relative) => path.join(REPOSITORY_ROOT, relative))
    .flatMap((directory) => sourceFilesUnder(directory).filter((file) => STAGE_FILE_PATTERN.test(path.basename(file))));
  return [...sourceFilesUnder(stageDirectory), ...uiAndApi].filter((file) => /\.(ts|tsx)$/.test(file));
};

const GENERATED_SQL: ReadonlyArray<readonly [string, () => string]> = [
  ["classify with geometry updates", () => buildPadronClassifySql(layouts, withUpdates)],
  ["apply with geometry updates", () => buildPadronApplySql(layouts, withUpdates)],
  ["apply without geometry updates", () => buildPadronApplySql(layouts, withoutUpdates)],
];

describe("actualizar-padron target SQL guards", () => {
  describe("no delete or truncate", () => {
    it.each(GENERATED_SQL)("should contain no DELETE or TRUNCATE in the %s statement", (_label, build) => {
      expect(build()).not.toMatch(DELETE_OR_TRUNCATE);
    });

    it("should contain no DELETE or TRUNCATE in the sequence repair statement", () => {
      expect(buildSequenceRepairSql(targetLayout)).not.toMatch(DELETE_OR_TRUNCATE);
    });

    it("should contain no DELETE or TRUNCATE in any source file of the stage", () => {
      const files = stageSourceFiles();
      const offenders = files.filter((file) => DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8")));

      expect(files.length).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });
  });

  describe("INSERT of new padrones", () => {
    it("should never list the id column, so the sequence assigns it", () => {
      expect(insertColumnsOf(buildPadronApplySql(layouts, withUpdates))).not.toContain('"id"');
    });

    it("should list the written key columns and the geometry", () => {
      expect(insertColumnsOf(buildPadronApplySql(layouts, withUpdates))).toEqual([
        '"type_padron"',
        '"id_cadastral_locality"',
        '"id_province"',
        '"number"',
        '"geometry"',
      ]);
    });
  });

  describe("UPDATE of changed geometries", () => {
    it("should assign only the geometry column in the SET clause", () => {
      expect(updateSetColumnsOf(buildPadronApplySql(layouts, withUpdates))).toEqual(["geometry"]);
    });

    it("should keep the SET clause to geometry when geometry updates are off", () => {
      expect(updateSetColumnsOf(buildPadronApplySql(layouts, withoutUpdates))).toEqual(["geometry"]);
    });
  });
});
