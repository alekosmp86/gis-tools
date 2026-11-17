import { describe, expect, it } from "vitest";
import { EJES_LOAD_ROLES } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesLoadContextOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadContext";
import type { EjesLoadPlan } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import { prepareAccepted, writeRemovals } from "@/modules/routine-jobs/jobs/ejes-calles/services/removalLoad";
import { ANALYSIS_CHANGED_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import type { EjesLoadContext } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts, ejesTables } from "./ejesFixtures";

type Row = Record<string, unknown>;
type Answer = (sql: string) => Row[];

/** A session whose answer per statement comes from `answer`; every statement is recorded in order. */
function sessionWith(answer: Answer = () => []): { session: RunSession; statements: string[] } {
  const statements: string[] = [];
  const session: RunSession = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: answer(sql) };
    },
    async close() {},
  };
  return { session, statements };
}

const targetOf = (role: (typeof EJES_LOAD_ROLES)[number]): WritableTargetLayout => {
  const layout = ejesLayouts()[role];
  return {
    ...layout,
    srid: 32721,
    idColumn: "id",
    idSequence: null,
    identityColumns: [],
    catalog: Object.keys(layout.columns).map((column) => ({ column_name: column, data_type: "text", is_nullable: true, column_default: null })),
  };
};

const contextOf = (): EjesLoadContext => ejesLoadContextOf(ejesLayouts(), ejesTables(), EJES_LOAD_ROLES.map(targetOf));

/** The load plan fields the removal writes read; the rest of the plan is not used here. */
const planOf = (deleted: number, deletedMasters: number): EjesLoadPlan =>
  ({
    counts: { deleted },
    deletedMasters,
  }) as unknown as EjesLoadPlan;

describe("prepareAccepted (EJS-4, EJ-21, F7)", () => {
  it("should resolve when every accepted key is a merge or a plain removal of this analysis", async () => {
    const { session } = sessionWith((sql) => (sql.includes('AS "missing"') ? [{ missing: 0 }] : []));

    await expect(prepareAccepted(session, { splits: [], plainRemovals: ["5001"], merges: ["6103"] })).resolves.toBeUndefined();
  });

  it("should reject with the analysis-changed message when an accepted key is not in the analysis", async () => {
    const { session } = sessionWith((sql) => (sql.includes('AS "missing"') ? [{ missing: 1 }] : []));

    await expect(prepareAccepted(session, { splits: [], plainRemovals: ["9999"], merges: [] })).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);
  });

  it("should build the accepted temp tables before it checks them against the analysis", async () => {
    const { session, statements } = sessionWith((sql) => (sql.includes('AS "missing"') ? [{ missing: 0 }] : []));

    await prepareAccepted(session, { splits: [], plainRemovals: ["5001"], merges: ["6103"] });

    const missingAt = statements.findIndex((sql) => sql.includes('AS "missing"'));
    const createAt = statements.findIndex((sql) => sql.includes("CREATE TEMP TABLE"));
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(missingAt).toBeGreaterThan(createAt);
  });

  it("should check nothing but still create the empty accepted tables when nothing is accepted", async () => {
    const { session, statements } = sessionWith((sql) => (sql.includes('AS "missing"') ? [{ missing: 0 }] : []));

    await prepareAccepted(session, { splits: [], plainRemovals: [], merges: [] });

    expect(statements.filter((sql) => sql.includes("CREATE TEMP TABLE")).length).toBeGreaterThan(0);
    expect(statements.filter((sql) => sql.includes("INSERT INTO"))).toEqual([]);
  });
});

describe("writeRemovals (EJS-9, EJ-21, F7)", () => {
  it("should write nothing when no section is deleted", async () => {
    const { session, statements } = sessionWith();

    await writeRemovals(session, contextOf(), planOf(0, 0));

    expect(statements).toEqual([]);
  });

  it("should refuse the section delete when fewer sections are written than planned", async () => {
    const { session } = sessionWith((sql) => (sql.includes('DELETE FROM "carto"."road_section"') ? [{ written: 1 }] : []));

    await expect(writeRemovals(session, contextOf(), planOf(2, 0))).rejects.toThrow(
      "Las filas escritas en los tramos quitados (1) no coinciden con las esperadas (2)."
    );
  });

  it("should delete no master when the plan holds none, after the sections", async () => {
    const { session, statements } = sessionWith((sql) => (sql.includes('DELETE FROM "carto"."road_section"') ? [{ written: 2 }] : []));

    await writeRemovals(session, contextOf(), planOf(2, 0));

    expect(statements.filter((sql) => sql.includes('DELETE FROM "carto"."addresses_master"'))).toEqual([]);
    expect(statements.some((sql) => sql.includes('DELETE FROM "carto"."road_section"'))).toBe(true);
  });

  it("should delete the masters after the sections that held them, and refuse a count that differs", async () => {
    const { session, statements } = sessionWith((sql) => (sql.includes('DELETE FROM "carto"."road_section"') ? [{ written: 2 }] : []));

    await expect(writeRemovals(session, contextOf(), planOf(2, 1))).rejects.toThrow(
      "Las filas escritas en las direcciones maestras quitadas (0) no coinciden con las esperadas (1)."
    );
    const sectionAt = statements.findIndex((sql) => sql.includes('DELETE FROM "carto"."road_section"'));
    const masterAt = statements.findIndex((sql) => sql.includes('DELETE FROM "carto"."addresses_master"'));
    expect(masterAt).toBeGreaterThan(sectionAt);
  });
});
