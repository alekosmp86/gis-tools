import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertSection, insertStaging, insertWay, sessionOn } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;

describe("old sections kept by a discarded file row on PGlite (ET-18, EJL-27)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
    await insertWay(database, 5, "CALLE UNO");
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  const analyse = () => readAnalysis(sessionOn(database), ejesLayouts());

  it("should keep an old section whose reftramo has only a discarded row, with reason same_reftramo, when no new section lies there", async () => {
    await insertSection(database, { ref: 1001, calle: 5, geom: "0:10" });
    await insertStaging(database, [{ ref: "1001", calle: "5", nombre: "CALLE UNO", geom: "0:0" }]);

    const analysis = await analyse();

    expect(analysis.counts).toMatchObject({ removed: 1, plainRemovals: 0, keptByDiscardedCandidate: 1 });
    expect(analysis.keptByDiscarded).toEqual([{ ref: "1001", idcalle: "5", points: 0, discardedRef: "1001", reason: "same_reftramo" }]);
  });

  it("should keep an old section with no row of its reftramo, when a discarded row of its street lies within 1 m, with reason place", async () => {
    await insertSection(database, { ref: 2001, calle: 5, geom: "0:10" });
    await insertStaging(database, [{ ref: "2002", calle: "5", nombre: "CALLE UNO", geom: "0:0.5" }]);

    const analysis = await analyse();

    expect(analysis.counts).toMatchObject({ removed: 1, plainRemovals: 0, keptByDiscardedCandidate: 1 });
    expect(analysis.keptByDiscarded).toEqual([{ ref: "2001", idcalle: "5", points: 0, discardedRef: "2002", reason: "place" }]);
  });

  it("should leave an old section to the normal rules and not keep it when a kept new section lies at its place", async () => {
    await insertSection(database, { ref: 2001, calle: 5, geom: "0:10" });
    await insertStaging(database, [
      { ref: "2002", calle: "5", nombre: "CALLE UNO", geom: "0:0.5" },
      { ref: "2003", calle: "5", nombre: "CALLE UNO", geom: "0:10" },
    ]);

    const analysis = await analyse();

    expect(analysis.counts).toMatchObject({ renumbered: 1, renumberSkipped: 0, plainRemovals: 0, keptByDiscardedCandidate: 0 });
    expect(analysis.keptByDiscarded).toEqual([]);
  });

  it("should keep an old section with no candidate and no points as a plain removal", async () => {
    await insertSection(database, { ref: 4001, calle: 7, geom: "0:10" });

    const analysis = await analyse();

    expect(analysis.counts).toMatchObject({ removed: 1, plainRemovals: 1, keptByDiscardedCandidate: 0 });
    expect(analysis.plainRemovals).toEqual([{ ref: "4001", idcalle: "7", points: 0 }]);
    expect(analysis.keptByDiscarded).toEqual([]);
  });
});
