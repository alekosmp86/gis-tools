import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCompletarApplySql,
  buildCompletarClassifySql,
  buildCompletarRemainingSql,
} from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/completarSql";
import type { CompletarLayouts } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { completarLayoutsOf } from "./completarFixtures";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const JOB_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/completar-unidad-territorial");
const DELETE_OR_TRUNCATE = /\b(DELETE|TRUNCATE)\b/i;
const WRITTEN_INSERT_COLUMNS = ['"urn"', '"latitud"', '"longitud"'];
const UPDATE_SET_COLUMNS = ["id_address_master"];
const FORBIDDEN_SET_COLUMNS = ["id", "name", "id_province", "geometry", "addresses_master_id"];

const identity = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const layouts = completarLayoutsOf();

const ALL_STATEMENTS: ReadonlyArray<readonly [string, () => string]> = [
  ["classify", () => buildCompletarClassifySql(layouts)],
  ["apply", () => buildCompletarApplySql(layouts)],
  ["remaining", () => buildCompletarRemainingSql(layouts)],
];

const insertColumnsOf = (sql: string): string[] => {
  const match = /INSERT INTO\s+[^(]+\(([^)]*)\)/i.exec(sql);
  return match ? match[1].split(",").map((column) => column.trim()) : [];
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
  const updateStart = sql.indexOf("UPDATE ");
  if (updateStart < 0) return [];
  const fromUpdate = sql.slice(updateStart);
  const setStart = fromUpdate.indexOf(" SET ");
  const fromIndex = fromUpdate.indexOf(" FROM ", setStart);
  const setClause = fromUpdate.slice(setStart + " SET ".length, fromIndex);
  return topLevelItemsOf(setClause)
    .map((assignment) => /^\s*"([^"]+)"\s*=/.exec(assignment)?.[1])
    .filter((column): column is string => column !== undefined);
};

const segmentBetween = (sql: string, start: string, end: string): string => {
  const startIndex = sql.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = sql.indexOf(end, startIndex);
  return sql.slice(startIndex, endIndex < 0 ? undefined : endIndex);
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

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFilesUnder(entryPath) : [entryPath];
  });
}

describe("completarSql classification (CU-3, CU-4, CU-6, CU-7)", () => {
  it("should classify a candidate with no address master row as new, one row as existing and two or more as ambiguous", () => {
    const sql = buildCompletarClassifySql(layouts);

    expect(sql).toContain(`WHEN m."records" = 0 THEN 'new'`);
    expect(sql).toContain(`WHEN m."records" = 1 THEN 'existing'`);
    expect(sql).toContain(`ELSE 'ambiguous' END AS "class"`);
  });

  it("should take the candidates from every unit row with a NULL id_address_master, whatever the unit type", () => {
    const sql = buildCompletarClassifySql(layouts);

    expect(sql).toContain(`FROM "carto"."territorial_unit" AS tu WHERE tu."id_address_master" IS NULL`);
    expect(sql).not.toMatch(/tipo|unit_type/i);
  });

  it("should build the URN as the constant territorial unit prefix followed by the unit id", () => {
    expect(buildCompletarClassifySql(layouts)).toContain(`concat('cgeo:territorial_unit:id:', tu."id") AS "urn"`);
  });

  it("should match the address master row by exact equality of its urn", () => {
    expect(buildCompletarClassifySql(layouts)).toContain(`am."urn" = c."urn"`);
  });

  it.each(ALL_STATEMENTS)("should never parse the urn with SPLIT_PART or an integer cast in the %s statement", (_label, build) => {
    const sql = build();

    expect(sql).not.toMatch(/SPLIT_PART/i);
    expect(sql).not.toMatch(/::\s*int(eger)?\b/i);
  });

  it("should count the candidates without an address master row for the report", () => {
    expect(buildCompletarClassifySql(layouts)).toContain(`count(*) AS "without_address_master"`);
  });

  it("should cap the ambiguous sample list at SAMPLE_LIMIT", () => {
    expect(buildCompletarClassifySql(layouts)).toContain(`ORDER BY cl."unit_id" LIMIT ${SAMPLE_LIMIT}`);
  });
});

