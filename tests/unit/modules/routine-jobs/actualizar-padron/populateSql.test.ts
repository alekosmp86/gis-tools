import { describe, it, expect } from "vitest";
import {
  buildClearStatement,
  buildPopulateSql,
  buildReportSql,
  buildStagingCountSql,
  buildStagingSridProbeSql,
  type PopulateLayouts,
  type TableLayout,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/populateSql";
import { buildClassifyWith } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/classifySql";
import {
  LOCALITY_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  SKIP_REASON,
  STAGING_REQUIRED_COLUMNS,
  WORK_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { CLEAR_MODE } from "@/modules/routine-jobs/jobs/cargar-padrones/constants";

type ColumnOverrides = Record<string, string>;

const SRID = 32721;
const WORK_COLUMNS_IN_INSERT = ["number", "type_padron", "id_cadastral_locality", "id_province", "geometry"];

const identity = (columns: readonly string[], overrides: ColumnOverrides = {}): ColumnOverrides =>
  Object.fromEntries(columns.map((column) => [column, overrides[column] ?? column]));

const layoutsWith = (
  overrides: { staging?: ColumnOverrides; work?: ColumnOverrides; schema?: string; srid?: number } = {}
): PopulateLayouts => {
  const schema = overrides.schema ?? "cat";
  return {
    staging: { schema, table: "stg_padron", columns: identity(STAGING_REQUIRED_COLUMNS, overrides.staging) },
    work: {
      schema,
      table: "padron_trabajo",
      columns: identity(WORK_REQUIRED_COLUMNS, overrides.work),
      srid: overrides.srid ?? SRID,
    },
    province: { schema, table: "province", columns: identity(PROVINCE_REQUIRED_COLUMNS) },
    locality: { schema, table: "cadastral_locality", columns: identity(LOCALITY_REQUIRED_COLUMNS) },
  };
};

const flat = (sql: string): string => sql.replace(/\s+/g, " ").trim();

const WRITE_STATEMENT = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

const countMatches = (sql: string, pattern: RegExp): number => [...sql.matchAll(pattern)].length;

/*
 * Every ST_MakeValid call must sit inside a CASE whose first WHEN tests the invalid rows: either NOT ST_IsValid(geom)
 * written in place, or the "repaired" flag, which the chain defines once as NOT ST_IsValid(geom) AS "repaired".
 */
const REPAIR_FLAG_DEFINITION = /NOT\s+ST_IsValid\(\s*"geom"\s*\)\s+AS\s+"repaired"/i;
function makeValidCallsGuarded(sql: string): boolean {
  const text = flat(sql);
  const upper = text.toUpperCase();
  const calls = [...text.matchAll(/ST_MakeValid\(/gi)].map((match) => match.index ?? -1);
  return calls.every((index) => {
    const caseStart = upper.lastIndexOf("CASE", index);
    if (caseStart < 0) return false;
    const guard = text.slice(caseStart, index);
    const testsInvalidRows =
      /WHEN\s+NOT\s+ST_IsValid\(/i.test(guard) || (/WHEN\s+"repaired"/i.test(guard) && REPAIR_FLAG_DEFINITION.test(text));
    return testsInvalidRows && /THEN/i.test(guard);
  });
}

/* ST_Transform must sit inside a CASE that compares the geometry SRID with the target SRID. */
function transformIsGuardedBySrid(sql: string, srid: number): boolean {
  const text = flat(sql);
  const transformAt = text.search(/ST_Transform\(/i);
  if (transformAt < 0) return false;
  const before = text.slice(0, transformAt);
  const caseStart = before.toUpperCase().lastIndexOf("CASE");
  if (caseStart < 0) return false;
  const pattern = new RegExp(`ST_SRID\\(\\s*"geom"\\s*\\)\\s*(<>|!=|IS DISTINCT FROM)\\s*${srid}\\b`, "i");
  return pattern.test(before.slice(caseStart));
}

/*
 * The polygonal extraction of the staging geometry itself (valid, non-polygonal rows), outside the repair of invalid rows:
 * an ST_CollectionExtract(geom, 3) whose CASE branch tests the geometry type or dimension of "geom".
 */
function polygonalExtractionOfValidRowsIsGuarded(sql: string): boolean {
  const text = flat(sql);
  const upper = text.toUpperCase();
  const extractions = [...text.matchAll(/ST_CollectionExtract\(\s*"geom"\s*,\s*3\s*\)/gi)].map((match) => match.index ?? -1);
  return extractions.some((index) => {
    const caseStart = upper.lastIndexOf("CASE", index);
    if (caseStart < 0) return false;
    const guard = text.slice(caseStart, index);
    return /(GeometryType|ST_GeometryType|ST_Dimension)\(\s*"geom"\s*\)/i.test(guard) && /THEN/i.test(guard);
  });
}

const insertColumnsOf = (sql: string): string[] => {
  const match = /INSERT INTO\s+[^(]+\(([^)]*)\)/i.exec(flat(sql));
  return match ? match[1].split(",").map((column) => column.trim()) : [];
};

/* Splits a list at its top-level commas (commas inside parentheses belong to the item). */
function topLevelItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) items.push(current.trim());
  return items;
}

/* The PARTITION BY items of the natural-key window, with their alias prefix removed, sorted. */
function partitionItemsOf(sql: string): string[] {
  const match = /PARTITION BY (.*?)\) AS "key_rows"/i.exec(flat(sql));
  if (!match) return [];
  return topLevelItems(match[1])
    .map((item) => item.replace(/"[^"]+"\./g, "").replace(/\s+/g, " ").trim())
    .sort();
}

/* The ON clause of the locality LEFT JOIN, up to its GROUP BY. */
function localityJoinOn(sql: string): string {
  const match = /AS "loc" ON (.*?) GROUP BY/i.exec(flat(sql));
  return match ? match[1] : "";
}

const quotedWorkColumns = (): string[] => WORK_COLUMNS_IN_INSERT.map((column) => `"${column}"`);

/*
 * The WITH chain of a statement, split into its named stages in order, plus the text after the chain.
 * Parentheses inside single-quoted literals and double-quoted identifiers do not count.
 */
interface ChainStage {
  name: string;
  body: string;
}
interface ChainText {
  stages: ChainStage[];
  tail: string;
}

function closingParenthesisAt(sql: string, from: number): number {
  let depth = 1;
  let index = from;
  while (index < sql.length) {
    const char = sql[index];
    if (char === "'" || char === '"') {
      const close = sql.indexOf(char, index + 1);
      if (close < 0) throw new Error("unclosed literal in the chain");
      index = close + 1;
    } else {
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) return index;
      }
      index += 1;
    }
  }
  throw new Error("unbalanced parenthesis in the chain");
}

function chainOf(sql: string): ChainText {
  const start = sql.search(/\bWITH "/);
  if (start < 0) throw new Error("the statement has no WITH chain");
  const head = /"([^"]+)" AS \(/y;
  const stages: ChainStage[] = [];
  let cursor = start + "WITH ".length;
  for (;;) {
    head.lastIndex = cursor;
    const match = head.exec(sql);
    if (!match) break;
    const bodyStart = head.lastIndex;
    const bodyEnd = closingParenthesisAt(sql, bodyStart);
    stages.push({ name: match[1], body: sql.slice(bodyStart, bodyEnd) });
    cursor = bodyEnd + 1;
    if (!sql.startsWith(", ", cursor)) break;
    cursor += 2;
  }
  return { stages, tail: sql.slice(cursor) };
}

