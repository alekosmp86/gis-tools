import { describe, expect, it } from "vitest";
import {
  COVERAGE_TOLERANCE_M,
  RENUMBER_CANDIDATE_DISTANCE_M,
  RENUMBER_HAUSDORFF_M,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ANALYSIS_LIST_ALIAS, buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { renumberCountColumns, renumberCtes, renumberListColumn } from "@/modules/routine-jobs/jobs/ejes-calles/domain/renumberSql";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { ejesLayouts } from "./ejesFixtures";

const cteNamed = (name: string): string => renumberCtes().find((entry) => entry.startsWith(`"${name}" AS (`)) ?? "";

describe("renumber constants (ER-1)", () => {
  it("should be 0.5 m for the Hausdorff distance and the existing 1 m tolerance for the candidates", () => {
    expect(RENUMBER_HAUSDORFF_M).toBe(0.5);
    expect(RENUMBER_CANDIDATE_DISTANCE_M).toBe(COVERAGE_TOLERANCE_M);
    expect(RENUMBER_CANDIDATE_DISTANCE_M).toBe(1);
  });
});

describe("renumberCtes (ER-1, ER-2, ER-6)", () => {
  it("should build the five CTEs in order", () => {
    expect(renumberCtes().map((entry) => /^"(\w+)" AS/.exec(entry)?.[1])).toEqual([
      "renum_cand",
      "renum_counted",
      "renumbered",
      "removed_rest",
      "new_rest",
    ]);
  });

  describe("candidates", () => {
    const candidates = cteNamed("renum_cand");

    it("should join the removed and the new sections on the same idcalle and ST_DWithin at the candidate distance", () => {
      expect(candidates).toContain('FROM "removed" AS r JOIN "new_sections" AS n ON n.idcalle = r.idcalle AND ST_DWithin(r.geometry, n.geom, 1)');
    });

    it("should take the candidate distance from the constant", () => {
      expect(candidates).toContain(`ST_DWithin(r.geometry, n.geom, ${RENUMBER_CANDIDATE_DISTANCE_M})`);
    });

    it("should require a Hausdorff distance under the constant", () => {
      expect(candidates).toContain(`ST_HausdorffDistance(r.geometry, n.geom) < ${RENUMBER_HAUSDORFF_M}`);
    });

    it("should only consider removed sections with a length and a non-null idcalle", () => {
      expect(candidates).toContain("r.len > 0");
      expect(candidates).toContain("r.idcalle IS NOT NULL");
    });

    it("should filter by the spatial predicate in the join, before the Hausdorff distance in the WHERE (ER-6)", () => {
      const join = candidates.indexOf("ST_DWithin");
      const hausdorffFilter = candidates.indexOf("WHERE");

      expect(join).toBeGreaterThan(0);
      expect(join).toBeLessThan(hausdorffFilter);
      expect(candidates.slice(0, hausdorffFilter).indexOf("JOIN")).toBeGreaterThan(0);
    });

    it("should never cross join", () => {
      expect(renumberCtes().join(" ")).not.toMatch(/CROSS JOIN/i);
    });
  });

  describe("one-to-one", () => {
    const counted = cteNamed("renum_counted");
    const renumbered = cteNamed("renumbered");

    it("should count the candidates of each old section and of each new section with window counts", () => {
      expect(counted).toContain("count(*) OVER (PARTITION BY c.old_id) AS old_candidates");
      expect(counted).toContain("count(*) OVER (PARTITION BY c.new_ref) AS new_candidates");
    });

    it("should keep only the pairs where each side has exactly one candidate", () => {
      expect(renumbered).toContain("c.old_candidates = 1 AND c.new_candidates = 1");
    });

    it("should carry the points of the old section, 0 when it has none, and the lengths and the distance", () => {
      expect(renumbered).toContain("COALESCE(ap.points, 0) AS points");
      expect(renumbered).toContain('LEFT JOIN "ap" AS ap ON ap.ref = c.old_ref');
      expect(renumbered).toContain("c.old_len, c.new_len, c.hausdorff");
    });
  });

  describe("the rest", () => {
    it("should define removed_rest as the removed sections that are not renumbered", () => {
      expect(cteNamed("removed_rest")).toContain('FROM "removed" AS r WHERE r.id NOT IN (SELECT old_id FROM "renumbered")');
    });

    it("should define new_rest as the new sections that are not renumbered", () => {
      expect(cteNamed("new_rest")).toContain('FROM "new_sections" AS n WHERE n.ref NOT IN (SELECT new_ref FROM "renumbered")');
    });
  });
});

describe("renumber counts and list (ER-3)", () => {
  it("should count the pairs, the pairs with points and the total of points", () => {
    expect(renumberCountColumns()).toEqual([
      '(SELECT count(*) FROM "renumbered" WHERE true) AS "renumbered"',
      '(SELECT count(*) FROM "renumbered" WHERE points > 0) AS "renumbered_with_points"',
      '(SELECT COALESCE(sum(points), 0) FROM "renumbered") AS "renumbered_points"',
    ]);
  });

  it("should list the pairs with their seven fields, points descending then old reftramo, limited", () => {
    const column = renumberListColumn("alias_x");

    expect(column).toContain('AS "alias_x"');
    for (const field of ["old_ref", "new_ref", "idcalle", "points", "old_length", "new_length", "hausdorff"]) {
      expect(column).toContain(`AS "${field}"`);
    }
    expect(column).toContain('FROM "renumbered" AS p ORDER BY p.points DESC, p.old_ref');
    expect(column).toContain(`LIMIT ${DETAIL_LIST_LIMIT}`);
  });
});

describe("renumbered wiring in the analysis (ER-1, ER-2, ER-3)", () => {
  const sql = buildEjesAnalysisSql(ejesLayouts());

  it("should select the counts and the list under their alias", () => {
    for (const alias of ["renumbered", "renumbered_with_points", "renumbered_points"]) {
      expect(sql).toContain(`AS "${alias}"`);
    }
    expect(sql).toContain(`AS "${ANALYSIS_LIST_ALIAS.RENUMBERED}"`);
  });

  it("should define removed and new_sections before the renumber CTEs, and those before the split CTEs", () => {
    const removed = sql.indexOf('"removed" AS (');
    const newSections = sql.indexOf('"new_sections" AS (');
    const candidates = sql.indexOf('"renum_cand" AS (');
    const rest = sql.indexOf('"new_rest" AS (');
    const splits = sql.indexOf('"removed_cover" AS (');

    expect(removed).toBeGreaterThan(0);
    expect(newSections).toBeGreaterThan(0);
    expect(candidates).toBeGreaterThan(Math.max(removed, newSections));
    expect(rest).toBeGreaterThan(candidates);
    expect(splits).toBeGreaterThan(rest);
  });

  it("should keep removed as the raw count of current sections no longer in the file", () => {
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "stg_keys" AS k WHERE k.ref = c.ref)');
    expect(sql).toContain('AS "removed"');
  });

  it("should make the split, merge and plain logic read the rest, never the full removed or new sets", () => {
    const afterRest = sql.slice(sql.indexOf('"new_rest" AS ('));
    const logic = afterRest.slice(afterRest.indexOf(",\n") + 2);

    expect(sql).toContain('FROM "removed_rest" AS r JOIN "new_rest" AS n ON n.idcalle = r.idcalle');
    expect(sql).toContain('FROM "new_rest" AS n JOIN "removed_rest" AS r ON r.idcalle = n.idcalle');
    expect(sql).toContain('FROM "removed_rest" AS r WHERE r.id NOT IN (SELECT id FROM "splits")');
    expect(logic).not.toContain('FROM "removed" AS');
    expect(logic).not.toContain('JOIN "removed" AS');
    expect(logic).not.toContain('JOIN "new_sections" AS');
  });

  it("should stay a single read-only statement", () => {
    expect(sql).toMatch(/^WITH /);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
  });
});
