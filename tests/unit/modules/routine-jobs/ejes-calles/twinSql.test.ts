import { describe, expect, it } from "vitest";
import { buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { twinCountColumns, twinCtes, twinDropCaseSql, twinGroupCtes, twinListColumn } from "@/modules/routine-jobs/jobs/ejes-calles/domain/twinSql";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { ejesLayouts } from "./ejesFixtures";

describe("twinSql module (ET-13)", () => {
  const layouts = ejesLayouts();

  it("should build the group and class CTEs in the order the analysis needs them", () => {
    const names = [...twinGroupCtes(layouts), ...twinCtes(layouts)].map((cte) => /^"?(\w+)"? AS/.exec(cte)?.[1]);

    expect(names).toEqual(["twin_raw", "twin_groups", "twin_measured", "twin_classed", "twin_located", "twins"]);
  });

  it("should put the whole twin SQL into the analysis, once", () => {
    const sql = buildEjesAnalysisSql(layouts);

    for (const piece of [...twinGroupCtes(layouts), ...twinCtes(layouts), twinListColumn("twins_json"), ...twinCountColumns()]) {
      expect(sql).toContain(piece);
    }
    expect(sql.split('"twin_located" AS (')).toHaveLength(2);
  });

  it("should build the list column under the given alias, limited and ordered", () => {
    const column = twinListColumn("some_alias");

    expect(column).toContain('AS "some_alias"');
    expect(column).toContain(`LIMIT ${DETAIL_LIST_LIMIT}`);
    expect(column).toContain("ORDER BY CASE t.class WHEN 'NEITHER' THEN 0 WHEN 'BOTH' THEN 1 WHEN 'RURAL' THEN 2 WHEN 'URBAN' THEN 3 END, t.ref");
  });

  it("should build the eight twin count columns", () => {
    const aliases = twinCountColumns().map((column) => /AS "(\w+)"$/.exec(column)?.[1]);

    expect(aliases).toEqual([
      "twins",
      "twins_both",
      "twins_urban",
      "twins_rural",
      "twins_neither",
      "twins_drop",
      "twins_keep",
      "twins_cross_department",
    ]);
  });

  it("should build the drop rule over any alias, reading only class, localities and inside_localities", () => {
    const sql = twinDropCaseSql("x");

    expect(sql).toMatch(/^CASE /);
    expect(sql).toMatch(/END$/);
    expect(sql).toContain("x.class");
    expect(sql).toContain("x.localities");
    expect(sql).toContain("x.inside_localities");
    expect(sql).not.toContain("c.");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/);
  });
});
