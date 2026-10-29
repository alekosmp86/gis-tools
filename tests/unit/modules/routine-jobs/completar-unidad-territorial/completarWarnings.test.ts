import { describe, expect, it } from "vitest";
import {
  buildCompletarWarnings,
  COMMIT_UNKNOWN_WARNING,
  DRY_RUN_WARNING,
} from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/warnings";
import type { CompletarCounts } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";

const TABLE = "carto.territorial_unit";
const NO_AMBIGUOUS: CompletarCounts = { withoutAddressMaster: 2, created: 1, linked: 2, alreadyHadRecord: 1, ambiguous: 0 };
const countsWith = (overrides: Partial<CompletarCounts>): CompletarCounts => ({ ...NO_AMBIGUOUS, ...overrides });

const warningsOf = ({
  dryRun = false,
  counts = NO_AMBIGUOUS,
  commitError,
}: { dryRun?: boolean; counts?: CompletarCounts; commitError?: string } = {}): string[] =>
  buildCompletarWarnings({ dryRun, unitTable: TABLE, counts, commitError });

describe("buildCompletarWarnings", () => {
  describe("dry run and unknown outcome", () => {
    it("should add the dry run warning on a dry run", () => {
      expect(warningsOf({ dryRun: true })).toContain(DRY_RUN_WARNING);
    });

    it("should not add the dry run warning on a real run", () => {
      expect(warningsOf({ dryRun: false })).not.toContain(DRY_RUN_WARNING);
    });

    it("should add the unknown commit warning when the commit error is present", () => {
      expect(warningsOf({ commitError: "conexión perdida" })).toContain(COMMIT_UNKNOWN_WARNING);
    });

    it("should not add the unknown commit warning when there is no commit error", () => {
      expect(warningsOf()).not.toContain(COMMIT_UNKNOWN_WARNING);
    });
  });

  describe("ambiguous units", () => {
    it("should not warn when no unit is ambiguous", () => {
      expect(warningsOf()).toEqual([]);
    });

    it("should warn in the singular with the table when one unit is ambiguous", () => {
      const warnings = warningsOf({ counts: countsWith({ ambiguous: 1 }) });

      expect(warnings).toEqual([
        `1 unidad ambigua en ${TABLE}: tienen más de un registro de dirección maestra con su URN, no se crearon ni enlazaron.`,
      ]);
    });

    it("should warn in the plural with the count when several units are ambiguous", () => {
      const warnings = warningsOf({ counts: countsWith({ ambiguous: 3 }) });

      expect(warnings[0]).toMatch(/^3 unidades ambiguas en carto\.territorial_unit: /);
    });
  });

  describe("linked list limit", () => {
    it("should not warn when the linked units fit the list limit exactly", () => {
      const warnings = warningsOf({ counts: countsWith({ linked: DETAIL_LIST_LIMIT }) });

      expect(warnings.some((warning) => warning.includes("Se listan"))).toBe(false);
    });

    it("should warn that only the first DETAIL_LIST_LIMIT linked units are listed when there are more", () => {
      const warnings = warningsOf({ counts: countsWith({ linked: DETAIL_LIST_LIMIT + 1 }) });

      expect(warnings).toContain(`Se listan las primeras ${DETAIL_LIST_LIMIT} unidades enlazadas en ${TABLE}.`);
    });
  });

  it("should keep the order dry run, ambiguous, list limit, unknown outcome", () => {
    const warnings = warningsOf({
      dryRun: true,
      counts: countsWith({ ambiguous: 1, linked: DETAIL_LIST_LIMIT + 1 }),
      commitError: "x",
    });

    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toBe(DRY_RUN_WARNING);
    expect(warnings[1]).toMatch(/^1 unidad ambigua/);
    expect(warnings[2]).toMatch(new RegExp(`^Se listan las primeras ${DETAIL_LIST_LIMIT} unidades enlazadas`));
    expect(warnings[3]).toBe(COMMIT_UNKNOWN_WARNING);
  });
});
