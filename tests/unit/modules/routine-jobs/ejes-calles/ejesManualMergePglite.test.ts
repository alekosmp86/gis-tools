import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { NO_ACCEPTED, summaryOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import type { EjesAccepted, EjesManualSplit } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertPoints,
  insertSection,
  insertStaging,
  insertWay,
  loadContextOn,
  paramsWith,
  rowsOf,
  sessionOn,
  snapshotOf,
  type Row,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });
const STREET = 7;
const OLD_STREET = 99;
const NEW_REF = "6103";

/** Two manual splits that each list the same single new section: the analysis reads them as one merge of the two old sections. */
const MANUAL_MERGE: EjesManualSplit[] = [
  { oldRef: "6101", newRefs: [NEW_REF] },
  { oldRef: "6102", newRefs: [NEW_REF] },
];

const acceptedWith = (manualSplits: EjesManualSplit[]): EjesAccepted => ({ ...NO_ACCEPTED, manualSplits });

describe("manual merge of two old sections on PGlite (EJS-22, EJS-4, EJL-4)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-manual-merge-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
    await insertWay(database, STREET, "CALLE SIETE");
    await insertSection(database, { ref: 6101, calle: STREET, geom: "0:50", distance: "50.00" });
    await insertSection(database, { ref: 6102, calle: STREET, geom: "50:100", distance: "50.00" });
    await insertPoints(database, "6101", 2, OLD_STREET);
    await insertPoints(database, "6102", 1, OLD_STREET);
    await insertStaging(database, [{ ref: NEW_REF, calle: "7", nombre: "CALLE SIETE", geom: "0:60" }]);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  /** The summary the dry run showed: the analysis made with the same manual splits. */
  const analysisWith = async (manualSplits: EjesManualSplit[]) => readAnalysis(sessionOn(database), ejesLayouts(), [], manualSplits);

  const persist = async (manualSplits: EjesManualSplit[]): Promise<EjesPersistOutcome> => {
    const summary = summaryOf(await analysisWith(manualSplits));
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database), { ...paramsWith(summary), accepted: acceptedWith(manualSplits) }, context, timer());
  };

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  const sectionsByRef = async (ref: number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  describe("analysis", () => {
    it("should list the two manual splits that name the same new section as one merge, with no split and no removal", async () => {
      const analysis = await analysisWith(MANUAL_MERGE);

      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([[NEW_REF, ["6101", "6102"]]]);
      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals).toEqual([]);
    });
  });

  describe("load", () => {
    it("should insert the new section once, move the points of both old sections to it with its street, and delete the old sections", async () => {
      const outcome = await persist(MANUAL_MERGE);

      expect(outcome.load.counts).toMatchObject({ inserted: 1, merged: 1, deleted: 2, waysCreated: 0 });
      expect(await sectionsByRef(6103)).toMatchObject([{ reftramo_ideuy: 6103, id_circulation_way: STREET }]);
      expect(await sectionsByRef(6101)).toEqual([]);
      expect(await sectionsByRef(6102)).toEqual([]);
      const points = await rowsOf(database, "SELECT id_road_section::text AS section, id_circulation_way AS way FROM carto.access_point ORDER BY id");
      expect(points).toEqual([
        { section: NEW_REF, way: STREET },
        { section: NEW_REF, way: STREET },
        { section: NEW_REF, way: STREET },
      ]);
    });

    it("should restore the two old sections, their points and their street when the revert SQL is applied", async () => {
      const before = await snapshotOf(database);
      const outcome = await persist(MANUAL_MERGE);
      expect(await sectionsByRef(6103)).toHaveLength(1);

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });
  });
});