const stageOf = (chain: ChainText, name: string): ChainStage => {
  const stage = chain.stages.find((entry) => entry.name === name);
  if (!stage) throw new Error(`the chain has no stage ${name}`);
  return stage;
};

const textAfterShaped = (sql: string): string => {
  const chain = chainOf(sql);
  const index = chain.stages.findIndex((entry) => entry.name === "shaped");
  return [...chain.stages.slice(index + 1).map((stage) => stage.body), chain.tail].join("\n");
};

/* The ORDER BY of the samples list of the report, as the decided columns it names, in order. */
function samplesOrderOf(sql: string): string[] {
  const text = flat(sql);
  const start = text.indexOf('AS "department"');
  const end = text.indexOf(') AS "samples"');
  const segment = start < 0 || end < 0 ? "" : text.slice(start, end);
  const order = segment.slice(segment.indexOf("ORDER BY"), segment.indexOf("LIMIT"));
  return [...order.matchAll(/"decided"\."([^"]+)"/g)].map((match) => match[1]);
}

describe("actualizar-padron populate SQL builders", () => {
  describe("buildClearStatement (AP-8)", () => {
    const work: TableLayout = { schema: "cat", table: "padron_trabajo", columns: {} };

    it("should delete every row of the qualified work table when clear mode is delete", () => {
      const sql = buildClearStatement(work, CLEAR_MODE.DELETE);

      expect(flat(sql)).toMatch(/^DELETE FROM "cat"\."padron_trabajo"/);
    });

    it("should truncate the qualified work table without CASCADE when clear mode is truncate", () => {
      const sql = buildClearStatement(work, CLEAR_MODE.TRUNCATE);

      expect(flat(sql)).toMatch(/^TRUNCATE "cat"\."padron_trabajo"/);
      expect(sql).not.toMatch(/CASCADE/i);
    });

    it("should reference only the work table, never the padron table", () => {
      for (const mode of [CLEAR_MODE.DELETE, CLEAR_MODE.TRUNCATE]) {
        expect(buildClearStatement(work, mode)).not.toContain('"padron"');
      }
    });
  });

  describe("buildPopulateSql: shape (AP-8, AP-14)", () => {
    it("should be a single INSERT INTO statement that selects from the staging table", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql).match(/INSERT INTO/gi)).toHaveLength(1);
      expect(flat(sql)).toMatch(/SELECT .* FROM .*"cat"\."stg_padron"/i);
    });

    it("should insert exactly the five logical work columns, quoted with their resolved names", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(insertColumnsOf(sql).sort()).toEqual([...quotedWorkColumns()].sort());
    });

    it("should use the resolved physical column names of the work table in the insert list", () => {
      const sql = buildPopulateSql(layoutsWith({ work: { number: "Numero Padron" } }));

      expect(insertColumnsOf(sql)).toContain('"Numero Padron"');
      expect(insertColumnsOf(sql)).not.toContain('"number"');
    });

    it("should never write the id column of the work table (AP-5)", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(insertColumnsOf(sql)).not.toContain('"id"');
    });

    it("should write the work table and read the province and locality tables with schema-qualified quoted names", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(sql).toContain('"cat"."padron_trabajo"');
      expect(sql).toContain('"cat"."stg_padron"');
      expect(sql).toContain('"cat"."province"');
      expect(sql).toContain('"cat"."cadastral_locality"');
    });

    it("should use the resolved physical names of the staging columns, quoted", () => {
      const sql = buildPopulateSql(layoutsWith({ staging: { unidadcat: "Unidad Cat", nomdepto: "Nom Depto" } }));

      expect(sql).toContain('"Unidad Cat"');
      expect(sql).toContain('"Nom Depto"');
    });

    it("should quote embedded double quotes in schema and table identifiers", () => {
      const layouts = layoutsWith({ schema: 'Cat"Odd' });

      const sql = buildPopulateSql(layouts);

      expect(sql).toContain('"Cat""Odd"."padron_trabajo"');
    });

    it("should hardcode no schema or table names when the layouts use other names", () => {
      const layouts: PopulateLayouts = {
        staging: { schema: "zona", table: "zona_stg", columns: identity(STAGING_REQUIRED_COLUMNS) },
        work: { schema: "zona", table: "zona_trabajo", columns: identity(WORK_REQUIRED_COLUMNS), srid: SRID },
        province: { schema: "zona", table: "zona_prov", columns: identity(PROVINCE_REQUIRED_COLUMNS) },
        locality: { schema: "zona", table: "zona_loc", columns: identity(LOCALITY_REQUIRED_COLUMNS) },
      };

      const sql = buildPopulateSql(layouts);

      expect(sql).toContain('"zona"."zona_trabajo"');
      expect(sql).not.toMatch(/carto|catastro|\bcadastral_locality|paispadron/i);
    });

    it("should never reference the padron table in the populate statement", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(sql).not.toContain('"cat"."padron"');
    });

    it("should build the populate from the shared classification chain of buildClassifyWith (AP-8, performance)", () => {
      const layouts = layoutsWith();

      expect(buildPopulateSql(layouts)).toContain(buildClassifyWith(layouts));
    });
  });

  describe("buildPopulateSql: resolution (AP-9, AP-10)", () => {
    it("should match the province by upper(nomdepto) = upper(name)", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/upper\(\s*"nomdepto"\s*\)\s*=\s*upper\(\s*"name"\s*\)/i);
    });

    it("should match the locality by upper(nomloccat) = upper(name)", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/upper\(\s*"nomloccat"\s*\)\s*=\s*upper\(\s*"name"\s*\)/i);
    });

    it("should tie the locality to the resolved province through id_province = id", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/[\w"]+\."id_province"\s*=\s*[\w"]+\."id"/i);
    });

    it("should join the locality with the URBANO guard on unidadcat inside its ON clause, combined with AND", () => {
      const on = localityJoinOn(buildPopulateSql(layoutsWith()));

      expect(on).toMatch(/"wp"\."unidadcat"\s*=\s*'URBANO'/);
      expect(on).toMatch(/"loc"\."id_province"\s*=\s*"wp"\."id"/);
      expect(on).toMatch(/upper\(\s*"nomloccat"\s*\)\s*=\s*upper\(\s*"name"\s*\)/i);
      expect(on).not.toMatch(/\bOR\b/);
    });

    it("should not compare the work locality key column with equality, since NULL keys of rural rows must still group", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).not.toMatch(/"id_cadastral_locality"\s*=|=\s*[\w"]+\."id_cadastral_locality"/i);
    });

    it("should not filter out rural rows by requiring a non-null locality key", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).not.toMatch(/"id_cadastral_locality"\s+IS NOT NULL/i);
    });

    it("should only resolve localities for URBANO rows and keep RURAL rows without a locality", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(sql).toContain("'URBANO'");
      expect(sql).toContain("'RURAL'");
    });
  });

  describe("buildPopulateSql: values (AP-11)", () => {
    it("should derive number as trunc(padron)::text with no decimals", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/trunc\(\s*"padron"\s*\)\s*::\s*text/i);
    });

    it("should take the type_padron value from unidadcat", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/"unidadcat"/);
    });

    it("should test the NULL key components unidadcat, nomdepto and padron before accepting a row (CLAVE_NULA)", () => {
      const sql = flat(buildPopulateSql(layoutsWith()));

      for (const column of ["unidadcat", "nomdepto", "padron"]) {
        expect(sql, column).toMatch(new RegExp(`"${column}"\\s+IS (NOT )?NULL`, "i"));
      }
    });

    it("should order the skip reasons by priority: CLAVE_NULA, PROVINCIA, LOCALIDAD, SIN_GEOMETRIA, CLAVE_DUPLICADA", () => {
      const sql = buildPopulateSql(layoutsWith());

      const order = [
        `'${SKIP_REASON.CLAVE_NULA}'`,
        `'${SKIP_REASON.PROVINCIA_NO_ENCONTRADA}'`,
        `'${SKIP_REASON.PROVINCIA_AMBIGUA}'`,
        `'${SKIP_REASON.LOCALIDAD_NO_ENCONTRADA}'`,
        `'${SKIP_REASON.LOCALIDAD_AMBIGUA}'`,
        `'${SKIP_REASON.SIN_GEOMETRIA}'`,
        `'${SKIP_REASON.CLAVE_DUPLICADA}'`,
      ];
      const positions = order.map((literal) => sql.indexOf(literal));

      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    });
  });

  describe("buildPopulateSql: geometry (AP-12)", () => {
    it("should repair invalid geometries with ST_MakeValid only inside a CASE that tests the invalid rows", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(sql).toMatch(/ST_MakeValid\(/i);
      expect(makeValidCallsGuarded(sql)).toBe(true);
    });

    it("should keep only the polygonal part of the repaired geometry with ST_CollectionExtract(..., 3)", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/ST_CollectionExtract\(\s*ST_MakeValid\(\s*"geom"\s*\)\s*,\s*3\s*\)/i);
    });

    it("should apply the polygonal extraction to valid geometries that are not Polygon or MultiPolygon, guarded by their type or dimension", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(polygonalExtractionOfValidRowsIsGuarded(sql)).toBe(true);
    });

    it("should leave valid polygonal geometries untouched: the geometry CASE falls back to the staging geom", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/ELSE\s+"geom"\s+END/i);
    });

    it("should keep ST_MakeValid out of the valid-row branches (only the invalid-row CASE repairs)", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(countMatches(sql, /ST_MakeValid\(/gi)).toBe(1);
    });

    it("should compute ST_IsValid once in the classification chain, so each staging row is validated once (performance)", () => {
      const layouts = layoutsWith();

      expect(countMatches(buildClassifyWith(layouts), /ST_IsValid\(/gi)).toBe(1);
      expect(countMatches(buildPopulateSql(layouts), /ST_IsValid\(/gi)).toBe(1);
    });

    it("should store the geometry as ST_Multi", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(sql).toMatch(/ST_Multi\(/i);
    });

    it("should transform the geometry only when its SRID differs from the target SRID", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(transformIsGuardedBySrid(sql, SRID)).toBe(true);
    });

    it("should compare against the target SRID taken from the work layout", () => {
      const sql = buildPopulateSql(layoutsWith({ srid: 4326 }));

      expect(transformIsGuardedBySrid(sql, 4326)).toBe(true);
      expect(sql).not.toMatch(/ST_SRID\(\s*"geom"\s*\)\s*(<>|!=)\s*32721/);
    });

    it("should skip geometries that are NULL or empty", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/"geom"\s+IS NOT NULL|ST_IsEmpty\(/i);
    });
  });

  describe("buildPopulateSql: stored geometry is 2D (AP-12)", () => {
    it("should force the stored geometry to 2D exactly once in the populate chain", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(countMatches(sql, /ST_Force2D\(/g)).toBe(1);
    });

    it("should wrap the final ST_Multi geometry that goes into the insert with ST_Force2D", () => {
      const text = flat(buildPopulateSql(layoutsWith()));
      const start = text.indexOf("ST_Force2D(");

      expect(start).toBeGreaterThanOrEqual(0);
      expect(text.slice(start, text.indexOf('AS "geometry"', start))).toMatch(/^ST_Force2D\(\s*ST_Multi\(/);
    });
  });

  describe("buildClassifyWith: geometry payload by mode (performance, AP-16)", () => {
    const layouts = layoutsWith();

    it("should build the populate chain by default, and a different chain in report mode", () => {
      expect(buildClassifyWith(layouts)).toBe(buildClassifyWith(layouts, "populate"));
      expect(buildClassifyWith(layouts, "report")).not.toBe(buildClassifyWith(layouts, "populate"));
    });

    it("should expose exactly one geometry column named geometry in populate mode, first from the shaped stage", () => {
      const sql = buildClassifyWith(layouts, "populate");

      expect(chainOf(sql).stages.filter((stage) => /AS "geometry"/.test(stage.body)).map((stage) => stage.name)).toEqual(["shaped"]);
      expect(countMatches(sql, /AS "geometry"/g)).toBe(1);
    });

    it("should project the raw geom and the fixed copy away once shaped is computed, in populate mode", () => {
      const after = textAfterShaped(buildClassifyWith(layouts, "populate"));

      expect(after).not.toMatch(/"geom"/);
      expect(after).not.toMatch(/"geom_fixed"/);
    });

    it("should not use a wildcard projection in the stage right after shaped in populate mode, so no geometry is carried on", () => {
      const classified = stageOf(chainOf(buildClassifyWith(layouts, "populate")), "classified");

      expect(classified.body).not.toMatch(/\.\*/);
    });

    it("should emit no geometry column from the shaped stage in report mode, only a boolean", () => {
      const shaped = stageOf(chainOf(buildClassifyWith(layouts, "report")), "shaped");

      expect(shaped.body).not.toMatch(/AS "geometry"/);
      expect(shaped.body).not.toMatch(/\.\*/);
      expect(shaped.body).toMatch(/IS NULL/);
      expect(shaped.body).toMatch(/ST_IsEmpty\(/);
    });

    it("should keep no geometry column, no geometry transform and no geometry reference after shaped in report mode", () => {
      const after = textAfterShaped(buildClassifyWith(layouts, "report"));

      expect(after).not.toMatch(/"geometry"|"geom"|"geom_fixed"/);
      expect(after).not.toMatch(/ST_Multi\(|ST_Transform\(|ST_Force2D\(|ST_MakeValid\(/i);
    });

    it("should share the reason CASE and the natural-key PARTITION BY between both modes, so the classification is identical", () => {
      const populate = buildClassifyWith(layouts, "populate");
      const report = buildClassifyWith(layouts, "report");
      const reasonCase = (sql: string): string | undefined => /CASE[\s\S]*?END AS "reason"/.exec(sql)?.[0];
      const partition = (sql: string): string | undefined => /PARTITION BY (.*?)\) AS "key_rows"/i.exec(flat(sql))?.[1];

      expect(reasonCase(report)).toBeDefined();
      expect(reasonCase(report)).toBe(reasonCase(populate));
      expect(partition(report)).toBeDefined();
      expect(partition(report)).toBe(partition(populate));
    });
  });

  describe("buildPopulateSql: natural key collisions (AP-13)", () => {
    it("should keep only the rows whose natural key occurs once, skipping every row of a colliding key", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(flat(sql)).toMatch(/HAVING\s+count\(\*\)\s*=\s*1|count\(\*\)\s*OVER\s*\(\s*PARTITION BY/i);
    });

    it("should partition the natural key by exactly type_padron, id_province, id_cadastral_locality, number and the accepted discriminator", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(partitionItemsOf(sql)).toEqual(
        [
          '("pre_reason" IS NULL)',
          '"id_cadastral_locality"',
          '"id_province"',
          '"number"',
          '"type_padron"',
        ].sort()
      );
    });

    it("should not keep one arbitrary row of a colliding key (no DISTINCT ON, no LIMIT in populate)", () => {
      const sql = buildPopulateSql(layoutsWith());

      expect(sql).not.toMatch(/DISTINCT ON/i);
      expect(sql).not.toMatch(/LIMIT/i);
    });
  });

  describe("buildPopulateSql: data integrity", () => {
    it("should contain no statement other than the single insert", () => {
      const sql = buildPopulateSql(layoutsWith());

      const statements = sql.split(";").map((part) => part.trim()).filter((part) => part.length > 0);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/^INSERT INTO/i);
    });
  });

  describe("buildStagingCountSql and buildStagingSridProbeSql (AP-6)", () => {
    const staging: TableLayout = { schema: "cat", table: "stg_padron", columns: identity(STAGING_REQUIRED_COLUMNS) };

    it("should count the staging rows under the alias count", () => {
      const sql = buildStagingCountSql(staging);

      expect(flat(sql)).toMatch(/^SELECT count\(\*\) AS "?count"? FROM "cat"\."stg_padron"/i);
    });

    it("should count staging geometries whose SRID is 0 under the alias unsupported", () => {
      const sql = buildStagingSridProbeSql(staging, SRID);

      expect(flat(sql)).toMatch(/ST_SRID\(\s*"geom"\s*\)\s*=\s*0/i);
      expect(sql).toContain('AS "unsupported"');
      expect(sql).toContain('"cat"."stg_padron"');
    });

    it("should also count staging geometries whose SRID is missing from spatial_ref_sys (AP-6)", () => {
      const sql = buildStagingSridProbeSql(staging, SRID);

      expect(sql).toMatch(/spatial_ref_sys/i);
    });

    it("should count the target SRID itself as supported, so the probe compares against it", () => {
      const sql = buildStagingSridProbeSql(staging, SRID);

      expect(sql).toContain(String(SRID));
    });

    it("should not write in either probe", () => {
      expect(buildStagingCountSql(staging)).not.toMatch(WRITE_STATEMENT);
      expect(buildStagingSridProbeSql(staging, SRID)).not.toMatch(WRITE_STATEMENT);
    });
  });

  describe("buildReportSql: one statement over the shared chain (AP-16, performance)", () => {
    const layouts = layoutsWith();

    it("should return the totals under the aliases rowsRead, repaired, skipped and collidingKeys", () => {
      const sql = buildReportSql(layouts);

      for (const alias of ["rowsRead", "repaired", "skipped", "collidingKeys"]) {
        expect(sql, alias).toContain(`AS "${alias}"`);
      }
    });

    it("should return the bounded lists under the aliases byReason, byDepartment, byLocality, samples and collidingKeyList", () => {
      const sql = buildReportSql(layouts);

      for (const alias of ["byReason", "byDepartment", "byLocality", "samples", "collidingKeyList"]) {
        expect(sql, alias).toContain(`AS "${alias}"`);
      }
    });

    it("should name every skip reason of the spec in the classification chain it reports on", () => {
      const sql = buildReportSql(layouts);

      for (const reason of Object.values(SKIP_REASON)) {
        expect(sql, reason).toContain(reason);
      }
    });

    it("should start from the shared classification chain in report mode, which carries no geometry past shaped", () => {
      expect(buildReportSql(layouts).startsWith(buildClassifyWith(layouts, "report"))).toBe(true);
    });

    it("should be a single statement that never writes", () => {
      const sql = buildReportSql(layouts);

      expect(sql.split(";").filter((part) => part.trim().length > 0)).toHaveLength(1);
      expect(sql).not.toMatch(WRITE_STATEMENT);
    });

    it("should project no geometry column of the work table in the report part, after the shared chain", () => {
      const sql = buildReportSql(layouts);
      const reportPart = sql.slice(buildClassifyWith(layouts, "report").length);

      expect(reportPart).not.toMatch(/"geometry"/);
      expect(reportPart).not.toMatch(/ST_Multi\(|ST_Transform\(|ST_MakeValid\(/i);
    });

    it("should cap every top list at 20 with LIMIT 20", () => {
      const sql = flat(buildReportSql(layouts));

      expect(countMatches(sql, /LIMIT 20\b/g)).toBeGreaterThanOrEqual(4);
    });

    it("should order the reason, department and locality tops by count DESC", () => {
      const sql = flat(buildReportSql(layouts));

      expect(countMatches(sql, /"count" DESC/g)).toBeGreaterThanOrEqual(3);
    });

    it("should order the samples by department name, locality name and padron before the cap, never by row_id", () => {
      const order = samplesOrderOf(buildReportSql(layouts));

      expect(order).toEqual(["nomdepto", "nomloccat", "padron"]);
      expect(order).not.toContain("row_id");
    });

    it("should guard every ST_MakeValid call of the shared chain", () => {
      expect(makeValidCallsGuarded(buildReportSql(layouts))).toBe(true);
    });

    it("should never reference the padron table", () => {
      expect(buildReportSql(layouts)).not.toContain('"cat"."padron"');
    });
  });
});
