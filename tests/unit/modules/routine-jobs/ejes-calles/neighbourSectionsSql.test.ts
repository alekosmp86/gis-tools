import { describe, expect, it } from "vitest";
import { neighbourSectionsSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/geometryMap";
import { EJES_TABLE_ROLE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesLayouts } from "./ejesFixtures";

const NEIGHBOUR_CTE_ORDER = ["old", "chosen", "zone", "near", "free", "covered_near", "covered", "picked"];

const sqlOf = (otherStreets = false): string => {
  const layouts = ejesLayouts();
  return neighbourSectionsSql(
    layouts[EJES_TABLE_ROLE.STAGING],
    layouts[EJES_TABLE_ROLE.ROAD_SECTION],
    layouts[EJES_TABLE_ROLE.ACCESS_POINT],
    otherStreets
  );
};

describe("neighbourSectionsSql (EM-6, ET-14, EJS-22)", () => {
  it("should take the old reftramo, the radius and the chosen reftramos as parameters $1, $2 and $3, never inlined", () => {
    const sql = sqlOf();

    expect(sql).toContain("= $1");
    expect(sql).toContain("$2::float8");
    expect(sql).toContain("= ANY($3::text[])");
  });

  it("should declare the CTEs in the order old, chosen, zone, near, free, covered_near, covered, picked", () => {
    const names = [...sqlOf().matchAll(/(\w+) AS \(/g)].map((match) => match[1]);

    expect(names).toEqual(NEIGHBOUR_CTE_ORDER);
  });

  it("should end on the final select with no trailing comma before it or before the closing parenthesis", () => {
    const sql = sqlOf();

    expect(sql.trimEnd().endsWith(",")).toBe(false);
    expect(sql).not.toMatch(/,\s*\)/);
    expect(sql).toMatch(/ORDER BY f\.distance, f\.ref$/);
  });

  it("should not read the short_unheld CTE, which only the other map statements use", () => {
    expect(sqlOf()).not.toContain("short_unheld");
    expect(sqlOf(true)).not.toContain("short_unheld");
  });

  it("should restrict the neighbours to the same street unless otherStreets is set", () => {
    expect(sqlOf(false)).toContain("= o.idcalle");
    expect(sqlOf(true)).not.toContain("= o.idcalle");
  });
});
