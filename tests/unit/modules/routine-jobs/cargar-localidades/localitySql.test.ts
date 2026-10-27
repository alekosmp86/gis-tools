import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildApplySql, buildClassifySql } from "@/modules/routine-jobs/jobs/cargar-localidades/domain/targetSql";
import { buildSourceReportSql, type SourceLayouts } from "@/modules/routine-jobs/jobs/cargar-localidades/domain/sourceSql";
import {
  LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE,
  LOCALIDADES_TABLE_ROLE,
} from "@/modules/routine-jobs/jobs/cargar-localidades/constants";
import type { LocalityOptions, LocalityTargetLayout } from "@/modules/routine-jobs/jobs/cargar-localidades/types";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const JOB_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/cargar-localidades");
const DELETE_OR_TRUNCATE = /\b(DELETE|TRUNCATE)\b/i;
const WRITTEN_INSERT_COLUMNS = ['"code"', '"name"', '"geometry"', '"id_font_type"', '"id_province"'];

const identity = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const sourceLayouts: SourceLayouts = {
  padron: {
    schema: "stg",
    table: "padron_stg",
    columns: identity(LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.STAGING_PADRON]),
  },
  localities: {
    schema: "stg",
    table: "localidades_stg",
    columns: identity(LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.STAGING_LOCALIDAD]),
  },
  province: {
    schema: "carto",
    table: "province",
    columns: identity(LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.PROVINCE]),
  },
};

const targetLayout: LocalityTargetLayout = {
  schema: "carto",
  table: "cadastral_locality",
  columns: identity(LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.TARGET]),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.cadastral_locality_id_seq",
  identityColumns: [],
  catalog: [],
};

const withUpdates: LocalityOptions = { tolerance: 1, updateGeometries: true };
const withoutUpdates: LocalityOptions = { tolerance: 1, updateGeometries: false };

const insertColumnsOf = (sql: string): string[] => {
  const match = /INSERT INTO\s+[^(]+\(([^)]*)\)/i.exec(sql);
  return match ? match[1].split(",").map((column) => column.trim()) : [];
};

const updateSetColumnsOf = (sql: string): string[] => {
  const match = /\bUPDATE\b[\s\S]*?\bSET\b([\s\S]*?)\bFROM\b/i.exec(sql);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"\s*=/g)].map((assignment) => assignment[1]);
};

const stripQuotedText = (sql: string): string => sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''");

const parenthesisBalanceOf = (sql: string): { depth: number; minDepth: number } => {
  let depth = 0;
  let minDepth = 0;
  for (const character of stripQuotedText(sql)) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    minDepth = Math.min(minDepth, depth);
  }
  return { depth, minDepth };
};

const segmentBetween = (sql: string, start: string, end: string): string => {
  const startIndex = sql.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = sql.indexOf(end, startIndex);
  return sql.slice(startIndex, endIndex < 0 ? undefined : endIndex);
};

const CLASSIFY_AND_APPLY_STATEMENTS: ReadonlyArray<readonly [string, () => string]> = [
  ["classify with geometry updates", () => buildClassifySql(sourceLayouts, targetLayout, withUpdates)],
  ["classify without geometry updates", () => buildClassifySql(sourceLayouts, targetLayout, withoutUpdates)],
  ["apply with geometry updates", () => buildApplySql(sourceLayouts, targetLayout, withUpdates)],
  ["apply without geometry updates", () => buildApplySql(sourceLayouts, targetLayout, withoutUpdates)],
];

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFilesUnder(entryPath) : [entryPath];
  });
}

