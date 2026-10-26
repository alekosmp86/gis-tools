import { describe, it, expect } from "vitest";
import {
  buildAmbiguousLocalityCodesSql,
  buildClearSql,
  buildConflictSamplesSql,
  buildCountSql,
  buildGeometryReportSql,
  buildLoadSql,
  type LoadOptions,
  type SourceLayout,
  type TargetLayout,
} from "@/modules/routine-jobs/jobs/cargar-padrones/domain/loadSql";
import {
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/cargar-padrones/constants";

const identity = (columns: readonly string[], overrides: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, overrides[column] ?? column]));

const ruralSource = (overrides: Record<string, string> = {}, table = "paisrural"): SourceLayout => ({
  schema: "cat",
  table,
  columns: identity(RURAL_REQUIRED_COLUMNS, overrides),
});

const urbanSource = (overrides: Record<string, string> = {}, table = "paisurbano"): SourceLayout => ({
  schema: "cat",
  table,
  columns: identity(URBANO_REQUIRED_COLUMNS, overrides),
});

const targetLayout = (srid = 32721, overrides: Record<string, string> = {}, table = "padron"): TargetLayout => ({
  schema: "cat",
  table,
  columns: identity(TARGET_REQUIRED_COLUMNS, overrides),
  srid,
});

const repairOn: LoadOptions = { repair: true, clearMode: "delete", resetSequences: true };
const repairOff: LoadOptions = { repair: false, clearMode: "delete", resetSequences: true };

const flat = (sql: string): string => sql.replace(/\s+/g, " ").trim();

const groupingClauses = (sql: string): string[] =>
  Array.from(
    flat(sql).matchAll(/(?:GROUP BY|PARTITION BY|DISTINCT ON\s*\()\s*([^)]*?)\s*(?:\)|ORDER BY|HAVING|LIMIT|;|$)/gi),
    (match) => match[1]
  );

const nullAwareComparison = (column: string): RegExp =>
  new RegExp(
    String.raw`count\(\*\)\s*(?:<>|!=|>)\s*count\(\s*"${column}"\s*\)|count\(\*\)\s*FILTER\s*\(\s*WHERE\s*"${column}"\s+IS NULL|"${column}"\s+IS DISTINCT FROM|bool_or\(\s*"${column}"\s+IS NULL`,
    "i"
  );

const aliasEnd = (sql: string, alias: string): number => sql.indexOf(`AS "${alias}"`);

const repairedSegment = (sql: string): string => sql.slice(aliasEnd(sql, "rowsRead"), aliasEnd(sql, "repaired"));

const conflictSegment = (sql: string): string => sql.slice(aliasEnd(sql, "groups"), aliasEnd(sql, "attributeConflicts"));

const RURAL_CONFLICT_COLUMNS = RURAL_REQUIRED_COLUMNS.filter((column) => !["gid", "geom", "nomdepto", "padron"].includes(column));
const URBANO_CONFLICT_COLUMNS = URBANO_REQUIRED_COLUMNS.filter(
  (column) => !["gid", "geom", "nomdepto", "nomloccat", "padron"].includes(column)
);

const fullConflictPredicate = (column: string): RegExp =>
  new RegExp(
    String.raw`count\(DISTINCT "${column}"\) > 1 OR \(count\(\*\) <> count\("${column}"\) AND count\("${column}"\) > 0\)`
  );

const LOADED_ROWS_THEN_HAVING =
  /FROM prepared WHERE "geom_usable" IS NOT NULL AND NOT ST_IsEmpty\("geom_usable"\) GROUP BY [^()]*? HAVING/;

