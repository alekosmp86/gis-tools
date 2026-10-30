import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAddressMasterApplySql,
  buildAddressMasterClassifySql,
  buildAddressMasterRemainingSql,
  type AddressMasterLinkLayouts,
} from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSql";
import { ADDRESS_MASTER_COLUMN, UNIT_SUBJECT_SPEC } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const UNIT_JOB_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/unidad-territorial");
const SHARED_DIRECTORY = path.join(REPOSITORY_ROOT, "src/modules/routine-jobs/jobs/shared");
const LINK_FILE_PATTERN = /^addressMasterLink.*\.ts$/;
const DELETE_OR_TRUNCATE = /\b(DELETE|TRUNCATE)\b/i;
const WRITTEN_INSERT_COLUMNS = ['"urn"', '"latitud"', '"longitud"'];
const UPDATE_SET_COLUMNS = ["id_address_master"];
const FORBIDDEN_SET_COLUMNS = ["id", "name", "id_province", "geometry", "addresses_master_id"];

const identity = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const layouts: AddressMasterLinkLayouts = {
  subject: { schema: "carto", table: "territorial_unit", columns: identity(UNIT_SUBJECT_SPEC.requiredColumns) },
  addressMaster: { schema: "carto", table: "addresses_master", columns: identity(Object.values(ADDRESS_MASTER_COLUMN)) },
};
const UNIT = UNIT_SUBJECT_SPEC;

