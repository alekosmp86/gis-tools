import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { ANALYSIS_CHANGED_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import type { EjesSummary } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  createEjesDatabase,
  insertSection,
  insertStaging,
  insertWay,
  loadContextOn,
  paramsWith,
  sessionOn,
  summaryOn,
} from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });

describe("stale-analysis guard on PGlite (EJL-20, EJ-22)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
    await insertWay(database, 10, "CALLE DIEZ");
    await insertSection(database, { ref: 2001, calle: 10, geom: "0:50", distance: "50.00" });
    await insertStaging(database, [
      { ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:50" },
      { ref: "2002", calle: "10", nombre: "CALLE DIEZ", geom: "100:150" },
    ]);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  const persist = async (summary: EjesSummary): Promise<EjesPersistOutcome> => {
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database), paramsWith(summary), context, timer());
  };

  const errorOf = async (summary: EjesSummary): Promise<Error> => {
    try {
      await persist(summary);
    } catch (error: unknown) {
      return error as Error;
    }
    throw new Error("expected the load to refuse the stale summary");
  };

  it("should refuse a load whose data moved, naming the guard count that changed and not the other counts", async () => {
    const summary = await summaryOn(database);
    await database.query("UPDATE bdj_carto.ide_ejesviacirculacion SET geom = '0:60' WHERE reftramo = '2001'");

    const error = await errorOf(summary);

    expect(error.message).toContain(ANALYSIS_CHANGED_MESSAGE);
    expect(error.message).toContain("geom: 0 -> 1");
    expect(error.message).not.toMatch(/newSections|renumberSkipped/);
  });

  it("should name only the staging file when a new row changes the fingerprint and no guard count", async () => {
    const summary = await summaryOn(database);
    await insertStaging(database, [{ ref: "2003", calle: "10", nombre: "CALLE DIEZ", geom: "200:250" }]);

    const error = await errorOf(summary);

    expect(error.message).toContain(`${ANALYSIS_CHANGED_MESSAGE} Cambió: huella del archivo de ejes.`);
    expect(error.message).not.toMatch(/newSections|geom:|removed:/);
  });

  it("should not refuse a load whose summary differs only in a count the choices can change (newSections is not a guard key)", async () => {
    const summary = await summaryOn(database);
    const drifted: EjesSummary = { ...summary, counts: { ...summary.counts, newSections: summary.counts.newSections + 5 } };

    const outcome = await persist(drifted);

    expect(outcome.outcomeUnknown).toBe(false);
    expect(outcome.load.counts.inserted).toBe(1);
  });
});