describe("cargar-localidades SQL builders (MJ-13)", () => {
  describe("buildApplySql INSERT", () => {
    it("should insert only the five written columns and never the id column of the target", () => {
      const sql = buildApplySql(sourceLayouts, targetLayout, withUpdates);

      expect(insertColumnsOf(sql)).toEqual(WRITTEN_INSERT_COLUMNS);
      expect(insertColumnsOf(sql)).not.toContain('"id"');
    });

    it("should keep the same insert list when geometry updates are off", () => {
      const sql = buildApplySql(sourceLayouts, targetLayout, withoutUpdates);

      expect(insertColumnsOf(sql)).toEqual(WRITTEN_INSERT_COLUMNS);
    });
  });

  describe("buildApplySql UPDATE", () => {
    it("should set only the geometry column in the UPDATE SET clause, never id", () => {
      const sql = buildApplySql(sourceLayouts, targetLayout, withUpdates);

      expect(sql).toMatch(/\bUPDATE\b/);
      expect(updateSetColumnsOf(sql)).toEqual(["geometry"]);
    });

    it("should match the updated row by its target id and never assign it", () => {
      const sql = buildApplySql(sourceLayouts, targetLayout, withUpdates);

      expect(sql).toMatch(/tgt\."id"\s*=\s*cl\."target_id"/);
      expect(updateSetColumnsOf(sql)).not.toContain("id");
    });

    it("should emit no UPDATE statement at all when geometry updates are off", () => {
      const sql = buildApplySql(sourceLayouts, targetLayout, withoutUpdates);

      expect(sql).not.toMatch(/\bUPDATE\b/);
    });
  });

  describe("generated SQL is syntactically well formed (regression)", () => {
    it.each(CLASSIFY_AND_APPLY_STATEMENTS)("should have no comma directly before FROM in the %s statement", (_label, build) => {
      expect(build()).not.toMatch(/,\s*FROM\b/i);
    });

    it.each(CLASSIFY_AND_APPLY_STATEMENTS)("should select the equal flag directly before FROM in the %s statement", (_label, build) => {
      expect(build()).toContain('AS "equal" FROM');
    });

    it.each(CLASSIFY_AND_APPLY_STATEMENTS)("should balance parentheses in the %s statement", (_label, build) => {
      expect(parenthesisBalanceOf(build())).toEqual({ depth: 0, minDepth: 0 });
    });
  });

  describe("stage 2 write gating", () => {
    const applyWithUpdates = (): string => buildApplySql(sourceLayouts, targetLayout, withUpdates);

    it.each(CLASSIFY_AND_APPLY_STATEMENTS)("should join the matched target only when the target has exactly one row in the %s statement", (_label, build) => {
      expect(build()).toContain('ON t1."id" = ct."target_id" AND ct."target_rows" = 1');
    });

    it("should insert only rows classified NEW", () => {
      const insert = segmentBetween(applyWithUpdates(), "INSERT INTO", "RETURNING");

      expect(insert).toContain(`WHERE cl."class" = 'NEW'`);
    });

    it("should update only rows classified CHANGED", () => {
      const update = segmentBetween(applyWithUpdates(), "UPDATE ", "RETURNING");

      expect(update).toContain(`WHERE cl."class" = 'CHANGED'`);
    });

    it("should never insert or update AMBIGUOUS rows", () => {
      const sql = applyWithUpdates();

      expect(segmentBetween(sql, "INSERT INTO", "RETURNING")).not.toContain("AMBIGUOUS");
      expect(segmentBetween(sql, "UPDATE ", "RETURNING")).not.toContain("AMBIGUOUS");
    });
  });

  describe("generated SQL never deletes or truncates (MJ-13)", () => {
    it.each([
      ["classify", () => buildClassifySql(sourceLayouts, targetLayout, withUpdates)],
      ["apply with geometry updates", () => buildApplySql(sourceLayouts, targetLayout, withUpdates)],
      ["apply without geometry updates", () => buildApplySql(sourceLayouts, targetLayout, withoutUpdates)],
      ["source report", () => buildSourceReportSql(sourceLayouts)],
    ])("should contain no DELETE or TRUNCATE in the %s statement", (_label, build) => {
      expect(build()).not.toMatch(DELETE_OR_TRUNCATE);
    });

    it("should contain no DELETE or TRUNCATE in any source file of the cargar-localidades job", () => {
      const files = sourceFilesUnder(JOB_DIRECTORY).filter((file) => file.endsWith(".ts"));
      const offenders = files.filter((file) => DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8")));

      expect(files.length).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });
  });
});
