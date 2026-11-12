import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TWIN_CLASS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { twinDropCaseSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/twinSql";

const SETUP_TIMEOUT_MS = 30000;

interface DropCase {
  name: string;
  twinClass: string;
  localities: string[];
  inside: string[];
  dropped: string[];
}

const textArray = (values: string[]): string =>
  values.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;

const CASES: DropCase[] = [
  { name: "URBAN with a rural-named copy drops it", twinClass: TWIN_CLASS.URBAN, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["FLORES RURAL"] },
  { name: "URBAN with no rural-named copy drops nothing", twinClass: TWIN_CLASS.URBAN, localities: ["TRINIDAD", "ISMAEL CORTINAS"], inside: [], dropped: [] },
  { name: "URBAN where every copy is rural-named drops nothing", twinClass: TWIN_CLASS.URBAN, localities: ["A RURAL", "B RURAL"], inside: [], dropped: [] },
  { name: "URBAN with two rural-named and one urban drops both rural-named", twinClass: TWIN_CLASS.URBAN, localities: ["B RURAL", "TRINIDAD", "A RURAL"], inside: [], dropped: ["A RURAL", "B RURAL"] },
  { name: "URBAN compares the suffix trimmed and in upper case", twinClass: TWIN_CLASS.URBAN, localities: ["  flores rural ", "TRINIDAD"], inside: [], dropped: ["  flores rural "] },
  { name: "URBAN does not treat RURAL in the middle of a name as rural-named", twinClass: TWIN_CLASS.URBAN, localities: ["RURAL SUR", "TRINIDAD"], inside: [], dropped: [] },
  { name: "RURAL with one rural-named and one urban-named drops the urban-named", twinClass: TWIN_CLASS.RURAL, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["TRINIDAD"] },
  { name: "RURAL with two rural-named keeps the first by name and drops the other", twinClass: TWIN_CLASS.RURAL, localities: ["B RURAL", "A RURAL"], inside: [], dropped: ["B RURAL"] },
  { name: "RURAL with two rural-named and one urban-named drops the urban-named and the second rural-named", twinClass: TWIN_CLASS.RURAL, localities: ["C RURAL", "TRINIDAD", "A RURAL"], inside: [], dropped: ["C RURAL", "TRINIDAD"] },
  { name: "RURAL with no rural-named copy drops nothing", twinClass: TWIN_CLASS.RURAL, localities: ["TRINIDAD", "ISMAEL CORTINAS"], inside: [], dropped: [] },
  { name: "BOTH drops nothing even with a rural-named copy", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: [] },
  { name: "BOTH drops nothing even when inside names a copy", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["TRINIDAD"], dropped: [] },
  { name: "NEITHER inside no polygon follows the rural rule", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["TRINIDAD"] },
  { name: "NEITHER inside no polygon with two rural-named keeps the first by name", twinClass: TWIN_CLASS.NEITHER, localities: ["B RURAL", "A RURAL"], inside: [], dropped: ["B RURAL"] },
  { name: "NEITHER inside no polygon and no rural-named copy drops nothing", twinClass: TWIN_CLASS.NEITHER, localities: ["TRINIDAD", "ISMAEL CORTINAS"], inside: [], dropped: [] },
  { name: "NEITHER inside the polygon of one copy drops the others", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["TRINIDAD"], dropped: ["FLORES RURAL"] },
  { name: "NEITHER inside the polygon of the rural copy drops the urban one", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["FLORES RURAL"], dropped: ["TRINIDAD"] },
  { name: "NEITHER matches the inside names trimmed and upper-cased", twinClass: TWIN_CLASS.NEITHER, localities: ["flores rural ", "Trinidad"], inside: ["TRINIDAD"], dropped: ["flores rural "] },
  { name: "NEITHER inside the polygons of every copy drops nothing", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["FLORES RURAL", "TRINIDAD"], dropped: [] },
  { name: "NEITHER inside a polygon that matches no copy drops nothing", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["OTRA LOCALIDAD"], dropped: [] },
  { name: "NEITHER inside one of three copies drops the other two", twinClass: TWIN_CLASS.NEITHER, localities: ["C", "A", "B"], inside: ["B"], dropped: ["A", "C"] },
];

describe("twinDropCaseSql against PostgreSQL (ET-13)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  const droppedBy = async (testCase: DropCase): Promise<string[]> => {
    const source = `(SELECT '${testCase.twinClass}'::text AS class, ${textArray(testCase.localities)} AS localities, ${textArray(testCase.inside)} AS inside_localities) AS t`;
    const result = await database.query<{ dropped: string[] }>(`SELECT ${twinDropCaseSql("t")} AS dropped FROM ${source}`);
    return result.rows[0].dropped;
  };

  it.each(CASES)("should drop the right localities: $name", async (testCase) => {
    expect(await droppedBy(testCase)).toEqual(testCase.dropped);
  });

  it.each(CASES)("should never drop every locality of the group: $name", async (testCase) => {
    const dropped = await droppedBy(testCase);

    expect(dropped.length).toBeLessThan(testCase.localities.length);
    expect(dropped.every((locality) => testCase.localities.includes(locality))).toBe(true);
  });

  it("should return an empty array, not null, when nothing is dropped", async () => {
    const result = await database.query<{ dropped: string[] | null }>(
      `SELECT ${twinDropCaseSql("t")} AS dropped FROM (SELECT 'BOTH'::text AS class, ARRAY['A','B']::text[] AS localities, ARRAY[]::text[] AS inside_localities) AS t`
    );

    expect(result.rows[0].dropped).toEqual([]);
  });

  it("should work over many rows at once, one answer per row", async () => {
    const rows = CASES.map(
      (testCase, index) => `(${index}, '${testCase.twinClass}', ${textArray(testCase.localities)}, ${textArray(testCase.inside)})`
    ).join(", ");
    const result = await database.query<{ id: number; dropped: string[] }>(
      `SELECT t.id, ${twinDropCaseSql("t")} AS dropped FROM (VALUES ${rows}) AS t(id, class, localities, inside_localities) ORDER BY t.id`
    );

    expect(result.rows.map((row) => row.dropped)).toEqual(CASES.map((testCase) => testCase.dropped));
  });
});
