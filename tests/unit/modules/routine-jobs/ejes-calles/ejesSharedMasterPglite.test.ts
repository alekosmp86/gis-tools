import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { ANALYSIS_CHANGED_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import { buildAcceptedTablesSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/acceptedSql";
import { LOAD_TEMP } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import { buildDeleteTableSql, buildMergePlanSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/removalPlanSql";
import { buildCreateMergeTableSql, buildCreateSplitTableSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/removalSql";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import type { EjesAccepted } from "@/modules/routine-jobs/jobs/ejes-calles/types";
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
  summaryOn,
  type Row,
  type SqlLog,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });
const NO_ACCEPTED: EjesAccepted = { splits: [], plainRemovals: [], merges: [], twinRemovals: [] };
const MASTER_DELETE = /DELETE FROM "carto"\."addresses_master"/;
const SECTION_DELETE = /DELETE FROM "carto"\."road_section"/;

describe("ejes shared address masters, stub merges and touching neighbours on PGlite (EJ-10, EJ-21, EJS-9, EJS-10)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-shared-master-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

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

  const sectionsByRef = async (ref: number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  const seedMaster = async (id: number): Promise<void> => {
    await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES ($1, 'seed', 0, 0)", [id]);
  };

  const masterIds = async (): Promise<number[]> =>
    (await rowsOf(database, "SELECT addresses_master_id FROM carto.addresses_master ORDER BY 1")).map((row) => Number(row.addresses_master_id));

  /** A staging row on another street, so the analysis is never empty of new sections. */
  const seedUnrelatedStaging = async (ref: string): Promise<void> => {
    await insertStaging(database, [{ ref, calle: "99", nombre: "CALLE NOVENTA Y NUEVE", geom: "900:950" }]);
  };

  describe("a master held by a section that stays or by another holder (EJ-21, shared master F2)", () => {
    it("should keep a master that a kept section still holds: the removed section goes, the master stays, no master is deleted, and nothing aborts", async () => {
      await insertWay(database, 12, "CALLE DOCE");
      await seedMaster(8101);
      await insertSection(database, { ref: 8101, calle: 12, geom: "0:50", distance: "50.00", master: 8101 });
      await insertSection(database, { ref: 8102, calle: 12, geom: "50:100", distance: "50.00", master: 8101 });
      await insertStaging(database, [{ ref: "8102", calle: "12", nombre: "CALLE DOCE", geom: "50:100" }]);
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      const outcome = await persist({ splits: [], plainRemovals: ["8101"], merges: [], twinRemovals: [] }, log);

      expect(await sectionsByRef(8101)).toEqual([]);
      expect(await sectionsByRef(8102)).toHaveLength(1);
      expect(await masterIds()).toEqual([8101]);
      expect(log.some((sql) => MASTER_DELETE.test(sql))).toBe(false);
      expect(outcome.load.counts).toMatchObject({ removed: 1, deleted: 1, merged: 0 });

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should keep a master that carto.address references: the section goes, the master and the address row stay", async () => {
      await insertWay(database, 13, "CALLE TRECE");
      await seedMaster(8201);
      await insertSection(database, { ref: 8201, calle: 13, geom: "0:50", distance: "50.00", master: 8201 });
      await seedUnrelatedStaging("8299");
      await database.query("INSERT INTO carto.address (id_address_master) VALUES ($1)", [8201]);
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      const outcome = await persist({ splits: [], plainRemovals: ["8201"], merges: [], twinRemovals: [] }, log);

      expect(await sectionsByRef(8201)).toEqual([]);
      expect(await masterIds()).toContain(8201);
      expect(log.some((sql) => MASTER_DELETE.test(sql))).toBe(false);
      expect(await rowsOf(database, "SELECT id_address_master FROM carto.address")).toEqual([{ id_address_master: 8201 }]);
      expect(outcome.load.counts).toMatchObject({ removed: 1, deleted: 1 });

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
      expect(await rowsOf(database, "SELECT id_address_master FROM carto.address")).toEqual([{ id_address_master: 8201 }]);
    });

    it("should keep a master that carto.padron references: the section goes, the master stays", async () => {
      await insertWay(database, 14, "CALLE CATORCE");
      await seedMaster(8301);
      await insertSection(database, { ref: 8301, calle: 14, geom: "0:50", distance: "50.00", master: 8301 });
      await seedUnrelatedStaging("8399");
      await database.query("INSERT INTO carto.padron (type_padron, geometry, id_address_master) VALUES ('URBANO', '0:10', $1)", [8301]);
      const log: SqlLog = [];

      const outcome = await persist({ splits: [], plainRemovals: ["8301"], merges: [], twinRemovals: [] }, log);

      expect(await sectionsByRef(8301)).toEqual([]);
      expect(await masterIds()).toContain(8301);
      expect(log.some((sql) => MASTER_DELETE.test(sql))).toBe(false);
      expect(outcome.load.counts).toMatchObject({ removed: 1, deleted: 1 });
    });

    it("should delete a master held by two deleted sections once, and the load counts and writes agree", async () => {
      await insertWay(database, 15, "CALLE QUINCE");
      await seedMaster(8401);
      await insertSection(database, { ref: 8401, calle: 15, geom: "0:50", distance: "50.00", master: 8401 });
      await insertSection(database, { ref: 8402, calle: 15, geom: "50:100", distance: "50.00", master: 8401 });
      await seedUnrelatedStaging("8409");
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      const outcome = await persist({ splits: [], plainRemovals: ["8401", "8402"], merges: [], twinRemovals: [] }, log);

      expect(await sectionsByRef(8401)).toEqual([]);
      expect(await sectionsByRef(8402)).toEqual([]);
      expect(await masterIds()).not.toContain(8401);
      expect(await masterIds()).toHaveLength(1);
      expect(log.filter((sql) => MASTER_DELETE.test(sql))).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ removed: 2, deleted: 2 });

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });
  });

  describe("a plain removal without reftramo (EJ-24, null-ref skip)", () => {
    it("should delete nothing and refuse an accepted key of an empty reftramo as an analysis change", async () => {
      await insertWay(database, 17, "CALLE DIECISIETE");
      await seedMaster(8501);
      await insertSection(database, { ref: null, calle: 17, geom: "0:50", distance: "50.00", master: 8501 });
      await seedUnrelatedStaging("8502");
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist({ splits: [], plainRemovals: [""], merges: [], twinRemovals: [] }, log)).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
      expect(log.some((sql) => SECTION_DELETE.test(sql))).toBe(false);
    });

    it("should leave the section without reftramo in place when nothing is accepted", async () => {
      await insertWay(database, 17, "CALLE DIECISIETE");
      await seedMaster(8511);
      await insertSection(database, { ref: null, calle: 17, geom: "0:50", distance: "50.00", master: 8511 });
      await seedUnrelatedStaging("8512");

      const outcome = await persist();

      expect(await rowsOf(database, "SELECT id FROM carto.road_section WHERE reftramo_ideuy IS NULL")).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ deleted: 0, removed: 0 });
    });
  });

  describe("stub merges with the cover-ratio rule (EJ-10, SPLIT_PIECE_MIN_COVER_M)", () => {
    it("should apply a merge of a 1.5 m stub and a 48.5 m section into one new section, since the stub is covered in full", async () => {
      await insertWay(database, 22, "CALLE VEINTIDOS");
      await seedMaster(8601);
      await seedMaster(8602);
      await insertSection(database, { ref: 8601, calle: 22, geom: "0:1.5", distance: "1.50", master: 8601 });
      await insertSection(database, { ref: 8602, calle: 22, geom: "1.5:50", distance: "48.50", master: 8602 });
      await insertPoints(database, "8601", 1);
      await insertStaging(database, [{ ref: "8603", calle: "22", nombre: "CALLE VEINTIDOS", geom: "0:50" }]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());
      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["8603", ["8601", "8602"]]]);
      expect(analysis.splits).toEqual([]);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["8603"], twinRemovals: [] });

      expect(await sectionsByRef(8601)).toEqual([]);
      expect(await sectionsByRef(8602)).toEqual([]);
      expect(await sectionsByRef(8603)).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ merged: 1, deleted: 2, inserted: 1, pointsMoved: 1 });
    });

    it("should not treat a 1 m section that only touches the end of a 10 m section as its split piece or merge member", async () => {
      await insertWay(database, 23, "CALLE VEINTITRES");
      await insertSection(database, { ref: 8701, calle: 23, geom: "0:10", distance: "10.00" });
      await insertStaging(database, [{ ref: "8702", calle: "23", nombre: "CALLE VEINTITRES", geom: "10:11" }]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.splits).toEqual([]);
      expect(analysis.merges).toEqual([]);
      expect(analysis.plainRemovals.map((row) => row.ref)).toEqual(["8701"]);
    });
  });
});

