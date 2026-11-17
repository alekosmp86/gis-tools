import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { EJES_SKIP_KIND, EJES_SKIP_REASON, GEO_TWIN_ROLE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import { ANALYSIS_CHANGED_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import type { EjesAccepted, EjesAnalysis, EjesStoredReviewPoint } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertAddress,
  insertPoints,
  insertSection,
  insertStaging,
  insertWay,
  loadContextOn,
  paramsWith,
  rowsOf,
  sessionOn,
  snapshotOf,
  summaryOn,
  type Row,
  type SqlLog,
  type StagingRow,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const STREET = 5;
const STREET_NAME = "CALLE CINCO";
const NO_ACCEPTED: EjesAccepted = { splits: [], plainRemovals: [], merges: [], twinRemovals: [] };
const WRITE_SQL = /^WITH "written"|^(INSERT INTO|UPDATE|DELETE FROM) "?carto/;
const timer = () => createStepTimer({ now: () => 0, total: 20 });

/** A staging row of the test street: same name, type and source as the sections seeded here, so an equal geometry is unchanged. */
const staged = (ref: string, geom: string, localidad?: string): StagingRow => ({
  ref,
  calle: String(STREET),
  nombre: STREET_NAME,
  geom,
  ...(localidad === undefined ? {} : { localidad }),
});

const rolesOf = (analysis: EjesAnalysis): Array<[string, string, boolean]> =>
  [...analysis.geoTwins].sort((a, b) => Number(a.ref) - Number(b.ref)).map((row) => [row.ref, row.role, row.inCarto]);

const reviewPointsOf = (analysis: EjesAnalysis): EjesStoredReviewPoint[] =>
  (analysis as EjesAnalysis & { reviewPoints: EjesStoredReviewPoint[] }).reviewPoints;

describe("geometric twins on PGlite (ET-20 to ET-27)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-geo-twins-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
    await insertWay(database, STREET, STREET_NAME);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const analysisOf = (): Promise<EjesAnalysis> => readAnalysis(sessionOn(database), ejesLayouts());

  const persist = async (accepted: EjesAccepted = NO_ACCEPTED, log: SqlLog = []): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database, log), { ...paramsWith(summary), accepted }, context, timer());
  };

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) => name.endsWith(".sql.gz"));
  };

  const sectionsByRef = async (ref: number | string): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  const sectionsCount = async (): Promise<number> => Number((await rowsOf(database, "SELECT count(*)::int AS n FROM carto.road_section"))[0].n);

  const pointsOn = async (ref: string): Promise<number> =>
    Number((await rowsOf(database, `SELECT count(*)::int AS n FROM carto.access_point WHERE id_road_section = '${ref}'`))[0].n);

  const seedMaster = async (id: number): Promise<void> => {
    await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES ($1, 'seed', 0, 0)", [id]);
  };

  const mastersWith = async (ids: number[]): Promise<Row[]> =>
    rowsOf(database, `SELECT addresses_master_id FROM carto.addresses_master WHERE addresses_master_id IN (${ids.join(", ")})`);

  /** A section of the test street already in carto, with its geometry and reftramo. */
  const seedCurrent = (ref: number, geom: string, master?: number): Promise<number> =>
    insertSection(database, { ref, calle: STREET, geom, distance: "50.00", master: master ?? null });

  describe("roles of the members of a group (ET-21, ET-22)", () => {
    it("should make the lowest reftramo the winner and leave the other member out of the load when no member is in carto", async () => {
      await insertStaging(database, [staged("7002", "0:50"), staged("7001", "0:50")]);

      const analysis = await analysisOf();
      const outcome = await persist();

      expect(rolesOf(analysis)).toEqual([
        ["7001", GEO_TWIN_ROLE.WINNER, false],
        ["7002", GEO_TWIN_ROLE.LOSER, false],
      ]);
      expect(analysis.counts).toMatchObject({ geoTwinGroups: 1, geoTwinSections: 2, geoTwinLosersOmitted: 1, geoTwinLosersRemovable: 0, newSections: 1 });
      expect(await sectionsByRef(7001)).toHaveLength(1);
      expect(await sectionsByRef(7002)).toEqual([]);
      expect(outcome.load.counts.inserted).toBe(1);
      expect(outcome.load.skipped).toEqual([]);
    });

    it("should keep the member already in carto as the winner even when its reftramo is the higher one, and insert no other member", async () => {
      await seedCurrent(7002, "0:50");
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);
      const sectionsBefore = await sectionsCount();

      const analysis = await analysisOf();
      const outcome = await persist();

      expect(rolesOf(analysis)).toEqual([
        ["7001", GEO_TWIN_ROLE.LOSER, false],
        ["7002", GEO_TWIN_ROLE.WINNER, true],
      ]);
      expect(analysis.counts).toMatchObject({ geoTwinLosersOmitted: 1, geoTwinLosersRemovable: 0, newSections: 0 });
      expect(outcome.load.counts.inserted).toBe(0);
      expect(await sectionsByRef(7001)).toEqual([]);
      expect(await sectionsCount()).toBe(sectionsBefore);
    });
  });

  describe("keepers (ET-21)", () => {
    it("should make a member holding a point by its reftramo a keeper, and its partner in carto the only removable loser", async () => {
      await seedCurrent(7001, "0:50");
      await seedCurrent(7002, "0:50");
      await insertPoints(database, "7001", 1);
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);

      const analysis = await analysisOf();

      expect(rolesOf(analysis)).toEqual([
        ["7001", GEO_TWIN_ROLE.KEEPER, true],
        ["7002", GEO_TWIN_ROLE.LOSER, true],
      ]);
      expect(analysis.counts).toMatchObject({ geoTwinLosersRemovable: 1, geoTwinLosersOmitted: 0 });
    });

    it("should make a member whose road_section.id holds a point a keeper, and omit the partner that is not in carto", async () => {
      const id = await seedCurrent(7002, "0:50");
      await insertPoints(database, String(id), 1);
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);

      const analysis = await analysisOf();

      expect(rolesOf(analysis)).toEqual([
        ["7001", GEO_TWIN_ROLE.LOSER, false],
        ["7002", GEO_TWIN_ROLE.KEEPER, true],
      ]);
      expect(analysis.counts).toMatchObject({ geoTwinLosersOmitted: 1, geoTwinLosersRemovable: 0 });
    });

    it("should never remove a keeper even when its partner is also in carto: an accepted keeper aborts before any write", async () => {
      await seedCurrent(7001, "0:50");
      await seedCurrent(7002, "0:50");
      await insertPoints(database, "7001", 1);
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);
      const before = await snapshotOf(database);

      await expect(persist({ ...NO_ACCEPTED, twinRemovals: ["7001"] })).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });

    it("should remove only the accepted loser when its keeper partner holds points, keeping the keeper with its points", async () => {
      await seedCurrent(7001, "0:50");
      await seedCurrent(7002, "0:50");
      await insertPoints(database, "7001", 1);
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);

      const outcome = await persist({ ...NO_ACCEPTED, twinRemovals: ["7002"] });

      expect(await sectionsByRef(7002)).toEqual([]);
      expect(await sectionsByRef(7001)).toHaveLength(1);
      expect(await pointsOn("7001")).toBe(1);
      expect(outcome.load.counts).toMatchObject({ twinsRemoved: 1, removed: 0, deleted: 1 });
    });
  });

  describe("classification of the members (ET-23)", () => {
    it("should group a shared geometry only within its own street and locality, leaving the member of another locality out", async () => {
      await insertStaging(database, [staged("7001", "0:50", "TRINIDAD"), staged("7002", "0:50", "TRINIDAD"), staged("7003", "0:50", "SAN JOSE")]);

      const analysis = await analysisOf();

      expect(analysis.geoTwins.map((row) => row.ref)).toEqual(["7001", "7002"]);
      expect(analysis.counts).toMatchObject({ geoTwinGroups: 1, geoTwinSections: 2, newSections: 2 });
    });

    it("should leave a loser out of the split pieces, so the split takes the winner and the other piece only", async () => {
      await seedCurrent(6901, "0:100");
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50"), staged("7003", "50:100")]);

      const analysis = await analysisOf();

      expect(analysis.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6901", ["7001", "7003"]]]);
      expect(analysis.counts.newSections).toBe(0);
    });

    it("should leave a loser out of the merge members, so the merge takes the winner as its new section", async () => {
      await seedCurrent(6101, "0:50");
      await seedCurrent(6102, "50:100");
      await insertStaging(database, [staged("7001", "0:100"), staged("7002", "0:100")]);

      const analysis = await analysisOf();

      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["7001", ["6101", "6102"]]]);
      expect(analysis.splits).toEqual([]);
    });

    it("should keep a loser in carto off the removed list and list it only as a removal offer, not reported removed", async () => {
      await seedCurrent(7001, "0:50");
      await seedCurrent(7002, "0:50");
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);

      const analysis = await analysisOf();

      expect(analysis.plainRemovals).toEqual([]);
      expect(analysis.counts).toMatchObject({ plainRemovals: 0, geoTwinLosersRemovable: 1 });
      expect(rolesOf(analysis)).toEqual([
        ["7001", GEO_TWIN_ROLE.WINNER, true],
        ["7002", GEO_TWIN_ROLE.LOSER, true],
      ]);
    });

    it("should skip an in-carto loser that nobody accepted as a twin row with reason not_accepted and delete nothing", async () => {
      await seedCurrent(7001, "0:50");
      await seedCurrent(7002, "0:50");
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);

      const outcome = await persist();

      expect(await sectionsByRef(7002)).toHaveLength(1);
      expect(outcome.load.skipped).toEqual([
        { kind: EJES_SKIP_KIND.TWIN, refs: ["7002"], newRefs: [], idcalle: String(STREET), points: 0, reason: EJES_SKIP_REASON.NOT_ACCEPTED },
      ]);
      expect(outcome.load.counts).toMatchObject({ twinsRemoved: 0, deleted: 0 });
    });

    it("should resolve a split whose two candidate pieces are twins with one candidate, so the point goes to it without a review", async () => {
      await seedCurrent(6001, "0:100");
      const point = (await insertPoints(database, "6001", 1))[0];
      await insertAddress(database, point, "10:10");
      await insertStaging(database, [staged("6002", "0:50"), staged("6003", "0:50"), staged("6004", "50:100")]);

      const analysis = await analysisOf();
      const outcome = await persist({ ...NO_ACCEPTED, splits: [{ oldRef: "6001", choices: [] }] });

      expect(analysis.splits.map((row) => [row.oldRef, row.newRefs, row.reviewPoints, row.autoPoints])).toEqual([["6001", ["6002", "6004"], 0, 1]]);
      expect(reviewPointsOf(analysis)).toEqual([]);
      expect(await rowsOf(database, `SELECT id_road_section AS ref FROM carto.access_point WHERE id = ${point}`)).toEqual([{ ref: "6002" }]);
      expect(await sectionsByRef(6003)).toEqual([]);
      expect(await sectionsByRef(6004)).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ splitsApplied: 1, pointsMoved: 1 });
    });
  });

  describe("accepted removal of a loser in carto (ET-24, ET-25)", () => {
    /** Two members in carto with their own masters: 7001 wins, 7002 is the removable loser. */
    const seedTwinsInCarto = async (): Promise<void> => {
      await seedMaster(7001);
      await seedMaster(7002);
      await seedCurrent(7001, "0:50", 7001);
      await seedCurrent(7002, "0:50", 7002);
      await insertStaging(database, [staged("7001", "0:50"), staged("7002", "0:50")]);
    };

    it("should delete the accepted loser with its master, count it as a removed twin and keep the winner", async () => {
      await seedTwinsInCarto();

      const outcome = await persist({ ...NO_ACCEPTED, twinRemovals: ["7002"] });

      expect(await sectionsByRef(7002)).toEqual([]);
      expect(await mastersWith([7002])).toEqual([]);
      expect(await sectionsByRef(7001)).toHaveLength(1);
      expect(await mastersWith([7001])).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ twinsRemoved: 1, removed: 0, deleted: 1 });
      expect(outcome.load.skipped.filter((row) => row.refs.includes("7002"))).toEqual([]);
    });

    it("should restore the removed loser and its master with their original ids when the revert SQL is applied", async () => {
      await seedTwinsInCarto();
      const before = await snapshotOf(database);
      const outcome = await persist({ ...NO_ACCEPTED, twinRemovals: ["7002"] });
      expect(await sectionsByRef(7002)).toEqual([]);

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should abort the whole load, deleting nothing, when an accepted loser gains a point before its delete", async () => {
      await seedTwinsInCarto();
      const before = await snapshotOf(database);
      const base = sessionOn(database);
      const racing = {
        query: async (sql: string, values?: unknown[]) => {
          if (/DELETE FROM "carto"\."road_section"/.test(sql)) {
            await database.query("INSERT INTO carto.access_point (id_road_section) VALUES ('7002')");
          }
          return base.query(sql, values);
        },
        close: base.close,
      };
      const summary = await summaryOn(database);
      const context = await loadContextOn(database);

      await expect(
        runEjesPersistTransaction(racing, { ...paramsWith(summary), accepted: { ...NO_ACCEPTED, twinRemovals: ["7002"] } }, context, timer())
      ).rejects.toThrow();

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });

    it.each([
      ["a reftramo that is not in the analysis", "9999"],
      ["the winner, which is not a removable loser", "7001"],
    ])("should refuse an accepted twin removal of %s as a stale analysis, before any write", async (_label, ref) => {
      await seedTwinsInCarto();
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist({ ...NO_ACCEPTED, twinRemovals: [ref] }, log)).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
      expect(log.filter((sql) => WRITE_SQL.test(sql))).toEqual([]);
    });
  });
});
