import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import type { EjesAccepted } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import {
  createEjesDatabase,
  insertSection,
  insertStaging,
  insertVertex,
  insertWay,
  loadContextOn,
  paramsWith,
  rowsOf,
  sessionOn,
  setPgrStub,
  snapshotOf,
  summaryOn,
  vertexIdAt,
  type FailRule,
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

describe("ejes topology and vertex cleanup on PGlite (EJ-20, EJ-27, EJ-28)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-topo-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const persist = async (log: SqlLog = [], failOn?: FailRule, accepted?: EjesAccepted): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    const params = paramsWith(summary);
    return runEjesPersistTransaction(sessionOn(database, log, failOn), accepted === undefined ? params : { ...params, accepted }, context, timer());
  };

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) => name.endsWith(".sql.gz"));
  };

  const vertices = async (): Promise<Row[]> =>
    (await rowsOf(database, "SELECT id, the_geom FROM carto.road_section_vertices_pgr ORDER BY id")).map((row) => ({ ...row, id: Number(row.id) }));

  const sectionByRef = (ref: number): Promise<Row[]> => rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  /** Section 2001 runs from the vertex at 0 to the vertex at 50, and a vertex at 999 that no section names is an orphan of the table. */
  const seedRoute = async (): Promise<{ start: number; end: number; orphan: number; section: number }> => {
    await insertWay(database, 10, "CALLE DIEZ");
    const start = await insertVertex(database, "0");
    const end = await insertVertex(database, "50");
    const orphan = await insertVertex(database, "999");
    const section = await insertSection(database, { ref: 2001, calle: 10, geom: "0:50", distance: "50.00", source: start, target: end });
    return { start, end, orphan, section };
  };

  describe("the vertices a load deletes (EJ-27)", () => {
    it("should delete the candidate the GEOM change left unused and keep the one the new geometry still starts at and a pre-existing orphan", async () => {
      const { start, end, orphan } = await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);

      const outcome = await persist();

      const after = await vertices();
      const ids = after.map((row) => row.id);
      expect(ids).toContain(start);
      expect(ids).toContain(orphan);
      expect(ids).not.toContain(end);
      expect(after.find((row) => row.id === orphan)?.the_geom).toBe("999");
      expect(outcome.load.counts).toMatchObject({ topologyAssigned: 1, verticesCreated: 1, verticesDeleted: 1 });
      expect((await sectionByRef(2001))[0]).toMatchObject({ source: start, target: await vertexIdAt(database, "80") });
    });

    it("should keep a candidate that an unchanged section still holds as its source, and count no deletion", async () => {
      const { end } = await seedRoute();
      await insertSection(database, { ref: 2002, calle: 10, geom: "50:100", distance: "50.00", source: end, target: null });
      await insertStaging(database, [
        { ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" },
        { ref: "2002", calle: "10", nombre: "CALLE DIEZ", geom: "50:100" },
      ]);

      const outcome = await persist();

      expect((await vertices()).map((row) => row.id)).toContain(end);
      expect(outcome.load.counts.verticesDeleted).toBe(0);
    });

    it("should keep a candidate that the topology reuses for a NEW section, since the cleanup runs after the topology", async () => {
      const { end } = await seedRoute();
      await insertStaging(database, [
        { ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" },
        { ref: "1001", calle: "10", nombre: "CALLE DIEZ", geom: "50:90" },
      ]);

      const outcome = await persist();

      const newSection = (await rowsOf(database, "SELECT source FROM carto.road_section WHERE reftramo_ideuy = 1001"))[0];
      expect(newSection.source).toBe(end);
      expect((await vertices()).map((row) => row.id)).toContain(end);
      expect(outcome.load.counts.verticesDeleted).toBe(0);
    });

    it("should count the vertex total as before plus the created minus the deleted, and both counts as the table shows", async () => {
      await seedRoute();
      const before = (await vertices()).length;
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);

      const outcome = await persist();

      const after = (await vertices()).length;
      expect(before).toBe(3);
      expect(outcome.load.counts.verticesCreated).toBe(1);
      expect(outcome.load.counts.verticesDeleted).toBe(1);
      expect(after).toBe(before + outcome.load.counts.verticesCreated - outcome.load.counts.verticesDeleted);
    });

    it("should abort with the total mismatch and roll back when a vertex vanishes outside the counted delete", async () => {
      const { orphan } = await seedRoute();
      await database.exec(`
        CREATE FUNCTION drop_orphan_on_delete() RETURNS trigger AS $$
        BEGIN DELETE FROM carto.road_section_vertices_pgr WHERE id = ${orphan}; RETURN OLD; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER drop_orphan AFTER DELETE ON carto.road_section_vertices_pgr FOR EACH ROW EXECUTE FUNCTION drop_orphan_on_delete();
      `);
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);
      const before = await snapshotOf(database);

      await expect(persist()).rejects.toThrow(/no cuadran/);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });
  });

  describe("the topology step (EJ-20)", () => {
    it("should abort, roll back and leave no backup when a section stays without a source or a target after the topology", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);
      await setPgrStub(database, "off");
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist(log)).rejects.toThrow(/sin origen o destino/);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
      expect(log[log.length - 1]).toBe("ROLLBACK");
    });

    it("should not call pgr_createTopology on a run that changes only the attributes of its sections", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", tipo: "PASAJE", geom: "0:50" }]);
      const log: SqlLog = [];
      const verticesBefore = await vertices();

      const outcome = await persist(log);

      expect(log.filter((sql) => /pgr_createTopology/.test(sql))).toEqual([]);
      expect(outcome.load.counts).toMatchObject({ updated: 1, topologyAssigned: 0, verticesCreated: 0, verticesDeleted: 0 });
      expect(await vertices()).toEqual(verticesBefore);
    });

    it("should not call pgr_createTopology nor analyze the vertices on a run with nothing to change", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:50" }]);
      const log: SqlLog = [];

      const outcome = await persist(log);

      expect(log.filter((sql) => /pgr_createTopology/.test(sql))).toEqual([]);
      expect(log.filter((sql) => /^ANALYZE .*road_section_vertices_pgr/.test(sql))).toEqual([]);
      expect(outcome.load.counts).toMatchObject({ topologyAssigned: 0, verticesCreated: 0, verticesDeleted: 0 });
    });

    it("should assign the topology of a NEW section from its endpoints, both sections of the topology set counted", async () => {
      await seedRoute();
      await insertStaging(database, [
        { ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" },
        { ref: "1001", calle: "10", nombre: "CALLE DIEZ", geom: "300:360" },
      ]);

      const outcome = await persist();

      const rows = await rowsOf(database, "SELECT reftramo_ideuy, source, target FROM carto.road_section WHERE reftramo_ideuy IN (1001, 2001) ORDER BY reftramo_ideuy");
      expect(rows).toEqual([
        { reftramo_ideuy: 1001, source: await vertexIdAt(database, "300"), target: await vertexIdAt(database, "360") },
        { reftramo_ideuy: 2001, source: await vertexIdAt(database, "0"), target: await vertexIdAt(database, "80") },
      ]);
      expect(outcome.load.counts).toMatchObject({ topologyAssigned: 2, verticesCreated: 3 });
    });
  });

  describe("the pgr_createTopology result (EJ-20)", () => {
    const NOTICE_ERROR = /pgr_createTopology no completó la topología \(respuesta: "FAIL"\)\. Revise el log del servidor \(NOTICE\)/;

    it("should abort with the NOTICE-log error, roll back and leave no backup when pgr_createTopology returns FAIL", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);
      await setPgrStub(database, "fail");
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist(log)).rejects.toThrow(NOTICE_ERROR);

      expect(log.some((sql) => /pgr_createTopology/.test(sql))).toBe(true);
      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
      expect(log[log.length - 1]).toBe("ROLLBACK");
    });

    it("should abort with the NOTICE-log error and roll back the first assignment when pgr_createTopology fails after assigning one section", async () => {
      await seedRoute();
      await insertStaging(database, [
        { ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" },
        { ref: "1001", calle: "10", nombre: "CALLE DIEZ", geom: "300:360" },
      ]);
      await setPgrStub(database, "partial");
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist(log)).rejects.toThrow(NOTICE_ERROR);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
      expect(log[log.length - 1]).toBe("ROLLBACK");
      expect(log).not.toContain("COMMIT");
    });

    it("should not reach the section check when pgr_createTopology returns FAIL, so the error is the NOTICE one", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);
      await setPgrStub(database, "fail");

      const failure = await persist().then(
        () => "",
        (error: unknown) => (error as Error).message
      );

      expect(failure).toMatch(NOTICE_ERROR);
      expect(failure).not.toMatch(/sin origen o destino/);
    });

    it("should continue past the topology and keep the assignment when pgr_createTopology returns OK", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);
      await setPgrStub(database, "on");

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ topologyAssigned: 1, verticesDeleted: 1 });
      expect((await sectionByRef(2001))[0]).toMatchObject({ source: expect.any(Number), target: await vertexIdAt(database, "80") });
    });
  });

  describe("cleanup of the endpoints of removed sections (EJ-27, EJ-28)", () => {
    const insertMaster = async (id: number): Promise<void> => {
      await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES ($1, 'seed', 0, 0)", [id]);
    };

    /** Section 5001 runs from vertex `start` (0) to vertex `end` (50) and is accepted as a plain removal; vertex `orphan` (999) is no section's. */
    const seedRemoval = async (): Promise<{ start: number; end: number; orphan: number }> => {
      await insertWay(database, 5, "CALLE CINCO");
      await insertMaster(901);
      const start = await insertVertex(database, "0");
      const end = await insertVertex(database, "50");
      const orphan = await insertVertex(database, "999");
      await insertSection(database, { ref: 5001, calle: 5, geom: "0:50", distance: "50.00", master: 901, source: start, target: end });
      await insertStaging(database, [{ ref: "6001", calle: "6", nombre: "CALLE SEIS", geom: "900:950" }]);
      return { start, end, orphan };
    };

    /** Old sections 6101 (0 to 50) and 6102 (50 to 100) merge into 6103 (0 to 100); the vertices 0, 50 and 100 are all held by them. */
    const seedMergeEndpoints = async (): Promise<{ start: number; middle: number; end: number; orphan: number }> => {
      await insertWay(database, 7, "CALLE SIETE");
      await insertMaster(6101);
      await insertMaster(6102);
      const start = await insertVertex(database, "0");
      const middle = await insertVertex(database, "50");
      const end = await insertVertex(database, "100");
      const orphan = await insertVertex(database, "999");
      await insertSection(database, { ref: 6101, calle: 7, geom: "0:50", distance: "50.00", master: 6101, source: start, target: middle });
      await insertSection(database, { ref: 6102, calle: 7, geom: "50:100", distance: "50.00", master: 6102, source: middle, target: end });
      await insertStaging(database, [{ ref: "6103", calle: "7", nombre: "CALLE SIETE", geom: "0:100" }]);
      return { start, middle, end, orphan };
    };

    it("should delete the endpoints of a plain-removed section that no other section uses, and count them as deleted", async () => {
      const { start, end, orphan } = await seedRemoval();

      const outcome = await persist([], undefined, { splits: [], plainRemovals: ["5001"], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });

      const ids = (await vertices()).map((row) => row.id);
      expect(ids).not.toContain(start);
      expect(ids).not.toContain(end);
      expect(ids).toContain(orphan);
      expect(outcome.load.counts).toMatchObject({ removed: 1, verticesDeleted: 2 });
    });

    it("should restore the deleted endpoints with their original ids and geometry when the revert is applied", async () => {
      const { start, end } = await seedRemoval();
      const before = await snapshotOf(database);
      const outcome = await persist([], undefined, { splits: [], plainRemovals: ["5001"], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });
      expect((await vertices()).map((row) => row.id)).not.toContain(start);

      await database.exec(await readBackup(outcome));

      const restored = await vertices();
      expect(restored.find((row) => row.id === start)?.the_geom).toBe("0");
      expect(restored.find((row) => row.id === end)?.the_geom).toBe("50");
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should keep the endpoint a surviving unchanged section still uses as its source, and delete only the other endpoint", async () => {
      const { start, end, orphan } = await seedRemoval();
      await insertSection(database, { ref: 2002, calle: 5, geom: "50:100", distance: "50.00", source: end, target: null });
      await insertStaging(database, [{ ref: "2002", calle: "5", nombre: "CALLE CINCO", geom: "50:100" }]);

      const outcome = await persist([], undefined, { splits: [], plainRemovals: ["5001"], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });

      const ids = (await vertices()).map((row) => row.id);
      expect(ids).toContain(end);
      expect(ids).not.toContain(start);
      expect(ids).toContain(orphan);
      expect(outcome.load.counts.verticesDeleted).toBe(1);
    });

    it("should keep a pre-existing orphan vertex that no candidate names, when a removal deletes its sections", async () => {
      const { orphan } = await seedRemoval();

      await persist([], undefined, { splits: [], plainRemovals: ["5001"], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });

      expect(await vertices()).toContainEqual({ id: orphan, the_geom: "999" });
    });

    it("should delete the endpoint of a merged-away section that the merged section does not reuse, and keep the ones it reuses", async () => {
      const { start, middle, end, orphan } = await seedMergeEndpoints();

      const outcome = await persist([], undefined, { splits: [], plainRemovals: [], merges: ["6103"], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });

      const ids = (await vertices()).map((row) => row.id);
      expect(ids).toContain(start);
      expect(ids).toContain(end);
      expect(ids).not.toContain(middle);
      expect(ids).toContain(orphan);
      expect(outcome.load.counts).toMatchObject({ merged: 1, verticesDeleted: 1 });
      expect((await sectionByRef(6103))[0]).toMatchObject({ source: start, target: end });
    });

    it("should restore the merged-away endpoint with its original id when the revert is applied", async () => {
      const { middle } = await seedMergeEndpoints();
      const before = await snapshotOf(database);
      const outcome = await persist([], undefined, { splits: [], plainRemovals: [], merges: ["6103"], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });
      expect((await vertices()).map((row) => row.id)).not.toContain(middle);

      await database.exec(await readBackup(outcome));

      expect((await vertices()).find((row) => row.id === middle)?.the_geom).toBe("50");
      expect(await snapshotOf(database)).toEqual(before);
    });
  });

  describe("revert of the topology (EJ-28)", () => {
    it("should restore the deleted candidate vertex with its id and geometry, the section's source and target, and remove the created vertices", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);
      const before = await snapshotOf(database);

      const outcome = await persist();
      expect(await snapshotOf(database)).not.toEqual(before);
      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should write the restore of the deleted vertices before the section updates that name them", async () => {
      await seedRoute();
      await insertStaging(database, [{ ref: "2001", calle: "10", nombre: "CALLE DIEZ", geom: "0:80" }]);

      const lines = (await readBackup(await persist())).split("\n");

      const restoredAt = lines.findIndex((line) => line.startsWith('INSERT INTO "carto"."road_section_vertices_pgr"'));
      const sectionAt = lines.findIndex((line) => line.startsWith('UPDATE "carto"."road_section"'));
      expect(restoredAt).toBeGreaterThanOrEqual(0);
      expect(sectionAt).toBeGreaterThan(restoredAt);
    });
  });
});