describe("ejes merge plan and delete plan on PGlite, temp tables only (EJS-4, EJ-21, F2, F4)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** Temp tables live until the end of the transaction, so each test runs inside one and rolls it back. */
  const inTransaction = async (setup: () => Promise<void>, query: string): Promise<Row[]> => {
    await database.exec("BEGIN");
    try {
      await setup();
      return await rowsOf(database, query);
    } finally {
      await database.exec("ROLLBACK");
    }
  };

  const execAll = async (statements: readonly string[]): Promise<void> => {
    for (const statement of statements) {
      // One pg client: each statement builds on the temp tables of the statements before it.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await database.exec(statement);
    }
  };

  const createCopies = async (refs: string[]): Promise<void> => {
    await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.COPY}" (copy_id bigint, ref text, idcalle text)`);
    for (const [index, ref] of refs.entries()) {
      await database.query(`INSERT INTO pg_temp."${LOAD_TEMP.COPY}" (copy_id, ref, idcalle) VALUES ($1, $2, '1')`, [index + 1, ref]);
    }
  };

  /** Old section members of merges: (new reftramo, old section id, old reftramo). Every old section holds one current reftramo, no point. */
  const createMerges = async (members: Array<[string, number, string]>): Promise<void> => {
    await database.exec(buildCreateMergeTableSql(LOAD_TEMP.MERGE));
    for (const [newRef, oldId, oldRef] of members) {
      await database.query(
        `INSERT INTO pg_temp."${LOAD_TEMP.MERGE}" (new_ref, idcalle, old_id, old_ref, points, id_points, old_rows) VALUES ($1, '7', $2, $3, 0, 0, 1)`,
        [newRef, oldId, oldRef]
      );
    }
  };

  describe("buildMergePlanSql: shared old sections between accepted merges (EJS-4, F4)", () => {
    // Two new sections, 9001 and 9002, which both take old section 9102: a shared old section, no split, one kept copy each.
    const sharedMembers: Array<[string, number, string]> = [
      ["9001", 9101, "9101"],
      ["9001", 9102, "9102"],
      ["9002", 9102, "9102"],
      ["9002", 9103, "9103"],
    ];

    const planWith = (accepted: EjesAccepted): Promise<Row[]> =>
      inTransaction(
        async () => {
          await execAll(buildAcceptedTablesSql(accepted));
          await createCopies(["9001", "9002"]);
          await database.exec(buildCreateSplitTableSql(LOAD_TEMP.SPLIT));
          await createMerges(sharedMembers);
          await database.exec(buildMergePlanSql());
        },
        `SELECT new_ref, reason FROM pg_temp."${LOAD_TEMP.MERGE_PLAN}" ORDER BY new_ref`
      );

    it("should refuse both accepted merges with shared_old_ref when they share an old section", async () => {
      const rows = await planWith({ splits: [], plainRemovals: [], merges: ["9001", "9002"], twinRemovals: [] });

      expect(rows.map((row) => [row.new_ref, row.reason])).toEqual([
        ["9001", "shared_old_ref"],
        ["9002", "shared_old_ref"],
      ]);
    });

    it("should apply a single accepted merge whose old section also belongs to a merge that is not accepted", async () => {
      const rows = await planWith({ splits: [], plainRemovals: [], merges: ["9001"], twinRemovals: [] });

      expect(rows.map((row) => [row.new_ref, row.reason])).toEqual([
        ["9001", null],
        ["9002", "not_accepted"],
      ]);
    });
  });

  describe("buildDeleteTableSql: master_deleted with the three holder checks (EJ-21, F2)", () => {
    const layouts = ejesLayouts();

    /** One candidate per case; the holders outside the candidates are kept sections, an address row and a padron row. */
    const seedCases = async (): Promise<void> => {
      await insertWay(database, 30, "CALLE TREINTA");
      await insertSection(database, { ref: 9201, calle: 30, geom: "0:10", distance: "10.00", master: 9201 });
      await insertSection(database, { ref: 9202, calle: 30, geom: "10:20", distance: "10.00", master: 9202 });
      await insertSection(database, { ref: 9203, calle: 30, geom: "20:30", distance: "10.00", master: 9202 });
      await insertSection(database, { ref: 9204, calle: 30, geom: "30:40", distance: "10.00", master: 9204 });
      await database.query("INSERT INTO carto.address (id_address_master) VALUES (9204)");
      await insertSection(database, { ref: 9205, calle: 30, geom: "40:50", distance: "10.00", master: 9205 });
      await database.query("INSERT INTO carto.padron (type_padron, geometry, id_address_master) VALUES ('RURAL', '40:50', 9205)");
      await insertSection(database, { ref: 9206, calle: 30, geom: "50:60", distance: "10.00", master: 9206 });
      await insertSection(database, { ref: 9207, calle: 30, geom: "60:70", distance: "10.00", master: 9208 });
      await insertSection(database, { ref: 9209, calle: 30, geom: "70:80", distance: "10.00", master: 9208 });
      await insertSection(database, { ref: 9210, calle: 30, geom: "80:90", distance: "10.00", master: null });
    };

    /** The plain removal candidates: every case above, each accepted (no point, so none is held back). */
    const CANDIDATE_REFS = ["9201", "9202", "9204", "9205", "9206", "9207", "9209", "9210"];

    it("should mark master_deleted only for a master that nothing else holds, and never for a NULL master", async () => {
      const flags = await inTransaction(
        async () => {
          await seedCases();
          await database.exec(buildCreateMergeTableSql(LOAD_TEMP.MERGE));
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.MERGE_PLAN}" (new_ref text, idcalle text, refs text, points bigint, reason text)`);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.PLAIN_PLAN}" (old_id bigint, ref text, idcalle text, points bigint, reason text)`);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT_PLAN}" (old_id bigint, old_ref text, idcalle text, points bigint, reason text)`);
          await database.exec(
            `INSERT INTO pg_temp."${LOAD_TEMP.PLAIN_PLAN}" SELECT r.id, r.reftramo_ideuy::text, '30', 0, NULL FROM carto.road_section AS r WHERE r.reftramo_ideuy::text IN (${CANDIDATE_REFS.map((ref) => `'${ref}'`).join(", ")})`
          );
          await database.exec(buildDeleteTableSql(layouts));
        },
        `SELECT ref, master_deleted FROM pg_temp."${LOAD_TEMP.DEL}" ORDER BY ref`
      );

      expect(Object.fromEntries(flags.map((row) => [String(row.ref), row.master_deleted]))).toEqual({
        "9201": true,
        "9202": false,
        "9204": false,
        "9205": false,
        "9206": true,
        "9207": true,
        "9209": true,
        "9210": false,
      });
    });
  });
});