const ALL_STATEMENTS: ReadonlyArray<readonly [string, () => string]> = [
  ["classify", () => buildAddressMasterClassifySql(layouts, UNIT)],
  ["apply", () => buildAddressMasterApplySql(layouts, UNIT)],
  ["remaining", () => buildAddressMasterRemainingSql(layouts, UNIT)],
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

const sharedLinkSourceFiles = (): string[] =>
  readdirSync(SHARED_DIRECTORY)
    .filter((name) => LINK_FILE_PATTERN.test(name))
    .map((name) => path.join(SHARED_DIRECTORY, name));

describe("addressMasterLinkSql unit subject classification (UT-19, UT-20)", () => {
  it("should classify a candidate with no address master row as new, one row as existing and two or more as ambiguous", () => {
    const sql = buildAddressMasterClassifySql(layouts, UNIT);

    expect(sql).toContain(`WHEN m."records" = 0 THEN 'new'`);
    expect(sql).toContain(`WHEN m."records" = 1 THEN 'existing'`);
    expect(sql).toContain(`ELSE 'ambiguous' END AS "class"`);
  });

  it("should take the candidates from every unit row with a NULL id_address_master, whatever the unit type", () => {
    const sql = buildAddressMasterClassifySql(layouts, UNIT);

    expect(sql).toContain(`FROM "carto"."territorial_unit" AS sj WHERE sj."id_address_master" IS NULL`);
    expect(sql).not.toMatch(/tipo|unit_type/i);
  });

  it("should build the URN as the constant territorial unit prefix followed by the unit id", () => {
    expect(buildAddressMasterClassifySql(layouts, UNIT)).toContain(`concat('cgeo:territorial_unit:id:', sj."id") AS "urn"`);
  });

  it("should match the address master row by exact equality of its urn", () => {
    expect(buildAddressMasterClassifySql(layouts, UNIT)).toContain(`am."urn" = c."urn"`);
  });

  it.each(ALL_STATEMENTS)("should never parse the urn with SPLIT_PART or an integer cast in the %s statement", (_label, build) => {
    const sql = build();

    expect(sql).not.toMatch(/SPLIT_PART/i);
    expect(sql).not.toMatch(/::\s*int(eger)?\b/i);
  });

  it("should count the candidates without an address master row for the report", () => {
    expect(buildAddressMasterClassifySql(layouts, UNIT)).toContain(`count(*) AS "without_address_master"`);
  });

  it("should cap the ambiguous sample list at SAMPLE_LIMIT", () => {
    expect(buildAddressMasterClassifySql(layouts, UNIT)).toContain(`ORDER BY cl."subject_id" LIMIT ${SAMPLE_LIMIT}`);
  });
});

describe("addressMasterLinkSql insert of unit address master rows (UT-14, UT-20)", () => {
  it("should insert only the urn and the two coordinates into the address master", () => {
    expect(insertColumnsOf(buildAddressMasterApplySql(layouts, UNIT))).toEqual(WRITTEN_INSERT_COLUMNS);
  });

  it("should never list addresses_master_id in the INSERT so the table sequence assigns it", () => {
    expect(insertColumnsOf(buildAddressMasterApplySql(layouts, UNIT))).not.toContain('"addresses_master_id"');
  });

  it("should give every new address record the initial coordinates 0 and 0", () => {
    const insert = segmentBetween(buildAddressMasterApplySql(layouts, UNIT), "INSERT INTO", "RETURNING");

    expect(insert).toContain(`cl."urn", 0, 0`);
  });

  it("should insert only candidates classified new, ordered by unit id", () => {
    const insert = segmentBetween(buildAddressMasterApplySql(layouts, UNIT), "INSERT INTO", "RETURNING");

    expect(insert).toContain(`WHERE cl."class" = 'new' ORDER BY cl."subject_id"`);
  });

  it("should never insert ambiguous or existing candidates", () => {
    const insert = segmentBetween(buildAddressMasterApplySql(layouts, UNIT), "INSERT INTO", "RETURNING");

    expect(insert).not.toContain("ambiguous");
    expect(insert).not.toContain("'existing'");
  });
});

describe("addressMasterLinkSql link of units (UT-21, UT-22)", () => {
  it("should assign only id_address_master in the UPDATE SET clause", () => {
    expect(updateSetColumnsOf(buildAddressMasterApplySql(layouts, UNIT))).toEqual(UPDATE_SET_COLUMNS);
  });

  it.each(FORBIDDEN_SET_COLUMNS)("should never assign the protected column %s in the UPDATE SET clause", (column) => {
    expect(updateSetColumnsOf(buildAddressMasterApplySql(layouts, UNIT))).not.toContain(column);
  });

  it("should guard the UPDATE with id_address_master IS NULL so a non-null link is never overwritten", () => {
    const update = segmentBetween(buildAddressMasterApplySql(layouts, UNIT), "UPDATE ", "RETURNING");

    expect(update).toContain(`sj."id_address_master" IS NULL`);
  });

  it("should join the UPDATE to the links on the exact unit id", () => {
    const update = segmentBetween(buildAddressMasterApplySql(layouts, UNIT), "UPDATE ", "RETURNING");

    expect(update).toContain(`WHERE sj."id" = lk."subject_id"`);
  });

  it("should update only the linkable units listed in the links CTE", () => {
    const update = segmentBetween(buildAddressMasterApplySql(layouts, UNIT), "UPDATE ", "RETURNING");

    expect(update).toContain(`FROM "links" AS lk`);
    expect(update).not.toContain("ambiguous");
  });
});

describe("addressMasterLinkSql single statement (UT-23)", () => {
  it("should run the classification, the insert, the links and the update in one data-modifying CTE statement", () => {
    const sql = buildAddressMasterApplySql(layouts, UNIT);

    expect(sql.startsWith("WITH ")).toBe(true);
    expect(sql).toContain(`"inserted_rows" AS (INSERT INTO`);
    expect(sql).toContain(`"updated_rows" AS (UPDATE`);
  });

  it("should cap the linked list at DETAIL_LIST_LIMIT", () => {
    expect(buildAddressMasterApplySql(layouts, UNIT)).toContain(`ORDER BY ur."subject_id" LIMIT ${DETAIL_LIST_LIMIT}`);
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
    const sql = buildAddressMasterApplySql(layouts, UNIT);

    expect(sql).toContain(`(SELECT count(*) FROM "inserted_rows") AS "created"`);
    expect(sql).toContain(`(SELECT count(*) FROM "updated_rows") AS "linked"`);
  });
});

describe("addressMasterLinkSql never deletes or truncates (UT-14, UT-22, MJ-13)", () => {
  it.each(ALL_STATEMENTS)("should contain no DELETE or TRUNCATE in the %s statement", (_label, build) => {
    expect(build()).not.toMatch(DELETE_OR_TRUNCATE);
  });

  it("should contain no DELETE or TRUNCATE in any stage 3 job source file or shared link source file", () => {
    const files = [...sourceFilesUnder(UNIT_JOB_DIRECTORY), ...sharedLinkSourceFiles()].filter((file) => file.endsWith(".ts"));
    const offenders = files.filter((file) => DELETE_OR_TRUNCATE.test(readFileSync(file, "utf8")));

    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe("addressMasterLinkSql table and column resolution (UT-24)", () => {
  it("should use the physical column names resolved from the catalog", () => {
    const renamed: AddressMasterLinkLayouts = {
      subject: { schema: "carto", table: "territorial_unit", columns: { ...identity(Object.values(layouts.subject.columns)), id: "gid" } },
      addressMaster: layouts.addressMaster,
    };

    expect(buildAddressMasterClassifySql(renamed, UNIT)).toContain(`sj."gid"`);
  });

  it("should name no table literally, only the resolved schema and table", () => {
    const other: AddressMasterLinkLayouts = {
      subject: { schema: "otro", table: "unidades_x", columns: layouts.subject.columns },
      addressMaster: { ...layouts.addressMaster, schema: "otro", table: "direcciones_y" },
    };
    const sql = buildAddressMasterApplySql(other, UNIT);

    expect(sql).toContain(`"otro"."unidades_x"`);
    expect(sql).toContain(`"otro"."direcciones_y"`);
    expect(sql).not.toContain(`"territorial_unit"`);
    expect(sql).not.toContain(`"addresses_master"`);
  });

  it("should quote a schema name that contains a double quote", () => {
    const quoted: AddressMasterLinkLayouts = {
      subject: { schema: 'we"ird', table: "territorial_unit", columns: layouts.subject.columns },
      addressMaster: layouts.addressMaster,
    };

    expect(buildAddressMasterRemainingSql(quoted, UNIT)).toContain(`"we""ird"."territorial_unit"`);
  });

  it("should throw a Spanish error naming the logical column when the layout does not resolve it", () => {
    const missing: AddressMasterLinkLayouts = {
      subject: { schema: "carto", table: "territorial_unit", columns: { id: "id", name: "name", id_address_master: "id_address_master" } },
      addressMaster: layouts.addressMaster,
    };

    expect(() => buildAddressMasterClassifySql(missing, UNIT)).toThrow(/Falta la columna resuelta "id_province"/);
  });
});

describe("addressMasterLinkSql candidate grouping (UT-21)", () => {
  it("should group the matches by unit id and urn so a duplicated unit id forms one group", () => {
    const sql = buildAddressMasterClassifySql(layouts, UNIT);

    expect(sql).toContain(`GROUP BY c."subject_id", c."urn"`);
  });

  it("should not group by name or province, which are aggregated with min instead", () => {
    const sql = buildAddressMasterClassifySql(layouts, UNIT);

    expect(sql).not.toMatch(/GROUP BY[^)]*"name"/);
    expect(sql).not.toMatch(/GROUP BY[^)]*"province_id"/);
    expect(sql).toContain(`min(c."name") AS "name"`);
    expect(sql).toContain(`min(c."province_id") AS "province_id"`);
  });
});

describe("addressMasterLinkSql remaining units (UT-16)", () => {
  it("should count the units still without an address master", () => {
    expect(buildAddressMasterRemainingSql(layouts, UNIT)).toBe(
      `SELECT count(*) AS "remaining" FROM "carto"."territorial_unit" AS sj WHERE sj."id_address_master" IS NULL`,
    );
  });
});
