import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildUnitApplySql, buildUnitClassifySql } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/targetSql";
import { buildUnitSourceReportSql } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/sourceSql";
import { UNIT_SOURCE_COLUMN, UNIT_TARGET_COLUMN, UNIT_TYPE_COLUMN } from "@/modules/routine-jobs/jobs/unidad-territorial/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import type { UnitLayouts, UnitOptions } from "@/modules/routine-jobs/jobs/unidad-territorial/types";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const JOB_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/unidad-territorial");
const DELETE_OR_TRUNCATE = /\b(DELETE|TRUNCATE)\b/i;
const WRITTEN_INSERT_COLUMNS = ['"name"', '"id_territorial_unit_type"', '"id_font"', '"id_province"', '"geometry"'];
const UPDATE_SET_COLUMNS = ["geometry", "id_font"];
const FORBIDDEN_SET_COLUMNS = ["id", "id_address_master", "name", "id_province", "id_territorial_unit_type"];
const RESOLVED_TYPE_ID = 42;
const OTHER_TYPE_ID = 7;

const identity = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const localityLayout: TableLayout = {
  schema: "stg",
  table: "localidades_catastrales_stg",
  columns: identity(Object.values(UNIT_SOURCE_COLUMN)),
};

const typeLayout: TableLayout = {
  schema: "carto",
  table: "tipo_unidad",
  columns: identity(Object.values(UNIT_TYPE_COLUMN)),
};

const targetLayout: WritableTargetLayout = {
  schema: "carto",
  table: "territorial_unit",
  columns: identity(Object.values(UNIT_TARGET_COLUMN)),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.territorial_unit_id_seq",
  identityColumns: [],
  catalog: [],
};

const layoutsWith = (unitTypeId: number): UnitLayouts => ({
  locality: localityLayout,
  type: typeLayout,
  target: targetLayout,
  unitTypeId,
});

const layouts = layoutsWith(RESOLVED_TYPE_ID);

const withUpdates: UnitOptions = { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true };
const withoutUpdates: UnitOptions = { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: false };

const insertColumnsOf = (sql: string): string[] => {
  const match = /INSERT INTO\s+[^(]+\(([^)]*)\)/i.exec(sql);
  return match ? match[1].split(",").map((column) => column.trim()) : [];
};

const clauseUntilTopLevelKeyword = (text: string, keyword: string): string => {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    const isKeywordAt =
      depth === 0 &&
      text.startsWith(keyword, index) &&
      /\W/.test(text[index - 1] ?? " ") &&
      /\W/.test(text[index + keyword.length] ?? " ");
    if (isKeywordAt) return text.slice(0, index);
  }
  return text;
};

const topLevelItemsOf = (text: string): string[] => {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      items.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  items.push(current);
  return items;
};

const updateSetColumnsOf = (sql: string): string[] => {
  const updateStart = sql.search(/\bUPDATE\b/);
  if (updateStart < 0) return [];
  const fromUpdate = sql.slice(updateStart);
  const setStart = fromUpdate.search(/\bSET\b/);
  const setClause = clauseUntilTopLevelKeyword(fromUpdate.slice(setStart + "SET".length), "FROM");
  return topLevelItemsOf(setClause)
    .map((assignment) => /^\s*"([^"]+)"\s*=/.exec(assignment)?.[1])
    .filter((column): column is string => column !== undefined);
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
  ["classify with geometry updates", () => buildUnitClassifySql(layouts, withUpdates)],
  ["classify without geometry updates", () => buildUnitClassifySql(layouts, withoutUpdates)],
  ["apply with geometry updates", () => buildUnitApplySql(layouts, withUpdates)],
  ["apply without geometry updates", () => buildUnitApplySql(layouts, withoutUpdates)],
];

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFilesUnder(entryPath) : [entryPath];
  });
}