describe("completarSql insert of address master rows (CU-5, CU-9)", () => {
  it("should insert only the urn and the two coordinates into the address master", () => {
    expect(insertColumnsOf(buildCompletarApplySql(layouts))).toEqual(WRITTEN_INSERT_COLUMNS);
  });

  it("should never list addresses_master_id in the INSERT so the table sequence assigns it", () => {
    expect(insertColumnsOf(buildCompletarApplySql(layouts))).not.toContain('"addresses_master_id"');
  });

  it("should give every new address record the initial coordinates 0 and 0", () => {
    const insert = segmentBetween(buildCompletarApplySql(layouts), "INSERT INTO", "RETURNING");

    expect(insert).toContain(`cl."urn", 0, 0`);
  });

  it("should insert only candidates classified new, ordered by unit id", () => {
    const insert = segmentBetween(buildCompletarApplySql(layouts), "INSERT INTO", "RETURNING");

    expect(insert).toContain(`WHERE cl."class" = 'new' ORDER BY cl."unit_id"`);
  });

  it("should never insert ambiguous or existing candidates", () => {
    const insert = segmentBetween(buildCompletarApplySql(layouts), "INSERT INTO", "RETURNING");

    expect(insert).not.toContain("ambiguous");
    expect(insert).not.toContain("'existing'");
  });
});

describe("completarSql link of units (CU-6, CU-8, CU-9)", () => {
  it("should assign only id_address_master in the UPDATE SET clause", () => {
    expect(updateSetColumnsOf(buildCompletarApplySql(layouts))).toEqual(UPDATE_SET_COLUMNS);
  });

  it.each(FORBIDDEN_SET_COLUMNS)("should never assign the protected column %s in the UPDATE SET clause", (column) => {
    expect(updateSetColumnsOf(buildCompletarApplySql(layouts))).not.toContain(column);
  });

  it("should guard the UPDATE with id_address_master IS NULL so a non-null link is never overwritten", () => {
    const update = segmentBetween(buildCompletarApplySql(layouts), "UPDATE ", "RETURNING");

    expect(update).toContain(`tu."id_address_master" IS NULL`);
  });

  it("should join the UPDATE to the links on the exact unit id", () => {
    const update = segmentBetween(buildCompletarApplySql(layouts), "UPDATE ", "RETURNING");

    expect(update).toContain(`WHERE tu."id" = lk."unit_id"`);
  });

  it("should update only the linkable units listed in the links CTE", () => {
    const update = segmentBetween(buildCompletarApplySql(layouts), "UPDATE ", "RETURNING");

    expect(update).toContain(`FROM "links" AS lk`);
    expect(update).not.toContain("ambiguous");
  });
});

describe("completarSql single statement (CU-10)", () => {
  it("should run the classification, the insert, the links and the update in one data-modifying CTE statement", () => {
    const sql = buildCompletarApplySql(layouts);

    expect(sql.startsWith("WITH ")).toBe(true);
    expect(sql).toContain(`"inserted_rows" AS (INSERT INTO`);
    expect(sql).toContain(`"updated_rows" AS (UPDATE`);
  });

  it("should cap the linked list at DETAIL_LIST_LIMIT", () => {
    expect(buildCompletarApplySql(layouts)).toContain(`ORDER BY ur."unit_id" LIMIT ${DETAIL_LIST_LIMIT}`);
  });

  it.each(ALL_STATEMENTS)("should never use a MATERIALIZED hint in the %s statement", (_label, build) => {
    expect(build()).not.toMatch(/\bMATERIALIZED\b/i);
  });

  it.each(ALL_STATEMENTS)("should have no comma directly before FROM in the %s statement", (_label, build) => {
    expect(build()).not.toMatch(/,\s*FROM\b/i);
  });

  it.each(ALL_STATEMENTS)("should balance parentheses in the %s statement", (_label, build) => {
    expect(parenthesisBalanceOf(build())).toEqual({ depth: 0, minDepth: 0 });
  });

  it("should report the created and linked totals from the data-modifying CTEs", () => {
    const sql = buildCompletarApplySql(layouts);

    expect(sql).toContain(`(SELECT count(*) FROM "inserted_rows") AS "created"`);
    expect(sql).toContain(`(SELECT count(*) FROM "updated_rows") AS "linked"`);
  });
});

