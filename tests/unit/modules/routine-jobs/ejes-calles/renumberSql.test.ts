import { describe, expect, it } from "vitest";
import {
  COVERAGE_TOLERANCE_M,
  RENUMBER_CANDIDATE_DISTANCE_M,
  RENUMBER_HAUSDORFF_M,
  RENUMBER_SKIP_REASON,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ANALYSIS_LIST_ALIAS, buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import {
  renumberCountColumns,
  renumberCtes,
  renumberListColumn,
  renumberSkippedListColumn,
  renumberSinkCtes,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/renumberSql";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { ejesLayouts } from "./ejesFixtures";

const cteNamed = (name: string): string => renumberCtes().find((entry) => entry.startsWith(`"${name}" AS (`)) ?? "";

describe("renumber constants (ER-1)", () => {
  it("should be 0.5 m for the Hausdorff distance and the existing 1 m tolerance for the candidates", () => {
    expect(RENUMBER_HAUSDORFF_M).toBe(0.5);
    expect(RENUMBER_CANDIDATE_DISTANCE_M).toBe(COVERAGE_TOLERANCE_M);
    expect(RENUMBER_CANDIDATE_DISTANCE_M).toBe(1);
  });

  it("should name the four refusal reasons of EJL-17 in the spec's words", () => {
    expect(RENUMBER_SKIP_REASON).toEqual({
      REPEATED_OLD_REF: "repeated_old_ref",
      AMBIGUOUS_OLD_REF: "ambiguous_old_ref",
      AMBIGUOUS_NEW_REF: "ambiguous_new_ref",
      NOT_SINGLE_COPY: "not_single_copy",
    });
  });
});

describe("renumberCtes (ER-1, ER-2, ER-6, EJL-10, EJL-12, EJL-17)", () => {
  it("should build the eight CTEs in order: candidates, counts, status, renumbered, skipped, then the rests", () => {
    expect(renumberCtes().map((entry) => /^"(\w+)" AS/.exec(entry)?.[1])).toEqual([
      "renum_cand",
      "cur_rows",
      "renum_counted",
      "renum_status",
      "renumbered",
      "renum_skipped",
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

  describe("counts of candidates and of rows (EJL-17)", () => {
    const counted = cteNamed("renum_counted");

    it("should count the candidates of each old reftramo and of each new reftramo with window counts (EJL-17)", () => {
      expect(counted).toContain("count(*) OVER (PARTITION BY c.old_ref) AS old_candidates");
      expect(counted).toContain("count(*) OVER (PARTITION BY c.new_ref) AS new_candidates");
    });

    it("should not partition the old candidates by section id, so two sections with one reftramo share one count", () => {
      expect(counted).not.toContain("PARTITION BY c.old_id");
    });

    it("should count the current rows of the old reftramo and the kept copies of the new reftramo", () => {
      expect(cteNamed("cur_rows")).toContain('SELECT c.ref, count(*) AS rows FROM "cur" AS c GROUP BY c.ref');
      expect(counted).toContain('LEFT JOIN "cur_rows" AS k ON k.ref = c.old_ref');
      expect(counted).toContain('LEFT JOIN "copy_refs" AS kc ON kc.ref = c.new_ref');
      expect(counted).toContain("COALESCE(k.rows, 0) AS old_rows");
      expect(counted).toContain("COALESCE(kc.copies, 0) AS new_copies");
    });
  });

  describe("status: the first refusal reason wins, NULL when the pair renumbers (EJL-17)", () => {
    const status = cteNamed("renum_status");

    it("should give repeated_old_ref when the old reftramo names more than one row", () => {
      expect(status).toContain(`WHEN c.old_rows > 1 THEN '${RENUMBER_SKIP_REASON.REPEATED_OLD_REF}'`);
    });

    it("should give ambiguous_old_ref when the old row has more than one candidate", () => {
      expect(status).toContain(`WHEN c.old_candidates > 1 THEN '${RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF}'`);
    });

    it("should give ambiguous_new_ref when the new reftramo has more than one candidate", () => {
      expect(status).toContain(`WHEN c.new_candidates > 1 THEN '${RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF}'`);
    });

    it("should give not_single_copy when the new reftramo has zero or several kept copies", () => {
      expect(status).toContain(`WHEN c.new_copies <> 1 THEN '${RENUMBER_SKIP_REASON.NOT_SINGLE_COPY}'`);
    });

    it("should check the four reasons in the order of EJL-17 and leave the reason NULL for a renumber", () => {
      const order = ["repeated_old_ref", "ambiguous_old_ref", "ambiguous_new_ref", "not_single_copy"].map((reason) => status.indexOf(reason));

      expect([...order].sort((first, second) => first - second)).toEqual(order);
      expect(status).toContain("END AS skip_reason");
    });

    it("should report a pair with one candidate on each side and one kept copy as renumbering", () => {
      expect(cteNamed("renumbered")).toContain("WHERE c.skip_reason IS NULL");
    });
  });

  describe("renumbered and held pairs (EJL-10, EJL-12)", () => {
    const renumbered = cteNamed("renumbered");

    it("should carry the section id, both refs, the street, the points of the old reftramo and the lengths and the distance", () => {
      expect(renumbered).toContain("SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.old_len, c.new_len, c.hausdorff");
      expect(renumbered).toContain('LEFT JOIN "ap" AS ap ON ap.ref = c.old_ref');
    });

    it("should keep the held pair as one row with both refs and its reason", () => {
      const skipped = cteNamed("renum_skipped");

      expect(skipped).toContain("SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.skip_reason AS reason");
      expect(skipped).toContain("WHERE c.skip_reason IS NOT NULL");
    });
  });

  describe("the rest", () => {
    it("should define removed_rest as the removed sections that are neither renumbered nor held (EJL-12)", () => {
      expect(cteNamed("removed_rest")).toContain(
        'FROM "removed" AS r WHERE r.id NOT IN (SELECT old_id FROM "renumbered") AND r.id NOT IN (SELECT old_id FROM "renum_skipped")'
      );
    });

    it("should define new_rest as the new sections that are neither renumbered nor held (EJL-12)", () => {
      expect(cteNamed("new_rest")).toContain(
        'FROM "new_sections" AS n WHERE n.ref NOT IN (SELECT new_ref FROM "renumbered") AND n.ref NOT IN (SELECT new_ref FROM "renum_skipped")'
      );
    });
  });
});

describe("renumber sinks (EJL-23)", () => {
  it("should insert the renumbered pairs and the held pairs into the two temp tables, one data-modifying CTE each", () => {
    const sinks = renumberSinkCtes({ renumbered: "pg_temp.\"ej_renum\"", skipped: "pg_temp.\"ej_held\"" });

    expect(sinks).toHaveLength(2);
    expect(sinks[0]).toBe(
      '"renum_sink" AS (INSERT INTO pg_temp."ej_renum" (old_id, old_ref, new_ref, points) SELECT r.old_id, r.old_ref, r.new_ref, r.points FROM "renumbered" AS r RETURNING 1)'
    );
    expect(sinks[1]).toBe(
      '"held_sink" AS (INSERT INTO pg_temp."ej_held" (old_id, old_ref, new_ref, idcalle, points, reason) SELECT r.old_id, r.old_ref, r.new_ref, r.idcalle, r.points, r.reason FROM "renum_skipped" AS r RETURNING 1)'
    );
  });
});

describe("renumber counts and list (ER-3, EJL-12, EJL-13)", () => {
  it("should count the pairs, the pairs with points, the total of points and the held pairs", () => {
    expect(renumberCountColumns()).toEqual([
      '(SELECT count(*) FROM "renumbered" WHERE true) AS "renumbered"',
      '(SELECT count(*) FROM "renumbered" WHERE points > 0) AS "renumbered_with_points"',
      '(SELECT COALESCE(sum(points), 0) FROM "renumbered") AS "renumbered_points"',
      '(SELECT count(*) FROM (SELECT DISTINCT p.old_ref, p.new_ref FROM "renum_skipped" AS p) AS pairs) AS "renumber_skipped"',
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

  it("should list the held pairs with both refs, the street, the points and the reason, points descending then old reftramo", () => {
    const column = renumberSkippedListColumn("alias_y");

    expect(column).toContain('AS "alias_y"');
    for (const field of ["old_ref", "new_ref", "idcalle", "points", "reason"]) {
      expect(column).toContain(`AS "${field}"`);
    }
    expect(column).toContain('FROM "renum_skipped" AS p ORDER BY p.points DESC, p.old_ref');
    expect(column).toContain(`LIMIT ${DETAIL_LIST_LIMIT}`);
  });

  it("should list one row per distinct (old, new) pair of the held set (EJL-12)", () => {
    const column = renumberSkippedListColumn("alias_z");

    expect(column).toContain(
      'SELECT DISTINCT p.old_ref AS "old_ref", p.new_ref AS "new_ref", p.idcalle AS "idcalle", p.points AS "points", p.reason AS "reason" FROM "renum_skipped" AS p ORDER BY p.points DESC, p.old_ref, p.new_ref'
    );
  });
});

describe("renumbered wiring in the analysis (ER-1, ER-2, ER-3)", () => {
  const sql = buildEjesAnalysisSql(ejesLayouts());

  it("should select the counts and the lists under their alias", () => {
    for (const alias of ["renumbered", "renumbered_with_points", "renumbered_points", "renumber_skipped"]) {
      expect(sql).toContain(`AS "${alias}"`);
    }
    expect(sql).toContain(`AS "${ANALYSIS_LIST_ALIAS.RENUMBERED}"`);
    expect(sql).toContain(`AS "${ANALYSIS_LIST_ALIAS.RENUMBER_SKIPPED}"`);
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

  it("should keep removed as the raw count of current sections no longer in the file, held ones aside (EJL-12)", () => {
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "stg_keys" AS k WHERE k.ref = c.ref)');
    expect(sql).toContain('AS "removed"');
    expect(sql).toContain('WHERE id NOT IN (SELECT old_id FROM "renum_skipped")) AS "removed"');
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