describe("unidad-territorial SQL builders (MJ-13)", () => {
  describe("buildUnitApplySql INSERT", () => {
    it("should insert only the five written columns in their documented order", () => {
      const sql = buildUnitApplySql(layouts, withUpdates);

      expect(insertColumnsOf(sql)).toEqual(WRITTEN_INSERT_COLUMNS);
    });

    it("should never list the target id column in the INSERT, so the sequence assigns it", () => {
      const sql = buildUnitApplySql(layouts, withUpdates);

      expect(insertColumnsOf(sql)).not.toContain('"id"');
    });

    it("should keep the same INSERT list when geometry updates are off", () => {
      const sql = buildUnitApplySql(layouts, withoutUpdates);

      expect(insertColumnsOf(sql)).toEqual(WRITTEN_INSERT_COLUMNS);
    });
  });

  describe("buildUnitApplySql UPDATE", () => {
    it("should assign only geometry and id_font in the UPDATE SET clause", () => {
      const sql = buildUnitApplySql(layouts, withUpdates);

      expect(sql).toMatch(/\bUPDATE\b/);
      expect(updateSetColumnsOf(sql)).toEqual(UPDATE_SET_COLUMNS);
    });

    it.each(FORBIDDEN_SET_COLUMNS)("should never assign the protected column %s in the UPDATE SET clause", (column) => {
      const sql = buildUnitApplySql(layouts, withUpdates);

      expect(updateSetColumnsOf(sql)).not.toContain(column);
    });

    it("should keep the UPDATE SET to geometry and id_font when geometry updates are off", () => {
      const sql = buildUnitApplySql(layouts, withoutUpdates);

      expect(updateSetColumnsOf(sql)).toEqual(UPDATE_SET_COLUMNS);
    });

    it("should match the updated row by its target id and never assign it", () => {
      const sql = buildUnitApplySql(layouts, withUpdates);

      expect(sql).toMatch(/tgt\."id"\s*=\s*cl\."target_id"/);
      expect(updateSetColumnsOf(sql)).not.toContain("id");
    });
  });

  describe("match key includes the resolved unit type id", () => {
    it("should filter the target rows by the resolved type id in the classify statement", () => {
      const sql = buildUnitClassifySql(layouts, withUpdates);

      expect(sql).toContain(`tgt."id_territorial_unit_type" = ${RESOLVED_TYPE_ID}`);
    });

    it("should filter the target rows by the resolved type id in the apply statement", () => {
      const sql = buildUnitApplySql(layouts, withUpdates);

      expect(sql).toContain(`tgt."id_territorial_unit_type" = ${RESOLVED_TYPE_ID}`);
    });

    it("should filter by the new type id and not the old one when the resolved type changes", () => {
      const sql = buildUnitClassifySql(layoutsWith(OTHER_TYPE_ID), withUpdates);

      expect(sql).toContain(`tgt."id_territorial_unit_type" = ${OTHER_TYPE_ID}`);
      expect(sql).not.toContain(`tgt."id_territorial_unit_type" = ${RESOLVED_TYPE_ID}`);
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

  describe("stage 3 write gating", () => {
    it.each(CLASSIFY_AND_APPLY_STATEMENTS)("should join the matched target only when the target has exactly one row in the %s statement", (_label, build) => {
      expect(build()).toContain('ON t1."id" = ct."target_id" AND ct."target_rows" = 1');
    });

    it.each([
      ["with geometry updates", withUpdates],
      ["without geometry updates", withoutUpdates],
    ])("should update only UNCHANGED, WITHIN_TOLERANCE or CHANGED rows %s", (_label, options) => {
      const update = segmentBetween(buildUnitApplySql(layouts, options), "UPDATE ", "RETURNING");

      expect(update).toContain(`WHERE cl."class" IN ('UNCHANGED', 'WITHIN_TOLERANCE', 'CHANGED')`);
    });

    it("should never update AMBIGUOUS rows", () => {
      const update = segmentBetween(buildUnitApplySql(layouts, withUpdates), "UPDATE ", "RETURNING");

      expect(update).not.toContain("AMBIGUOUS");
    });

    it("should insert only rows classified NEW", () => {
      const insert = segmentBetween(buildUnitApplySql(layouts, withUpdates), "INSERT INTO", "RETURNING");

      expect(insert).toContain(`WHERE cl."class" = 'NEW'`);
    });

    it("should never insert AMBIGUOUS rows", () => {
      const insert = segmentBetween(buildUnitApplySql(layouts, withUpdates), "INSERT INTO", "RETURNING");

      expect(insert).not.toContain("AMBIGUOUS");
    });
  });

  describe("generated SQL never deletes or truncates (MJ-13)", () => {
    it.each([
      ["classify", () => buildUnitClassifySql(layouts, withUpdates)],
      ["apply with geometry updates", () => buildUnitApplySql(layouts, withUpdates)],
      ["apply without geometry updates", () => buildUnitApplySql(layouts, withoutUpdates)],
      ["source report", () => buildUnitSourceReportSql({ locality: localityLayout })],
    ])("should contain no DELETE or TRUNCATE in the %s statement", (_label, build) => {
      expect(build()).not.toMatch(DELETE_OR_TRUNCATE);
    });

    it("should contain no DELETE or TRUNCATE in any source file of the unidad-territorial job", () => {
      const files = sourceFilesUnder(JOB_DIRECTORY).filter((file) => file.endsWith(".ts"));
      const offenders = files.filter((file) => DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8")));

      expect(files.length).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });
  });
});
