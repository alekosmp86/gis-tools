import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TWIN_CLASS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { twinDropCaseSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/twinSql";

const SETUP_TIMEOUT_MS = 30000;

interface TwinGroup {
  name: string;
  twinClass: string;
  localities: string[];
  inside: string[];
}

interface DropCase extends TwinGroup {
  dropped: string[];
}

const textArray = (values: string[]): string =>
  values.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;

const subsetsOf = (values: string[]): string[][] =>
  Array.from({ length: 2 ** values.length }, (_, mask) => values.filter((_value, index) => ((mask >> index) & 1) === 1));

const POOL = ["A RURAL", "B RURAL", "C", "D"];

const CASES: DropCase[] = [
  { name: "URBAN with a rural-named copy drops it", twinClass: TWIN_CLASS.URBAN, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["FLORES RURAL"] },
  { name: "URBAN with no rural-named copy drops nothing", twinClass: TWIN_CLASS.URBAN, localities: ["TRINIDAD", "ISMAEL CORTINAS"], inside: [], dropped: [] },
  { name: "URBAN where every copy is rural-named drops nothing", twinClass: TWIN_CLASS.URBAN, localities: ["A RURAL", "B RURAL"], inside: [], dropped: [] },
  { name: "URBAN with two rural-named and one urban drops both rural-named", twinClass: TWIN_CLASS.URBAN, localities: ["B RURAL", "TRINIDAD", "A RURAL"], inside: [], dropped: ["A RURAL", "B RURAL"] },
  { name: "URBAN compares the suffix trimmed and in upper case", twinClass: TWIN_CLASS.URBAN, localities: ["  flores rural ", "TRINIDAD"], inside: [], dropped: ["  flores rural "] },
  { name: "URBAN does not treat RURAL in the middle of a name as rural-named", twinClass: TWIN_CLASS.URBAN, localities: ["RURAL SUR", "TRINIDAD"], inside: [], dropped: [] },
  { name: "URBAN with two non-rural copies, one inside, drops the other", twinClass: TWIN_CLASS.URBAN, localities: ["EMPALME OLMOS", "PIEDRA DEL TORO"], inside: ["EMPALME OLMOS"], dropped: ["PIEDRA DEL TORO"] },
  { name: "URBAN with two non-rural copies both inside keeps the longer overlap, the first in inside", twinClass: TWIN_CLASS.URBAN, localities: ["EMPALME OLMOS", "PIEDRA DEL TORO"], inside: ["PIEDRA DEL TORO", "EMPALME OLMOS"], dropped: ["EMPALME OLMOS"] },
  { name: "URBAN with two non-rural copies and none inside holds, dropping nothing", twinClass: TWIN_CLASS.URBAN, localities: ["EMPALME OLMOS", "PIEDRA DEL TORO"], inside: ["OTRA LOCALIDAD"], dropped: [] },
  { name: "URBAN with a rural-named copy and two non-rural copies, one inside, drops the rural-named and the other non-rural", twinClass: TWIN_CLASS.URBAN, localities: ["FLORES RURAL", "TRINIDAD", "ISMAEL CORTINAS"], inside: ["ISMAEL CORTINAS", "TRINIDAD"], dropped: ["FLORES RURAL", "TRINIDAD"] },
  { name: "RURAL with one rural-named and one urban-named drops the urban-named", twinClass: TWIN_CLASS.RURAL, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["TRINIDAD"] },
  { name: "RURAL with two rural-named keeps the first by name and drops the other", twinClass: TWIN_CLASS.RURAL, localities: ["B RURAL", "A RURAL"], inside: [], dropped: ["B RURAL"] },
  { name: "RURAL with two rural-named and one urban-named drops the urban-named and the second rural-named", twinClass: TWIN_CLASS.RURAL, localities: ["C RURAL", "TRINIDAD", "A RURAL"], inside: [], dropped: ["C RURAL", "TRINIDAD"] },
  { name: "RURAL with no rural-named copy and one inside keeps the inside copy", twinClass: TWIN_CLASS.RURAL, localities: ["ISMAEL CORTINAS", "TRINIDAD"], inside: ["TRINIDAD"], dropped: ["ISMAEL CORTINAS"] },
  { name: "RURAL with no rural-named copy and none inside drops nothing", twinClass: TWIN_CLASS.RURAL, localities: ["TRINIDAD", "ISMAEL CORTINAS"], inside: [], dropped: [] },
  { name: "BOTH with a copy inside its polygon drops the others", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["TRINIDAD"], dropped: ["FLORES RURAL"] },
  { name: "BOTH with only the rural-named copy inside keeps it and drops the other", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["FLORES RURAL"], dropped: ["TRINIDAD"] },
  { name: "BOTH with no polygon inside keeps the non-rural-named copy and drops the rural-named one", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["FLORES RURAL"] },
  { name: "BOTH with two non-rural-named copies and none inside keeps the lowest name", twinClass: TWIN_CLASS.BOTH, localities: ["ZETA", "ALFA"], inside: [], dropped: ["ZETA"] },
  { name: "BOTH with three non-rural-named copies and none inside keeps the lowest name", twinClass: TWIN_CLASS.BOTH, localities: ["C", "A", "B"], inside: [], dropped: ["B", "C"] },
  { name: "BOTH with only rural-named copies and none inside keeps the first by name", twinClass: TWIN_CLASS.BOTH, localities: ["B RURAL", "A RURAL"], inside: [], dropped: ["B RURAL"] },
  { name: "BOTH with two copies inside keeps the first inside by overlap, not the lowest name", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD", "ALFA"], inside: ["TRINIDAD", "ALFA"], dropped: ["ALFA", "FLORES RURAL"] },
  { name: "BOTH with a rural-named and a non-rural-named copy both inside keeps the first inside by overlap", twinClass: TWIN_CLASS.BOTH, localities: ["FLORES RURAL", "TRINIDAD", "ALFA"], inside: ["FLORES RURAL", "TRINIDAD"], dropped: ["ALFA", "TRINIDAD"] },
  { name: "BOTH keeps the longest overlap when its name sorts last", twinClass: TWIN_CLASS.BOTH, localities: ["CUAREIM", "PORT. DE HIERRO Y CAMPODONICO"], inside: ["PORT. DE HIERRO Y CAMPODONICO", "CUAREIM"], dropped: ["CUAREIM"] },
  { name: "BOTH keeps the first inside by overlap when it is the other name", twinClass: TWIN_CLASS.BOTH, localities: ["CUAREIM", "PORT. DE HIERRO Y CAMPODONICO"], inside: ["CUAREIM", "PORT. DE HIERRO Y CAMPODONICO"], dropped: ["PORT. DE HIERRO Y CAMPODONICO"] },
  { name: "BOTH ranks a copy not inside after every copy inside, whatever its name", twinClass: TWIN_CLASS.BOTH, localities: ["ALFA", "BETA", "GAMMA"], inside: ["GAMMA", "BETA"], dropped: ["ALFA", "BETA"] },
  { name: "BOTH with one copy inside keeps it even when it is the last by name", twinClass: TWIN_CLASS.BOTH, localities: ["ALFA", "ZETA"], inside: ["ZETA"], dropped: ["ALFA"] },
  { name: "NEITHER inside no polygon follows the rural rule", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: [], dropped: ["TRINIDAD"] },
  { name: "NEITHER inside no polygon with two rural-named keeps the first by name", twinClass: TWIN_CLASS.NEITHER, localities: ["B RURAL", "A RURAL"], inside: [], dropped: ["B RURAL"] },
  { name: "NEITHER inside no polygon and no rural-named copy drops nothing", twinClass: TWIN_CLASS.NEITHER, localities: ["TRINIDAD", "ISMAEL CORTINAS"], inside: [], dropped: [] },
  { name: "NEITHER inside the polygon of one copy drops the others", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["TRINIDAD"], dropped: ["FLORES RURAL"] },
  { name: "NEITHER inside the polygon of the rural copy drops the urban one", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["FLORES RURAL"], dropped: ["TRINIDAD"] },
  { name: "NEITHER matches the inside names trimmed and upper-cased", twinClass: TWIN_CLASS.NEITHER, localities: ["flores rural ", "Trinidad"], inside: ["TRINIDAD"], dropped: ["flores rural "] },
  { name: "NEITHER inside the polygons of two copies keeps the first inside by overlap and drops the other", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["FLORES RURAL", "TRINIDAD"], dropped: ["TRINIDAD"] },
  { name: "NEITHER inside two copies keeps the first inside by overlap, not the lowest name", twinClass: TWIN_CLASS.NEITHER, localities: ["ALFA", "BETA"], inside: ["BETA", "ALFA"], dropped: ["ALFA"] },
  { name: "NEITHER inside a polygon that matches no copy drops nothing", twinClass: TWIN_CLASS.NEITHER, localities: ["FLORES RURAL", "TRINIDAD"], inside: ["OTRA LOCALIDAD"], dropped: [] },
  { name: "NEITHER inside one of three copies drops the other two", twinClass: TWIN_CLASS.NEITHER, localities: ["C", "A", "B"], inside: ["B"], dropped: ["A", "C"] },
];

const MATRIX: TwinGroup[] = Object.values(TWIN_CLASS).flatMap((twinClass) =>
  subsetsOf(POOL)
    .filter((localities) => localities.length > 0)
    .flatMap((localities) =>
      subsetsOf(POOL).map((inside) => ({ name: `${twinClass} ${localities.join("|")} inside ${inside.join("|")}`, twinClass, localities, inside }))
    )
);

describe("twinDropCaseSql against PostgreSQL (ET-13, ET-19)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  const droppedBy = async (group: TwinGroup, alias = "t"): Promise<string[]> => {
    const source = `(SELECT '${group.twinClass}'::text AS class, ${textArray(group.localities)} AS localities, ${textArray(group.inside)} AS inside_localities) AS ${alias}`;
    const result = await database.query<{ dropped: string[] }>(`SELECT ${twinDropCaseSql(alias)} AS dropped FROM ${source}`);
    return result.rows[0].dropped;
  };

  const droppedRowsOf = async (groups: TwinGroup[], alias = "t"): Promise<string[][]> => {
    const rows = groups.map((group, index) => `(${index}, '${group.twinClass}', ${textArray(group.localities)}, ${textArray(group.inside)})`).join(", ");
    const result = await database.query<{ dropped: string[] }>(
      `SELECT ${twinDropCaseSql(alias)} AS dropped FROM (VALUES ${rows}) AS ${alias}(id, class, localities, inside_localities) ORDER BY ${alias}.id`
    );
    return result.rows.map((row) => row.dropped);
  };

  const keptOf = (group: TwinGroup, dropped: string[]): string[] => group.localities.filter((locality) => !dropped.includes(locality));

  const isRuralNamed = (locality: string): boolean => locality.trim().toUpperCase().endsWith(" RURAL");

  it.each(CASES)("should drop the right localities: $name", async (testCase) => {
    expect(await droppedBy(testCase)).toEqual(testCase.dropped);
  });

  it.each(CASES)("should never drop every locality of the group: $name", async (testCase) => {
    const dropped = await droppedBy(testCase);

    expect(dropped.length).toBeLessThan(testCase.localities.length);
    expect(dropped.every((locality) => testCase.localities.includes(locality))).toBe(true);
  });

  it.each(CASES.filter((testCase) => testCase.twinClass === TWIN_CLASS.BOTH))("should keep exactly one copy when class BOTH: $name", async (testCase) => {
    const dropped = await droppedBy(testCase);

    expect(testCase.localities.filter((locality) => !dropped.includes(locality))).toHaveLength(1);
  });

  it("should never drop every locality of any group, over every class, locality set and inside set", async () => {
    const rows = MATRIX.map(
      (group, index) => `(${index}, '${group.twinClass}', ${textArray(group.localities)}, ${textArray(group.inside)})`
    ).join(", ");
    const result = await database.query<{ id: number; dropped: string[] }>(
      `SELECT t.id, ${twinDropCaseSql("t")} AS dropped FROM (VALUES ${rows}) AS t(id, class, localities, inside_localities) ORDER BY t.id`
    );
    const violations = result.rows
      .map((row) => ({ group: MATRIX[row.id], dropped: row.dropped }))
      .filter(({ group, dropped }) => dropped.length >= group.localities.length || dropped.some((locality) => !group.localities.includes(locality)))
      .map(({ group }) => group.name);

    expect(result.rows).toHaveLength(MATRIX.length);
    expect(violations).toEqual([]);
  });

  it("should return an empty array, not null, when nothing is dropped", async () => {
    const result = await database.query<{ dropped: string[] | null }>(
      `SELECT ${twinDropCaseSql("t")} AS dropped FROM (SELECT 'URBAN'::text AS class, ARRAY['A','B']::text[] AS localities, ARRAY[]::text[] AS inside_localities) AS t`
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

  it.each(["x", "y"])("should drop the same localities with relation alias %s as with alias t, for every case", async (alias) => {
    const results = await droppedRowsOf(CASES, alias);

    expect(results).toEqual(CASES.map((testCase) => testCase.dropped));
  });

  it.each(["x", "y"])("should drop the same localities with relation alias %s as with alias t, for one case", async (alias) => {
    const testCase = CASES[CASES.length - 1];

    expect(await droppedBy(testCase, alias)).toEqual(await droppedBy(testCase, "t"));
  });

  describe("matrix properties over every class, locality set and inside set", () => {
    let matrixDrops: string[][];

    beforeAll(async () => {
      matrixDrops = await droppedRowsOf(MATRIX);
    }, SETUP_TIMEOUT_MS);

    it("should return one answer per matrix group", () => {
      expect(matrixDrops).toHaveLength(MATRIX.length);
    });

    it("should keep the URBAN base drop: every rural-named copy is dropped when a non-rural-named copy exists", () => {
      const violations = MATRIX.filter((group, index) => {
        const dropped = matrixDrops[index];
        const hasNonRural = group.localities.some((locality) => !isRuralNamed(locality));

        return group.twinClass === TWIN_CLASS.URBAN && hasNonRural && group.localities.some((locality) => isRuralNamed(locality) && !dropped.includes(locality));
      }).map((group) => group.name);

      expect(violations).toEqual([]);
    });

    it("should keep the RURAL base drop: every non-rural-named copy is dropped when a rural-named copy exists", () => {
      const violations = MATRIX.filter((group, index) => {
        const dropped = matrixDrops[index];
        const hasRural = group.localities.some(isRuralNamed);

        return group.twinClass === TWIN_CLASS.RURAL && hasRural && group.localities.some((locality) => !isRuralNamed(locality) && !dropped.includes(locality));
      }).map((group) => group.name);

      expect(violations).toEqual([]);
    });

    it("should keep exactly one copy whenever a kept copy is inside the polygons, over every class", () => {
      const violations = MATRIX.filter((group, index) => {
        const kept = keptOf(group, matrixDrops[index]);

        return kept.some((locality) => group.inside.includes(locality)) && kept.length !== 1;
      }).map((group) => group.name);

      expect(violations).toEqual([]);
    });

    it("should keep exactly one copy for every BOTH group", () => {
      const violations = MATRIX.filter((group, index) => group.twinClass === TWIN_CLASS.BOTH && keptOf(group, matrixDrops[index]).length !== 1).map(
        (group) => group.name
      );

      expect(violations).toEqual([]);
    });

    it("should keep at least one copy for every group", () => {
      const violations = MATRIX.filter((group, index) => keptOf(group, matrixDrops[index]).length === 0).map((group) => group.name);

      expect(violations).toEqual([]);
    });
  });
});