describe("loadSql", () => {
  describe("buildClearSql", () => {
    it("AC-15: should emit DELETE FROM with the quoted qualified table in delete mode", () => {
      const sql = flat(buildClearSql(targetLayout(), "delete"));

      expect(sql).toMatch(/^DELETE FROM "cat"\."padron"\s*;?$/i);
    });

    it("AC-15: should emit TRUNCATE on the quoted qualified table without CASCADE in truncate mode", () => {
      const sql = flat(buildClearSql(targetLayout(), "truncate"));

      expect(sql).toMatch(/^TRUNCATE( TABLE)? "cat"\."padron"\s*;?$/i);
      expect(sql).not.toMatch(/CASCADE/i);
    });

    it("AC-15: should never emit CASCADE in delete mode", () => {
      expect(buildClearSql(targetLayout(), "delete")).not.toMatch(/CASCADE/i);
    });

    it("AC-15: should escape double quotes inside schema and table identifiers", () => {
      const target: TargetLayout = { ...targetLayout(), schema: 'sc"hema', table: 'ta"ble' };

      expect(buildClearSql(target, "delete")).toContain('"sc""hema"."ta""ble"');
      expect(buildClearSql(target, "truncate")).toContain('"sc""hema"."ta""ble"');
    });
  });

  describe("buildCountSql", () => {
    it("AC-5: should count the rows of the quoted source table", () => {
      const sql = flat(buildCountSql(ruralSource()));

      expect(sql).toMatch(/^SELECT count\(\*\)/i);
      expect(sql).toContain('FROM "cat"."paisrural"');
    });

    it("AC-5: should quote a source table that contains a double quote", () => {
      expect(buildCountSql(ruralSource({}, 'pa"is'))).toContain('"cat"."pa""is"');
    });
  });

  describe("buildLoadSql structure", () => {
    it("AC-7: should be a single INSERT ... SELECT into the quoted target table from the quoted source table", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/^INSERT INTO "cat"\."padron"/i);
      expect(sql).toMatch(/\bSELECT\b/i);
      expect(sql).toContain('"cat"."paisrural"');
      expect(sql.replace(/;\s*$/, "")).not.toContain(";");
    });

    it("AC-7: should list the real target column names in the INSERT column list", () => {
      const sql = buildLoadSql("RURAL", ruralSource(), targetLayout(32721, { nomdepto: "dpto_destino" }), repairOn);

      expect(sql).toContain('"dpto_destino"');
    });

    it("AC-7: should use the resolved real source column names instead of the logical ones", () => {
      const sql = buildLoadSql(
        "RURAL",
        ruralSource({ nomdepto: "DEPTO_NOM", padron: "NRO_PADRON", gid: "ID_FILA", geom: "the_geom" }),
        targetLayout(),
        repairOn
      );

      expect(sql).toContain('"DEPTO_NOM"');
      expect(sql).toContain('"NRO_PADRON"');
      expect(sql).toContain('"ID_FILA"');
      expect(sql).toContain('"the_geom"');
      const clauses = groupingClauses(sql);
      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause).toContain('"DEPTO_NOM"');
        expect(clause).toContain('"NRO_PADRON"');
      }
    });

    it("AC-7: should escape a double quote inside source table and column identifiers", () => {
      const sql = buildLoadSql(
        "RURAL",
        ruralSource({ nomdepto: 'no"mdepto' }, 'pa"is'),
        targetLayout(),
        repairOn
      );

      expect(sql).toContain('"cat"."pa""is"');
      expect(sql).toContain('"no""mdepto"');
      expect(sql).not.toContain('"pa"is"');
    });
  });

  describe("buildLoadSql grouping", () => {
    it("AC-7: should group rural rows by nomdepto and padron only", () => {
      const clauses = groupingClauses(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));

      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause).toMatch(/"nomdepto"\s*,\s*"padron"/);
        expect(clause).not.toMatch(/coddepto|codloccat/);
      }
    });

    it("AC-7: should group urban rows by nomdepto, nomloccat and padron and never by the code columns", () => {
      const clauses = groupingClauses(buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOn));

      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause).toMatch(/"nomdepto"\s*,\s*"nomloccat"\s*,\s*"padron"/);
        expect(clause).not.toMatch(/coddepto|codloccat/);
      }
    });

    it("AC-7: should group the same way when repair is off", () => {
      const clauses = groupingClauses(buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOff));

      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause).toMatch(/"nomdepto"\s*,\s*"nomloccat"\s*,\s*"padron"/);
        expect(clause).not.toMatch(/coddepto|codloccat/);
      }
    });
  });

  describe("buildLoadSql attributes", () => {
    it("AC-9: should take the group attributes from the first row ordered by gid ascending", () => {
      const sql = flat(buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/ORDER BY[^)]*"gid"(\s+ASC)?/i);
      expect(sql).not.toMatch(/"gid"\s+DESC/i);
    });

    it("AC-9: should order by the resolved real gid column", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource({ gid: "objectid" }), targetLayout(), repairOn));

      expect(sql).toMatch(/ORDER BY[^)]*"objectid"/i);
    });

    it("AC-9: should set unidadcat to the RURAL literal for rural rows only", () => {
      const sql = buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn);

      expect(sql).toContain("'RURAL'");
      expect(sql).not.toContain("'URBANO'");
    });

    it("AC-9: should set unidadcat to the URBANO literal for urban rows only", () => {
      const sql = buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOn);

      expect(sql).toContain("'URBANO'");
      expect(sql).not.toContain("'RURAL'");
    });

    it("AC-9: should set archivo to the source table name as a string literal", () => {
      const sql = buildLoadSql("RURAL", ruralSource({}, "paisrural_2024"), targetLayout(), repairOn);

      expect(sql).toContain("'paisrural_2024'");
    });

    it("AC-9: should escape a single quote in the archivo literal", () => {
      const sql = buildLoadSql("RURAL", ruralSource({}, "pais'rural"), targetLayout(), repairOn);

      expect(sql).toContain("'pais''rural'");
    });

    it("AC-9: should emit NULL for the columns the source does not have", () => {
      const rural = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));
      const urban = flat(buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOn));

      expect(rural).toMatch(/\bNULL\b/);
      expect(urban).toMatch(/\bNULL\b/);
    });

    it("AC-14: should not format the padron value", () => {
      const sql = buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn);

      expect(sql).not.toMatch(/to_char\(|lpad\(|format\(/i);
    });
  });

  describe("buildLoadSql null keys", () => {
    it("AC-10: should exclude rural rows with a NULL nomdepto or padron", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/"nomdepto"\s+IS NOT NULL/i);
      expect(sql).toMatch(/"padron"\s+IS NOT NULL/i);
    });

    it("AC-10: should exclude urban rows with a NULL nomdepto, nomloccat or padron", () => {
      const sql = flat(buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/"nomdepto"\s+IS NOT NULL/i);
      expect(sql).toMatch(/"nomloccat"\s+IS NOT NULL/i);
      expect(sql).toMatch(/"padron"\s+IS NOT NULL/i);
    });
  });

  describe("buildLoadSql geometry", () => {
    it.each([
      ["RURAL", ruralSource()],
      ["URBANO", urbanSource()],
    ] as const)("AC-8: should build ST_Multi(ST_Union(...)) for every group of %s rows", (kind, source) => {
      const sql = flat(buildLoadSql(kind, source, targetLayout(), repairOn));

      expect(sql).toMatch(/ST_Multi\(\s*ST_Union\(/i);
    });

    it("AC-8: should reproject to the target SRID with ST_Transform when the SRID is not 0", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(32721), repairOn));

      expect(sql).toMatch(/ST_Transform\(/i);
      expect(sql).toContain("32721");
    });

    it("AC-8: should not call ST_Transform when the target SRID is 0", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(0), repairOn));

      expect(sql).not.toMatch(/ST_Transform/i);
    });

    it("AC-8: should still union single-row groups (no row-count shortcut around ST_Union)", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/ST_Union\(/i);
      expect(sql).not.toMatch(/count\(\*\)\s*=\s*1/i);
    });

    it("AC-6: should repair invalid geometries with ST_MakeValid and keep the polygonal part when repair is on", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/NOT\s+ST_IsValid\(|ST_IsValid\([^)]*\)\s*(=\s*false|IS\s+FALSE)/i);
      expect(sql).toMatch(/ST_CollectionExtract\(\s*ST_MakeValid\(/i);
      expect(sql).toMatch(/,\s*3\s*\)/);
    });

    it("AC-6: should exclude rows whose geometry is NULL or empty when repair is on", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOn));

      expect(sql).toMatch(/"geom"\s+IS NOT NULL/i);
      expect(sql).toMatch(/ST_IsEmpty\(/i);
    });

    it("AC-6: should exclude rows whose geometry is NULL or empty when repair is off", () => {
      const sql = flat(buildLoadSql("URBANO", urbanSource(), targetLayout(), repairOff));

      expect(sql).toMatch(/"geom"\s+IS NOT NULL/i);
      expect(sql).toMatch(/ST_IsEmpty\(/i);
    });

    it("AC-6: should not run a per-row repair step when repair is off", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOff));

      expect(sql).not.toMatch(/ST_CollectionExtract\(\s*ST_MakeValid\(/i);
    });

    it("AC-6: should extract the polygonal part of the multi-row union before ST_Multi when repair is off", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOff));

      expect(sql).toMatch(
        /ST_Multi\((?:(?!ST_Multi).)*?ST_CollectionExtract\((?:(?!ST_Multi).)*?ST_Union\((?:(?!ST_Multi).)*?ST_MakeValid\((?:(?!ST_Multi).)*?,\s*3\s*\)/i
      );
      expect(sql.match(/ST_CollectionExtract\(/gi)).toHaveLength(1);
    });

    it("AC-6: should apply ST_MakeValid only for the union of multi-row groups when repair is off", () => {
      const sql = flat(buildLoadSql("RURAL", ruralSource(), targetLayout(), repairOff));

      expect(sql).toMatch(/ST_MakeValid\(/i);
      expect(sql).toMatch(/count\(\*\)\s*>\s*1|CASE/i);
    });

    it("AC-6: should use the resolved real geometry column name", () => {
      const sql = buildLoadSql(
        "RURAL",
        ruralSource({ geom: "the_geom" }),
        targetLayout(32721, { geom: "target_geom" }),
        repairOn
      );

      expect(sql).toContain('"the_geom"');
      expect(sql).not.toContain('"geom"');
    });
  });

  describe("buildGeometryReportSql", () => {
    it("AC-13: should report rows read, no-geometry, null-key rows and groups for rural", () => {
      const sql = flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn));

      expect(sql).toMatch(/rowsRead/);
      expect(sql).toMatch(/noGeometry/);
      expect(sql).toMatch(/nullKeyRows/);
      expect(sql).toMatch(/\bgroups\b/);
      expect(sql).toContain('"cat"."paisrural"');
    });

    it("AC-6: should report repaired (and not insertedInvalid) when repair is on", () => {
      const sql = flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn));

      expect(sql).toMatch(/\brepaired\b/);
      expect(sql).not.toMatch(/insertedInvalid|repairedInUnion/);
    });

    it("AC-6: should report insertedInvalid and repairedInUnion (and not repaired) when repair is off", () => {
      const sql = flat(buildGeometryReportSql("URBANO", urbanSource(), repairOff));

      expect(sql).toMatch(/insertedInvalid/);
      expect(sql).toMatch(/repairedInUnion/);
      expect(sql).not.toMatch(/\brepaired\b/);
    });

    it("AC-7: should count urban groups by nomdepto, nomloccat and padron and never group by the code columns", () => {
      const sql = flat(buildGeometryReportSql("URBANO", urbanSource(), repairOn));

      expect(sql).toContain('"nomloccat"');
      for (const clause of groupingClauses(sql)) {
        expect(clause).not.toMatch(/coddepto|codloccat/);
      }
    });

    it("AC-7: should count rural groups by nomdepto and padron and never group by the code column", () => {
      const sql = flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn));

      expect(sql).toContain('"nomdepto"');
      expect(sql).toContain('"padron"');
      for (const clause of groupingClauses(sql)) {
        expect(clause).not.toMatch(/coddepto/);
      }
    });

    it("AC-11: should include coddepto in the rural conflict detection of the report", () => {
      const sql = flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn));

      expect(conflictSegment(sql)).toContain('"coddepto"');
    });

    it("AC-11: should include coddepto and codloccat in the urban conflict detection of the report", () => {
      const segment = conflictSegment(flat(buildGeometryReportSql("URBANO", urbanSource(), repairOn)));

      expect(segment).toContain('"coddepto"');
      expect(segment).toContain('"codloccat"');
    });

    it("AC-11: should count a NULL against a value as a conflict in the report (rural coddepto)", () => {
      const segment = conflictSegment(flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn)));

      expect(segment).toMatch(nullAwareComparison("coddepto"));
    });

    it("AC-11: should count a NULL against a value as a conflict in the report (urban codloccat)", () => {
      const segment = conflictSegment(flat(buildGeometryReportSql("URBANO", urbanSource(), repairOn)));

      expect(segment).toMatch(nullAwareComparison("codloccat"));
    });

    it("AC-11: should compute report conflicts over the loaded rows only (usable key and geometry)", () => {
      const segment = conflictSegment(flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn)));

      expect(segment).toMatch(/ST_IsEmpty\(|\b(?:prepared|loaded)\b/i);
      expect(segment).not.toMatch(/FROM\s+"cat"\."paisrural"(?![\s\S]*ST_IsEmpty\()/i);
    });

    it("AC-14b: should count repaired only for rows whose repaired geometry is non-empty and not NULL", () => {
      const segment = repairedSegment(flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn)));

      expect(segment).toMatch(/NOT\s+ST_IsEmpty\(|ST_IsEmpty\([^)]*\)\s*(=\s*false|IS\s+FALSE)/i);
      expect(segment).toMatch(/IS NOT NULL/i);
    });

    it("AC-14b: should apply the same repaired-only-if-usable rule to the urban report", () => {
      const segment = repairedSegment(flat(buildGeometryReportSql("URBANO", urbanSource(), repairOn)));

      expect(segment).toMatch(/NOT\s+ST_IsEmpty\(|ST_IsEmpty\([^)]*\)\s*(=\s*false|IS\s+FALSE)/i);
      expect(segment).toMatch(/IS NOT NULL/i);
    });
  });

  describe("buildConflictSamplesSql", () => {
    it("AC-11: should sample at most 20 conflicting groups with at most 5 values each", () => {
      const sql = flat(buildConflictSamplesSql("RURAL", ruralSource()));

      expect(sql).toMatch(/LIMIT\s+20\b/i);
      expect(sql).toMatch(/\b5\b/);
      expect(sql).toContain('"cat"."paisrural"');
    });

    it("AC-11: should find urban conflicts per (nomdepto, nomloccat, padron) group", () => {
      const clauses = groupingClauses(buildConflictSamplesSql("URBANO", urbanSource()));

      expect(clauses.length).toBeGreaterThan(0);
      expect(clauses.some((clause) => /"nomdepto"\s*,\s*"nomloccat"\s*,\s*"padron"/.test(clause))).toBe(true);
      for (const clause of clauses) {
        expect(clause).not.toMatch(/coddepto|codloccat/);
      }
    });
  });

  describe("buildConflictSamplesSql coverage (AC-11)", () => {
    it("AC-11: should compare coddepto across the rows of a rural group", () => {
      expect(buildConflictSamplesSql("RURAL", ruralSource())).toContain('"coddepto"');
    });

    it("AC-11: should compare coddepto and codloccat across the rows of an urban group", () => {
      const sql = buildConflictSamplesSql("URBANO", urbanSource());

      expect(sql).toContain('"coddepto"');
      expect(sql).toContain('"codloccat"');
    });

    it("AC-11: should count a NULL against a value as a conflict for the rural code column", () => {
      expect(flat(buildConflictSamplesSql("RURAL", ruralSource()))).toMatch(nullAwareComparison("coddepto"));
    });

    it("AC-11: should count a NULL against a value as a conflict for the urban code columns", () => {
      const sql = flat(buildConflictSamplesSql("URBANO", urbanSource()));

      expect(sql).toMatch(nullAwareComparison("coddepto"));
      expect(sql).toMatch(nullAwareComparison("codloccat"));
    });

    it.each([
      ["RURAL", ruralSource()],
      ["URBANO", urbanSource()],
    ] as const)("AC-11: should only look at loaded %s rows (usable key and geometry)", (kind, source) => {
      const sql = flat(buildConflictSamplesSql(kind, source));

      expect(sql).toMatch(/"nomdepto"\s+IS NOT NULL/i);
      expect(sql).toMatch(/"padron"\s+IS NOT NULL/i);
      expect(sql).toMatch(/"geom"\s+IS NOT NULL/i);
      expect(sql).toMatch(/ST_IsEmpty\(/i);
    });
  });

  describe("buildAmbiguousLocalityCodesSql", () => {
    it("AC-12: should list (coddepto, codloccat) pairs that carry more than one nomloccat, capped at 20", () => {
      const sql = flat(buildAmbiguousLocalityCodesSql(urbanSource()));

      expect(sql).toMatch(/"coddepto"/);
      expect(sql).toMatch(/"codloccat"/);
      expect(sql).toMatch(/HAVING[\s\S]*count\(\s*DISTINCT[\s\S]*"nomloccat"[\s\S]*>\s*1/i);
      expect(sql).toMatch(/LIMIT\s+20\b/i);
      expect(sql).toContain('"cat"."paisurbano"');
    });
  });

  describe("AC-11 strict conflict detection", () => {
    it.each([
      ["RURAL", ruralSource()],
      ["URBANO", urbanSource()],
    ] as const)(
      "AC-11: should read the %s report conflicts from the loaded rows in the same subquery as the HAVING",
      (kind, source) => {
        const segment = conflictSegment(flat(buildGeometryReportSql(kind, source, repairOn)));

        expect(segment).toMatch(LOADED_ROWS_THEN_HAVING);
        expect(segment).not.toMatch(/FROM\s+"cat"\."pais(?:rural|urbano)"/i);
      }
    );

    it.each([
      ["RURAL", ruralSource(), RURAL_CONFLICT_COLUMNS],
      ["URBANO", urbanSource(), URBANO_CONFLICT_COLUMNS],
    ] as const)("AC-11: should use the full null-aware predicate for every %s column in the report", (kind, source, columns) => {
      const segment = conflictSegment(flat(buildGeometryReportSql(kind, source, repairOn)));

      for (const column of columns) {
        expect(segment, column).toMatch(fullConflictPredicate(column));
      }
    });

    it.each([
      ["RURAL", ruralSource(), RURAL_CONFLICT_COLUMNS],
      ["URBANO", urbanSource(), URBANO_CONFLICT_COLUMNS],
    ] as const)(
      "AC-11: should pin the loaded-rows filter and the full predicate in every UNION ALL branch of the %s samples",
      (kind, source, columns) => {
        const branches = flat(buildConflictSamplesSql(kind, source)).split(/\bUNION ALL\b/i);

        expect(branches).toHaveLength(columns.length);
        branches.forEach((branch, position) => {
          expect(branch, `branch ${position}`).toMatch(LOADED_ROWS_THEN_HAVING);
          expect(branch, `branch ${position}`).toMatch(fullConflictPredicate(columns[position]));
        });
      }
    );

    it("AC-11: should not flag all-NULL groups as conflicts (count(col) > 0 clause present for every column)", () => {
      const rural = flat(buildConflictSamplesSql("RURAL", ruralSource()));
      const urbano = flat(buildConflictSamplesSql("URBANO", urbanSource()));

      for (const column of RURAL_CONFLICT_COLUMNS) {
        expect(rural, column).toContain(`count("${column}") > 0`);
      }
      for (const column of URBANO_CONFLICT_COLUMNS) {
        expect(urbano, column).toContain(`count("${column}") > 0`);
      }
    });

    it("AC-11: should not flag all-NULL groups as conflicts in the report either", () => {
      const rural = conflictSegment(flat(buildGeometryReportSql("RURAL", ruralSource(), repairOn)));

      for (const column of RURAL_CONFLICT_COLUMNS) {
        expect(rural, column).toContain(`count("${column}") > 0`);
      }
    });
  });
});