describe("completarSql never deletes or truncates (CU-9, MJ-13)", () => {
  it.each(ALL_STATEMENTS)("should contain no DELETE or TRUNCATE in the %s statement", (_label, build) => {
    expect(build()).not.toMatch(DELETE_OR_TRUNCATE);
  });

  it("should contain no DELETE or TRUNCATE in any source file of the completar job", () => {
    const files = sourceFilesUnder(JOB_DIRECTORY).filter((file) => file.endsWith(".ts"));
    const offenders = files.filter((file) => DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8")));

    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe("completarSql table and column resolution (CU-2)", () => {
  it("should use the physical column names resolved from the catalog", () => {
    const renamed: CompletarLayouts = {
      unit: { schema: "carto", table: "territorial_unit", columns: { ...identity(Object.values(layouts.unit.columns)), id: "gid" } },
      addressMaster: layouts.addressMaster,
    };

    expect(buildCompletarClassifySql(renamed)).toContain(`tu."gid"`);
  });

  it("should name no table literally, only the resolved schema and table", () => {
    const other: CompletarLayouts = {
      unit: { schema: "otro", table: "unidades_x", columns: layouts.unit.columns },
      addressMaster: { ...layouts.addressMaster, schema: "otro", table: "direcciones_y" },
    };
    const sql = buildCompletarApplySql(other);

    expect(sql).toContain(`"otro"."unidades_x"`);
    expect(sql).toContain(`"otro"."direcciones_y"`);
    expect(sql).not.toContain(`"territorial_unit"`);
    expect(sql).not.toContain(`"addresses_master"`);
  });

  it("should quote a schema name that contains a double quote", () => {
    const quoted: CompletarLayouts = {
      unit: { schema: 'we"ird', table: "territorial_unit", columns: layouts.unit.columns },
      addressMaster: layouts.addressMaster,
    };

    expect(buildCompletarRemainingSql(quoted)).toContain(`"we""ird"."territorial_unit"`);
  });

  it("should throw a Spanish error naming the logical column when the layout does not resolve it", () => {
    const missing: CompletarLayouts = {
      unit: { schema: "carto", table: "territorial_unit", columns: { id: "id", name: "name", id_address_master: "id_address_master" } },
      addressMaster: layouts.addressMaster,
    };

    expect(() => buildCompletarClassifySql(missing)).toThrow(/Falta la columna resuelta "id_province"/);
  });
});

describe("completarSql candidate grouping (CU-3, CU-4)", () => {
  it("should group the matches by unit id and urn so a duplicated unit id forms one group", () => {
    const sql = buildCompletarClassifySql(layouts);

    expect(sql).toContain(`GROUP BY c."unit_id", c."urn"`);
  });

  it("should not group by name or province, which are aggregated with min instead", () => {
    const sql = buildCompletarClassifySql(layouts);

    expect(sql).not.toMatch(/GROUP BY[^)]*"name"/);
    expect(sql).not.toMatch(/GROUP BY[^)]*"province_id"/);
    expect(sql).toContain(`min(c."name") AS "name"`);
    expect(sql).toContain(`min(c."province_id") AS "province_id"`);
  });
});

describe("completarSql remaining units (CU-11)", () => {
  it("should count the units still without an address master", () => {
    expect(buildCompletarRemainingSql(layouts)).toBe(
      `SELECT count(*) AS "remaining" FROM "carto"."territorial_unit" AS tu WHERE tu."id_address_master" IS NULL`,
    );
  });
});
