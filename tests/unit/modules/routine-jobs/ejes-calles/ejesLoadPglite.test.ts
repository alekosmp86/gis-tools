import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { NO_ACCEPTED } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import {
  createEjesDatabase,
  insertPadron,
  insertPoints,
  insertSection,
  insertStaging,
  insertVertex,
  insertWay,
  loadContextOn,
  paramsWith,
  PASSWORD,
  rowsOf,
  sessionOn,
  snapshotOf,
  summaryOn,
  vertexIdAt,
  zeroLoadCounts,
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

describe("ejes load slice 1 on PGlite (EJL-1 to EJL-14)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const persist = async (log: SqlLog = [], failOn?: FailRule, renamedStreets: string[] = []): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(
      sessionOn(database, log, failOn),
      { ...paramsWith(summary), accepted: { ...NO_ACCEPTED, renamedStreets } },
      context,
      timer()
    );
  };

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) => name.endsWith(".sql.gz"));
  };

  const sectionByRef = async (ref: number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  describe("NEW sections (EJL-5, EJL-8)", () => {
    it("should insert a NEW section with mapped type and font, one distance text, its way and master, and the source and target of the topology", async () => {
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", tipo: "PASAJE", fuente: "OSM", geom: "0:123.456" },
      ]);

      const outcome = await persist();

      const sections = await sectionByRef(1001);
      expect(sections).toHaveLength(1);
      expect(sections[0]).toMatchObject({
        reftramo_ideuy: 1001,
        id_circulation_way: 77,
        id_road_section_type: 10,
        id_font: 32,
        source: await vertexIdAt(database, "0"),
        target: await vertexIdAt(database, "123.456"),
        distance: "123.46",
        geometry: "0:123.456",
      });
      expect(outcome.load.counts).toMatchObject({ inserted: 1, waysCreated: 1, updated: 0, renumbered: 0, pointsMoved: 0, topologyAssigned: 1 });
      expect(outcome.targetModified).toBe(true);
      expect(outcome.outcomeUnknown).toBe(false);
    });

    it("should create one addresses_master per NEW section linked through id_address_master with urn latitud and longitud", async () => {
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "CALLE A", geom: "0:10" },
        { ref: "1002", calle: "78", nombre: "CALLE B", geom: "20:30" },
      ]);

      await persist();

      const rows = await rowsOf(
        database,
        "SELECT s.id, s.id_address_master, m.urn, m.latitud, m.longitud FROM carto.road_section s JOIN carto.addresses_master m ON m.addresses_master_id = s.id_address_master ORDER BY s.id"
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.urn).toBe(`cgeo:road_section:id:${row.id}`);
        expect(row.latitud).toBe(0);
        expect(row.longitud).toBe(0);
      }
      expect(new Set(rows.map((row) => row.id_address_master)).size).toBe(2);
      expect(await rowsOf(database, "SELECT count(*)::int AS n FROM carto.addresses_master")).toEqual([{ n: 2 }]);
    });

    it("should insert the way with the short_name rules and the type and font of the first section by numeric reftramo", async () => {
      await insertStaging(database, [
        { ref: "100", calle: "77", nombre: "AVENIDA ITALIA", tipo: "CALLE", fuente: "IDE", geom: "0:10" },
        { ref: "99", calle: "77", nombre: "AVENIDA ITALIA", tipo: "PASAJE", fuente: "OSM", geom: "20:30" },
      ]);

      await persist();

      const ways = await rowsOf(database, "SELECT * FROM carto.circulation_way");
      expect(ways).toHaveLength(1);
      expect(ways[0]).toMatchObject({ id_calle: 77, name: "AVENIDA ITALIA", short_name: "AV ITALIA", id_road_type: 10, id_font: 32 });
    });

    it("should not create a way nor touch existing ways when the (idcalle, name) pair already exists", async () => {
      await insertWay(database, 77, "AVENIDA ITALIA", 4, 1);
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", tipo: "PASAJE", fuente: "OSM", geom: "0:10" }]);
      const waysBefore = await rowsOf(database, "SELECT * FROM carto.circulation_way ORDER BY id");

      const outcome = await persist();

      expect(await rowsOf(database, "SELECT * FROM carto.circulation_way ORDER BY id")).toEqual(waysBefore);
      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 0, inserted: 1 });
    });

    it("should rename the existing way of a street id to the file's name and short name instead of creating a second way", async () => {
      await insertWay(database, 77, "NOMBRE VIEJO");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", geom: "0:10" }]);

      const outcome = await persist([], undefined, ["77"]);

      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 1, inserted: 1 });
      expect(await rowsOf(database, "SELECT id_calle, name, short_name FROM carto.circulation_way ORDER BY id")).toEqual([
        { id_calle: 77, name: "AVENIDA ITALIA", short_name: "AV ITALIA" },
      ]);
    });

    it("should rename both rows of a street id that holds two other names, and create no way", async () => {
      await insertWay(database, 77, "NOMBRE VIEJO A");
      await insertWay(database, 77, "NOMBRE VIEJO B");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", geom: "0:10" }]);

      const outcome = await persist([], undefined, ["77"]);

      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 2 });
      expect((await rowsOf(database, "SELECT name FROM carto.circulation_way ORDER BY id")).map((row) => row.name)).toEqual([
        "AVENIDA ITALIA",
        "AVENIDA ITALIA",
      ]);
    });

    it("should not rename any row of a street id that already holds the file's name, and not list it as a rename", async () => {
      const matching = await insertWay(database, 77, "AVENIDA ITALIA", 4, 1);
      const differing = await insertWay(database, 77, "NOMBRE VIEJO");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", geom: "0:10" }]);
      const waysBefore = await rowsOf(database, "SELECT * FROM carto.circulation_way ORDER BY id");

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 0, inserted: 1 });
      expect(await rowsOf(database, "SELECT * FROM carto.circulation_way ORDER BY id")).toEqual(waysBefore);
      expect(await rowsOf(database, `SELECT id, name FROM carto.circulation_way WHERE id IN (${matching}, ${differing}) ORDER BY id`)).toEqual([
        { id: matching, name: "AVENIDA ITALIA" },
        { id: differing, name: "NOMBRE VIEJO" },
      ]);
    });

    it("should fail closed with the analysis-changed message when a street that holds the file's name is accepted for a rename, before any write", async () => {
      await insertWay(database, 77, "AVENIDA ITALIA", 4, 1);
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", geom: "0:10" }]);
      const before = await snapshotOf(database);

      await expect(persist([], undefined, ["77"])).rejects.toThrow(/vuelva a analizar/);

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should create a single way for two NEW sections with the same (idcalle, name)", async () => {
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "CALLE A", geom: "0:10" },
        { ref: "1002", calle: "77", nombre: "CALLE A", geom: "20:30" },
      ]);

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ inserted: 2, waysCreated: 1 });
    });

    it("should assign ids above the table maximum when the sequences are behind (sequences repaired first)", async () => {
      await insertSection(database, { id: 500, ref: 5, calle: 1, geom: "0:5", master: 900 });
      await insertWay(database, 1, "VIA SEMBRADA", 4, 1, 300);
      await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES (700, 'x', 0, 0)");
      await insertStaging(database, [
        { ref: "5", calle: "1", nombre: "VIA SEMBRADA", geom: "0:5" },
        { ref: "1001", calle: "77", nombre: "CALLE A", geom: "50:60" },
      ]);

      await persist();

      const section = (await sectionByRef(1001))[0];
      expect(Number(section.id)).toBeGreaterThan(500);
      expect(Number(section.id_address_master)).toBeGreaterThan(700);
      const way = (await rowsOf(database, "SELECT id FROM carto.circulation_way WHERE id_calle = 77"))[0];
      expect(Number(way.id)).toBeGreaterThan(300);
    });

    it("should write distance with two decimals as text for a whole length", async () => {
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "CALLE A", geom: "0:80" }]);

      await persist();

      expect((await sectionByRef(1001))[0].distance).toBe("80.00");
    });

    it("should merge a two-part geometry that ST_LineMerge joins into one LineString", async () => {
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "CALLE A", geom: "0:5|5:10" }]);

      await persist();

      expect((await sectionByRef(1001))[0]).toMatchObject({ geometry: "0:10", distance: "10.00" });
    });
  });

  describe("ATTR and GEOM updates (EJL-9)", () => {
    const seedPair = async (): Promise<{ target: number; other: number }> => {
      await insertWay(database, 10, "CALLE UNO");
      const target = await insertSection(database, { ref: 2001, calle: 10, geom: "0:50", type: 4, font: 1, source: 5, target: 6, distance: "50.00" });
      const other = await insertSection(database, { ref: 2002, calle: 10, geom: "100:150", type: 4, font: 1, source: 7, target: 8, distance: "marker" });
      return { target, other };
    };

    it("should update only the changed type on an ATTR change and keep source, target, distance and geometry", async () => {
      const { target } = await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", tipo: "PASAJE", fuente: "IDE", geom: "0:50" },
        { ref: "2002", calle: "10", tipo: "CALLE", fuente: "IDE", geom: "100:150" },
      ]);

      const outcome = await persist();

      const row = (await sectionByRef(2001))[0];
      expect(row).toMatchObject({ id: target, id_road_section_type: 10, id_font: 1, id_circulation_way: 10, source: 5, target: 6, distance: "50.00", geometry: "0:50" });
      expect(outcome.load.counts).toMatchObject({ updated: 1, inserted: 0, renumbered: 0 });
    });

    it("should update only the font when the font changes", async () => {
      await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", tipo: "CALLE", fuente: "OSM", geom: "0:50" },
        { ref: "2002", calle: "10", tipo: "CALLE", fuente: "IDE", geom: "100:150" },
      ]);

      await persist();

      expect((await sectionByRef(2001))[0]).toMatchObject({ id_road_section_type: 4, id_font: 32, source: 5, target: 6 });
    });

    it("should update only id_circulation_way when idcalle changes", async () => {
      await seedPair();
      await insertWay(database, 11, "CALLE DOS");
      await insertStaging(database, [
        { ref: "2001", calle: "11", nombre: "CALLE DOS", geom: "0:50" },
        { ref: "2002", calle: "10", geom: "100:150" },
      ]);

      await persist();

      expect((await sectionByRef(2001))[0]).toMatchObject({ id_circulation_way: 11, id_road_section_type: 4, id_font: 1, source: 5, target: 6, distance: "50.00" });
    });

    it("should recompute distance and reassign source and target by the topology on a GEOM change, keeping the attributes", async () => {
      await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", geom: "0:80" },
        { ref: "2002", calle: "10", geom: "100:150" },
      ]);

      const outcome = await persist();

      expect((await sectionByRef(2001))[0]).toMatchObject({
        geometry: "0:80",
        distance: "80.00",
        source: await vertexIdAt(database, "0"),
        target: await vertexIdAt(database, "80"),
        id_road_section_type: 4,
        id_font: 1,
      });
      expect(outcome.load.counts).toMatchObject({ updated: 1, topologyAssigned: 1 });
    });

    it("should apply ATTR and GEOM changes of the same section as one updated section", async () => {
      await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", tipo: "PASAJE", geom: "0:80" },
        { ref: "2002", calle: "10", geom: "100:150" },
      ]);

      const outcome = await persist();

      expect((await sectionByRef(2001))[0]).toMatchObject({
        id_road_section_type: 10,
        geometry: "0:80",
        distance: "80.00",
        source: await vertexIdAt(database, "0"),
        target: await vertexIdAt(database, "80"),
      });
      expect(outcome.load.counts).toMatchObject({ updated: 1, topologyAssigned: 1 });
    });

    it("should leave an unchanged section byte for byte as it was", async () => {
      const { other } = await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", tipo: "PASAJE", geom: "0:50" },
        { ref: "2002", calle: "10", geom: "100:150" },
      ]);
      const before = (await sectionByRef(2002))[0];

      await persist();

      expect((await sectionByRef(2002))[0]).toEqual(before);
      expect((await sectionByRef(2002))[0].id).toBe(other);
    });

    it("should leave every table but circulation_way unchanged on a name change alone, and rename the one way of the street id (waysRenamed)", async () => {
      await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", nombre: "AVENIDA ITALIA", geom: "0:50" },
        { ref: "2002", calle: "10", nombre: "AVENIDA ITALIA", geom: "100:150" },
      ]);
      const before = await snapshotOf(database);

      const outcome = await persist([], undefined, ["10"]);

      const after = await snapshotOf(database);
      for (const table of Object.keys(before).filter((name) => name !== "carto.circulation_way")) {
        expect(after[table], table).toEqual(before[table]);
      }
      expect(after["carto.circulation_way"]).toEqual([{ ...before["carto.circulation_way"][0], name: "AVENIDA ITALIA", short_name: "AV ITALIA" }]);
      expect(outcome.load.counts).toMatchObject({ updated: 0, inserted: 0, waysCreated: 0, waysRenamed: 1 });
    });

    it("should not treat a geometry that differs by float noise under 1 mm as a change", async () => {
      await seedPair();
      await insertStaging(database, [
        { ref: "2001", calle: "10", geom: "0:50.0004" },
        { ref: "2002", calle: "10", geom: "100:150" },
      ]);

      const outcome = await persist();

      expect(outcome.load.counts.updated).toBe(0);
      expect((await sectionByRef(2001))[0].geometry).toBe("0:50");
    });
  });

  describe("renumbered sections (EJL-10, EJL-11)", () => {
    const seedRenumber = async (pointsOnOld: number) => {
      await insertWay(database, 5, "CALLE UNO");
      const id = await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      const moved = await insertPoints(database, "3001", pointsOnOld);
      const others = [...(await insertPoints(database, "9999", 2)), ...(await insertPoints(database, null, 1)), ...(await insertPoints(database, "abc", 1))];
      await database.query("INSERT INTO carto.road_section_vertices_pgr (the_geom) VALUES ('1:2')");
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      return { id, moved, others };
    };

    it("should update reftramo_ideuy and the id_road_section of the old points, keeping the section id", async () => {
      const { id, moved } = await seedRenumber(3);

      const outcome = await persist();

      const sections = await rowsOf(database, "SELECT id, reftramo_ideuy FROM carto.road_section ORDER BY id");
      expect(sections).toEqual([{ id, reftramo_ideuy: 3002 }]);
      const points = await rowsOf(database, `SELECT id, id_road_section FROM carto.access_point WHERE id IN (${moved.join(",")}) ORDER BY id`);
      expect(points.map((row) => row.id_road_section)).toEqual(["3002", "3002", "3002"]);
      expect(outcome.load.counts).toMatchObject({ renumbered: 1, pointsMoved: 3, inserted: 0, updated: 0, waysCreated: 0 });
    });

    it("should list the renumbered section with its id and the points moved", async () => {
      const { id } = await seedRenumber(3);

      const outcome = await persist();

      expect(outcome.load.renumbered).toEqual([{ oldRef: "3001", newRef: "3002", id: String(id), points: 3 }]);
    });

    it("should never delete an access point, keep every id, and touch only the points of the old reftramo", async () => {
      const { moved, others } = await seedRenumber(3);
      const before = await rowsOf(database, "SELECT id, id_road_section FROM carto.access_point ORDER BY id");

      await persist();

      const after = await rowsOf(database, "SELECT id, id_road_section FROM carto.access_point ORDER BY id");
      expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
      const changed = after.filter((row, index) => row.id_road_section !== before[index].id_road_section).map((row) => row.id);
      expect(changed).toEqual(moved);
      for (const id of others) {
        expect(after.find((row) => row.id === id)?.id_road_section).toBe(before.find((row) => row.id === id)?.id_road_section);
      }
    });

    it("should not write road_section_vertices_pgr", async () => {
      await seedRenumber(2);
      const before = await rowsOf(database, "SELECT * FROM carto.road_section_vertices_pgr");

      await persist();

      expect(await rowsOf(database, "SELECT * FROM carto.road_section_vertices_pgr")).toEqual(before);
    });

    it("should issue no write on access_point other than the id_road_section update, and none on vertices", async () => {
      await seedRenumber(2);
      const log: SqlLog = [];

      const outcome = await persist(log);

      const writes = log.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)/i.test(sql) || /\b(INSERT INTO|UPDATE|DELETE FROM)\s+"?carto"?\."?access_point/i.test(sql));
      const onAccessPoint = writes.filter((sql) => /access_point/.test(sql));
      expect(onAccessPoint).toHaveLength(1);
      expect(onAccessPoint[0]).toMatch(/UPDATE\s+"carto"\."access_point"/);
      expect(onAccessPoint[0]).toMatch(/SET "id_road_section"/);
      expect(log.filter((sql) => /DELETE\s+FROM/i.test(sql) && /access_point/.test(sql))).toEqual([]);
      const vertexWrites = log.filter((sql) => /^WITH "written" AS \((INSERT|UPDATE|DELETE)[^]*road_section_vertices_pgr/.test(sql));
      expect(vertexWrites.every((sql) => sql.includes('pg_temp."ej_vertex_candidates"'))).toBe(true);
      expect(outcome.load.counts).toMatchObject({ verticesCreated: 0, verticesDeleted: 0 });
      expect(log.filter((sql) => /^ANALYZE .*road_section_vertices_pgr/.test(sql))).toEqual([]);
      expect(log.filter((sql) => /pgr_createTopology/.test(sql))).toEqual([]);
    });

    it("should report 0 points moved and write nothing on access_point for a renumbered section without points", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100" });
      await insertPoints(database, "9999", 2);
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      const log: SqlLog = [];

      const outcome = await persist(log);

      expect(outcome.load.counts).toMatchObject({ renumbered: 1, pointsMoved: 0 });
      expect(log.filter((sql) => /UPDATE\s+"carto"\."access_point"/.test(sql))).toEqual([]);
      expect((await sectionByRef(3002))).toHaveLength(1);
    });

    it("should not renumber when the new geometry is at 0.5 m or more (boundary)", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100" });
      await insertPoints(database, "3001", 2);
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100.5" }]);

      const outcome = await persist();

      expect(outcome.load.counts.renumbered).toBe(0);
      expect((await sectionByRef(3001))).toHaveLength(1);
      expect(await rowsOf(database, "SELECT count(*)::int AS n FROM carto.access_point WHERE id_road_section = '3001'")).toEqual([{ n: 2 }]);
    });
  });

  describe("pairing of copies and existing sections (EJL-6, EJL-7)", () => {
    it("K < E: should update the K pairs by idcalle and name, report the surplus with its points and never delete it", async () => {
      await insertWay(database, 8, "CALLE OCHO");
      await insertWay(database, 9, "CALLE NUEVE");
      const first = await insertSection(database, { ref: 4001, calle: 8, geom: "0:50", distance: "50.00" });
      const second = await insertSection(database, { ref: 4001, calle: 9, geom: "0:50", distance: "50.00" });
      await insertPoints(database, "4001", 4);
      await insertStaging(database, [{ ref: "4001", calle: "9", nombre: "CALLE NUEVE", tipo: "PASAJE", geom: "0:50" }]);

      const outcome = await persist();

      const rows = await sectionByRef(4001);
      expect(rows.map((row) => row.id)).toEqual([first, second]);
      expect(rows.find((row) => row.id === second)?.id_road_section_type).toBe(10);
      expect(rows.find((row) => row.id === first)?.id_road_section_type).toBe(4);
      expect(outcome.load.surplus).toEqual([{ ref: "4001", id: String(first), points: 4 }]);
      expect(outcome.load.surplusTotal).toBe(1);
      expect(outcome.load.counts).toMatchObject({ updated: 1, inserted: 0 });
    });

    it("K < E: should pair by the lowest id when no existing row has the idcalle and name of the copy", async () => {
      await insertWay(database, 8, "CALLE OCHO");
      const first = await insertSection(database, { ref: 4001, calle: 8, geom: "0:50", distance: "50.00" });
      const second = await insertSection(database, { ref: 4001, calle: 8, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "4001", calle: "8", nombre: "CALLE OCHO", tipo: "PASAJE", geom: "0:50" }]);

      const outcome = await persist();

      const rows = await sectionByRef(4001);
      expect(rows.find((row) => row.id === first)?.id_road_section_type).toBe(10);
      expect(rows.find((row) => row.id === second)?.id_road_section_type).toBe(4);
      expect(outcome.load.surplus.map((row) => row.id)).toEqual([String(second)]);
    });

    it("BOTH keeps one copy: should drop the rural-named copy, pair the remaining copy with the existing row, leave it unchanged and insert nothing", async () => {
      await insertWay(database, 10, "CALLE UNO");
      const existing = await insertSection(database, { ref: 4100, calle: 10, geom: "0:50", distance: "50.00" });
      await insertPadron(database, "URBANO", "0:50");
      await insertPadron(database, "RURAL", "0:50");
      await insertStaging(database, [
        { ref: "4100", calle: "10", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "4100", calle: "10", localidad: "FLORES RURAL", geom: "0:50" },
      ]);

      const outcome = await persist();

      const rows = await sectionByRef(4100);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(existing);
      expect(outcome.load.counts).toMatchObject({ inserted: 0, updated: 0 });
      expect(outcome.load.surplus).toEqual([]);
    });

    it("should drop the rural copy of a twin next to urban padrones only, so K = E = 1 and nothing is inserted", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 4200, calle: 10, geom: "0:50", distance: "50.00" });
      await insertPadron(database, "URBANO", "0:50");
      await insertStaging(database, [
        { ref: "4200", calle: "10", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "4200", calle: "10", localidad: "FLORES RURAL", geom: "0:50" },
      ]);

      const outcome = await persist();

      expect(await sectionByRef(4200)).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ inserted: 0, updated: 0 });
    });

    it("should count copies of the same locality and department as one copy", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 4300, calle: 10, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [
        { ref: "4300", calle: "10", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "4300", calle: "10", localidad: "TRINIDAD", geom: "0:50" },
      ]);

      const outcome = await persist();

      expect(await sectionByRef(4300)).toHaveLength(1);
      expect(outcome.load.counts).toMatchObject({ inserted: 0, updated: 0 });
    });
  });

  describe("skipped sections (EJL-12)", () => {
    it("should not modify a section absent from staging and report it as a skipped removal with its points", async () => {
      await insertWay(database, 6, "CALLE SEIS");
      const id = await insertSection(database, { ref: 7001, calle: 6, geom: "0:100", distance: "100.00" });
      await insertPoints(database, "7001", 2);
      await insertStaging(database, [{ ref: "7099", calle: "99", nombre: "OTRA", geom: "5000:5050" }]);
      const before = (await sectionByRef(7001))[0];

      const outcome = await persist();

      expect((await sectionByRef(7001))[0]).toEqual(before);
      expect((await sectionByRef(7001))[0].id).toBe(id);
      expect(outcome.load.skipped).toEqual([
        { kind: "removal", refs: ["7001"], newRefs: [], idcalle: "6", points: 2, reason: "not_accepted" },
      ]);
    });

    it("should not modify the old section of a split and report it as skipped", async () => {
      await insertWay(database, 3, "CALLE TRES");
      await insertSection(database, { ref: 6001, calle: 3, geom: "0:100", distance: "100.00" });
      await insertPoints(database, "6001", 1);
      await insertStaging(database, [
        { ref: "6002", calle: "3", nombre: "CALLE TRES", geom: "0:50" },
        { ref: "6003", calle: "3", nombre: "CALLE TRES", geom: "50:100" },
      ]);
      const before = (await sectionByRef(6001))[0];

      const outcome = await persist();

      expect((await sectionByRef(6001))[0]).toEqual(before);
      expect(outcome.load.skipped).toEqual([
        { kind: "split", refs: ["6001"], newRefs: ["6002", "6003"], idcalle: "3", points: 1, reason: "not_accepted" },
      ]);
      expect(await rowsOf(database, "SELECT count(*)::int AS n FROM carto.access_point WHERE id_road_section = '6001'")).toEqual([{ n: 1 }]);
    });

    it("should not modify the old sections of a merge and report them as skipped", async () => {
      await insertWay(database, 4, "CALLE CUATRO");
      await insertSection(database, { ref: 8001, calle: 4, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 8002, calle: 4, geom: "50:100", distance: "50.00" });
      await insertPoints(database, "8001", 1);
      await insertPoints(database, "8002", 2);
      await insertStaging(database, [{ ref: "8003", calle: "4", nombre: "CALLE CUATRO", geom: "0:100" }]);
      const before = [...(await sectionByRef(8001)), ...(await sectionByRef(8002))];

      const outcome = await persist();

      expect([...(await sectionByRef(8001)), ...(await sectionByRef(8002))]).toEqual(before);
      expect(outcome.load.skipped).toEqual([
        { kind: "merge", refs: ["8001", "8002"], newRefs: ["8003"], idcalle: "4", points: 3, reason: "not_accepted" },
      ]);
    });
  });

  describe("transaction (EJL-2, EJL-3, EJL-4)", () => {
    const seedChanges = async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00", source: 1, target: 2 });
      await insertPoints(database, "3001", 2);
      await insertStaging(database, [
        { ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" },
        { ref: "2001", calle: "5", nombre: "CALLE UNO", tipo: "PASAJE", geom: "0:80" },
        { ref: "1001", calle: "77", nombre: "CALLE NUEVA", geom: "200:260" },
      ]);
    };

    it("should lock the five tables, the vertices included, in SHARE ROW EXCLUSIVE MODE with a lock_timeout before any other statement of the apply", async () => {
      await seedChanges();
      const log: SqlLog = [];

      await persist(log);

      const begin = log.findIndex((sql) => /^BEGIN/.test(sql));
      const timeout = log.findIndex((sql) => /^SET LOCAL lock_timeout = \d+$/.test(sql));
      const lock = log.findIndex((sql) => /^LOCK TABLE/.test(sql));
      const firstRead = log.findIndex((sql) => /ide_ejesviacirculacion/.test(sql));
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(timeout).toBeGreaterThan(begin);
      expect(lock).toBeGreaterThan(timeout);
      expect(firstRead).toBeGreaterThan(lock);
      for (const name of ["road_section", "circulation_way", "addresses_master", "access_point", "road_section_vertices_pgr"]) {
        expect(log[lock]).toContain(`"carto"."${name}"`);
      }
      expect(log[lock]).toMatch(/IN SHARE ROW EXCLUSIVE MODE$/);
    });

    it("should end with ANALYZE of exactly the changed tables, the vertices included when the topology created vertices, then COMMIT", async () => {
      await seedChanges();
      const log: SqlLog = [];

      const outcome = await persist(log);

      expect(outcome.load.counts.verticesCreated).toBeGreaterThan(0);
      const analyzed = log.filter((sql) => /^ANALYZE "carto"/.test(sql));
      expect(analyzed.sort()).toEqual(
        [
          'ANALYZE "carto"."access_point";',
          'ANALYZE "carto"."addresses_master";',
          'ANALYZE "carto"."circulation_way";',
          'ANALYZE "carto"."road_section";',
          'ANALYZE "carto"."road_section_vertices_pgr";',
        ].sort()
      );
      const lastWrite = Math.max(...log.map((sql, index) => (/^WITH "written"/.test(sql) ? index : -1)));
      const firstAnalyze = log.findIndex((sql) => /^ANALYZE "carto"/.test(sql));
      expect(firstAnalyze).toBeGreaterThan(lastWrite);
      expect(log[log.length - 1]).toBe("COMMIT");
    });

    it("should not analyze a table the load did not change", async () => {
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "CALLE NUEVA", geom: "200:260" }]);
      const log: SqlLog = [];

      await persist(log);

      expect(log.some((sql) => sql === 'ANALYZE "carto"."access_point";')).toBe(false);
    });

    it("should report the outcome as unknown, not modified, and scrub the password when COMMIT fails", async () => {
      await seedChanges();

      const outcome = await persist([], "COMMIT");

      expect(outcome.outcomeUnknown).toBe(true);
      expect(outcome.targetModified).toBe(false);
      expect(outcome.commitError).toBeDefined();
      expect(outcome.commitError).not.toContain(PASSWORD);
      expect(outcome.commitError).toContain("***");
    });

    it("should abort on a blocker before the backup and the writes, leaving no file and rolling back", async () => {
      await seedChanges();
      await insertStaging(database, [{ ref: "x1", calle: "5", nombre: "ROTA", geom: "0:1" }]);
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist(log)).rejects.toThrow(/entero/);

      expect(await backupFiles()).toEqual([]);
      expect(log.some((sql) => /ej_copy|ej_rev_|written/.test(sql))).toBe(false);
      expect(log[log.length - 1]).toBe("ROLLBACK");
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should abort on an unknown tipo_vialidad blocker before the backup", async () => {
      await seedChanges();
      await insertStaging(database, [{ ref: "1002", calle: "5", tipo: "AUTOPISTA", geom: "0:1" }]);

      await expect(persist()).rejects.toThrow(/Tipo de vialidad/);

      expect(await backupFiles()).toEqual([]);
    });

    it("should abort on an empty idcalle blocker before the backup", async () => {
      await insertStaging(database, [{ ref: "1002", calle: null, geom: "0:1" }]);

      await expect(persist()).rejects.toThrow(/idcalle/);

      expect(await backupFiles()).toEqual([]);
    });

    it("should abort when a geometry stays multi-part after ST_LineMerge, before the backup and the writes", async () => {
      await seedChanges();
      await insertStaging(database, [{ ref: "1003", calle: "5", nombre: "CALLE UNO", geom: "0:10|20:30" }]);
      const before = await snapshotOf(database);

      await expect(persist()).rejects.toThrow(/varias partes/);

      expect(await backupFiles()).toEqual([]);
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should abort with the analysis-changed message when the summary no longer matches the staging", async () => {
      await seedChanges();
      const summary = await summaryOn(database);
      await insertStaging(database, [{ ref: "1004", calle: "88", nombre: "OTRA", geom: "900:950" }]);
      const context = await loadContextOn(database);

      await expect(
        runEjesPersistTransaction(sessionOn(database), paramsWith(summary), context, timer())
      ).rejects.toThrow(/vuelva a analizar/);

      expect(await backupFiles()).toEqual([]);
    });

    it("should scrub the password from the error of a failing statement and roll back", async () => {
      await seedChanges();
      const before = await snapshotOf(database);

      const failure = await persist([], (sql) => /^LOCK TABLE/.test(sql)).catch((error: unknown) => error as Error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(PASSWORD);
      expect((failure as Error).message).toContain("***");
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should roll back every write and leave no file when a write fails", async () => {
      await seedChanges();
      const before = await snapshotOf(database);

      await expect(persist([], (sql) => /^WITH "written" AS \(UPDATE/.test(sql) && /id_road_section_type|geometry/.test(sql))).rejects.toThrow(
        /No se pudo completar/
      );

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should write, verify and register the backup before the first write, and leave no file when the backup fails", async () => {
      await seedChanges();
      const before = await snapshotOf(database);

      await expect(persist([], (sql) => /FROM pg_temp\."ej_rev_inserts"/.test(sql))).rejects.toThrow(/respaldo/);

      expect(await backupFiles()).toEqual([]);
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should read every revert page before the first INSERT or UPDATE on a target table", async () => {
      await seedChanges();
      const log: SqlLog = [];

      await persist(log);

      const firstWrite = log.findIndex((sql) => /^WITH "written"/.test(sql));
      const lastRevertRead = Math.max(...log.map((sql, index) => (/FROM pg_temp\."ej_rev_/.test(sql) ? index : -1)));
      expect(firstWrite).toBeGreaterThan(-1);
      expect(lastRevertRead).toBeGreaterThan(-1);
      expect(lastRevertRead).toBeLessThan(firstWrite);
    });
  });

  describe("backup file and revert (EJL-4)", () => {
    const seedChanges = async () => {
      await insertVertex(database, "0");
      await insertVertex(database, "50");
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00", source: 1, target: 2 });
      await insertPoints(database, "3001", 2);
      await insertPoints(database, "other", 1);
      await insertStaging(database, [
        { ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" },
        { ref: "2001", calle: "5", nombre: "CALLE UNO", tipo: "PASAJE", geom: "0:80" },
        { ref: "1001", calle: "77", nombre: "CALLE NUEVA", geom: "200:260" },
      ]);
    };

    const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
      const entry = getRevertBackup(outcome.load.backup?.token ?? "");
      expect(entry).toBeDefined();
      return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
    };

    it("should register the gzip file with its name, size and counts", async () => {
      await seedChanges();

      const outcome = await persist();

      const backup = outcome.load.backup;
      expect(backup?.fileName).toMatch(/^ejes-revert-carto-road_section-\d{8}-\d{6}-\d{3}\.sql\.gz$/);
      const entry = getRevertBackup(backup?.token ?? "");
      expect(entry?.bytes).toBe(backup?.bytes);
      expect((await stat(entry?.filePath ?? "")).size).toBe(backup?.bytes);
      expect(backup?.counts).toEqual({ updated: 1, inserted: 1, ways: 1, masters: 1, pointsMoved: 2, deleted: 0 });
    });

    it("should write a transaction that restores the old values of updated and renumbered sections", async () => {
      await seedChanges();

      const text = await readBackup(await persist());

      expect(text.startsWith("SET client_encoding = 'UTF8';\nBEGIN;\n")).toBe(true);
      expect(text.trimEnd().endsWith("COMMIT;")).toBe(true);
      const sectionLines = text.split("\n").filter((line) => line.startsWith('UPDATE "carto"."road_section"'));
      expect(sectionLines).toHaveLength(2);
      const renumbered = sectionLines.find((line) => line.includes("'3001'"));
      expect(renumbered).toContain('"reftramo_ideuy" = \'3001\'');
      const attr = sectionLines.find((line) => line.includes("'2001'"));
      expect(attr).toContain('"distance" = \'50.00\'');
      expect(attr).toContain("'0:50'");
      expect(attr).toContain('"source" = \'1\'');
      expect(attr).toContain('"target" = \'2\'');
    });

    it("should restore the points to their old reftramo by id", async () => {
      await seedChanges();

      const text = await readBackup(await persist());

      const pointLines = text.split("\n").filter((line) => line.startsWith('UPDATE "carto"."access_point" SET "id_road_section"'));
      expect(pointLines).toHaveLength(1);
      expect(pointLines[0]).toContain("'3001'");
      expect(pointLines[0]).toMatch(/WHERE "id" IN \('\d+', '\d+'\);$/);
    });

    it("should restore the street of the moved points by id, to the value they held before the move", async () => {
      await seedChanges();

      const text = await readBackup(await persist());

      const wayLines = text.split("\n").filter((line) => line.startsWith('UPDATE "carto"."access_point" SET "id_circulation_way"'));
      expect(wayLines).toHaveLength(1);
      expect(wayLines[0]).toMatch(/ = NULL WHERE "id" IN \('\d+', '\d+'\);$/);
    });

    it("should delete the inserted ids: sections first, then masters, then ways", async () => {
      await seedChanges();

      const text = await readBackup(await persist());

      const deletes = text.split("\n").filter((line) => line.startsWith("DELETE FROM"));
      expect(deletes.map((line) => /DELETE FROM ("carto"\."\w+")/.exec(line)?.[1])).toEqual([
        '"carto"."road_section"',
        '"carto"."addresses_master"',
        '"carto"."circulation_way"',
        '"carto"."road_section_vertices_pgr"',
      ]);
      expect(text.lastIndexOf("UPDATE")).toBeLessThan(text.indexOf("DELETE FROM"));
    });

    it("should leave an empty transaction when nothing changed", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "2001", calle: "5", nombre: "CALLE UNO", geom: "0:50" }]);

      const text = await readBackup(await persist());

      expect(text).toBe(
        [
          "SET client_encoding = 'UTF8';",
          "BEGIN;",
          `DELETE FROM "carto"."road_section_vertices_pgr" AS v WHERE v."id" > 0 AND NOT EXISTS (SELECT 1 FROM "carto"."road_section" AS r WHERE r."source" = v."id" OR r."target" = v."id");`,
          "COMMIT;",
          "",
        ].join("\n")
      );
    });

    it("should restore the old names of the renamed street rows when the revert SQL is applied", async () => {
      await insertWay(database, 77, "NOMBRE VIEJO A");
      await insertWay(database, 77, "NOMBRE VIEJO B");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "AVENIDA ITALIA", geom: "0:10" }]);
      const before = await snapshotOf(database);
      const outcome = await persist([], undefined, ["77"]);
      expect(outcome.load.counts.waysRenamed).toBe(2);

      await database.exec(await readBackup(outcome));

      expect((await snapshotOf(database))["carto.circulation_way"]).toEqual(before["carto.circulation_way"]);
    });

    it("should restore the exact pre-state of every table when the revert SQL is applied", async () => {
      await seedChanges();
      const before = await snapshotOf(database);
      const outcome = await persist();
      expect(await snapshotOf(database)).not.toEqual(before);

      await database.exec(await readBackup(outcome));

      const after = await snapshotOf(database);
      expect(after["carto.road_section"]).toEqual(before["carto.road_section"]);
      expect(after["carto.circulation_way"]).toEqual(before["carto.circulation_way"]);
      expect(after["carto.addresses_master"]).toEqual(before["carto.addresses_master"]);
      expect(after["carto.access_point"]).toEqual(before["carto.access_point"]);
      expect(after["carto.road_section_vertices_pgr"]).toEqual(before["carto.road_section_vertices_pgr"]);
    });

    it("should restore source, target, distance and geometry changed by a GEOM update, and the vertices the topology added", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00", source: 11, target: 12 });
      await insertStaging(database, [{ ref: "2001", calle: "5", nombre: "CALLE UNO", geom: "0:90" }]);
      const before = await snapshotOf(database);

      const outcome = await persist();
      expect((await sectionByRef(2001))[0]).toMatchObject({
        source: await vertexIdAt(database, "0"),
        target: await vertexIdAt(database, "90"),
        distance: "90.00",
      });
      expect(outcome.load.counts).toMatchObject({ verticesCreated: 2, verticesDeleted: 0 });
      await database.exec(await readBackup(outcome));

      expect((await snapshotOf(database))["carto.road_section"]).toEqual(before["carto.road_section"]);
      expect((await snapshotOf(database))["carto.road_section_vertices_pgr"]).toEqual(before["carto.road_section_vertices_pgr"]);
    });
  });

  describe("revert file name (EJL-25)", () => {
    const SHARED_BACKUP_PATTERN = /^(padron|centros-anep|ejes)-revert-.*\.sql\.gz$/;

    const seedOneChange = async (): Promise<void> => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "2001", calle: "5", nombre: "CALLE UNO", tipo: "PASAJE", geom: "0:80" }]);
    };

    it("should name two runs in the same second by their milliseconds, so the second run does not collide with the first file", async () => {
      await seedOneChange();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T10:00:00.100Z"));
      const first = await persist();
      vi.setSystemTime(new Date("2026-01-01T10:00:00.200Z"));

      const second = await persist();

      const firstName = first.load.backup?.fileName ?? "";
      const secondName = second.load.backup?.fileName ?? "";
      expect(firstName).toMatch(/^ejes-revert-carto-road_section-\d{8}-\d{6}-100\.sql\.gz$/);
      expect(secondName).toMatch(/^ejes-revert-carto-road_section-\d{8}-\d{6}-200\.sql\.gz$/);
      expect(secondName.replace(/-\d{3}\.sql\.gz$/, "")).toBe(firstName.replace(/-\d{3}\.sql\.gz$/, ""));
      expect(new Set([firstName, secondName]).size).toBe(2);
      expect((await backupFiles()).sort()).toEqual([firstName, secondName].sort());
    });

    it("should name the file so the shared BACKUP_FILE_PATTERN of the padron store still matches it", async () => {
      await seedOneChange();

      const outcome = await persist();

      expect(outcome.load.backup?.fileName).toMatch(SHARED_BACKUP_PATTERN);
    });
  });

  describe("access_point and idempotence (EJL-11, EJL-13, EJL-14)", () => {
    const seedAll = async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00", source: 1, target: 2 });
      await insertSection(database, { ref: 2002, calle: 5, geom: "100:150", distance: "50.00" });
      await insertPoints(database, "3001", 2);
      await insertPoints(database, "2001", 3);
      await insertStaging(database, [
        { ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" },
        { ref: "2001", calle: "5", nombre: "CALLE UNO", tipo: "PASAJE", geom: "0:80" },
        { ref: "2002", calle: "5", nombre: "CALLE UNO", geom: "100:150" },
        { ref: "1001", calle: "77", nombre: "CALLE NUEVA", geom: "200:260" },
      ]);
    };

    it("should keep every access point id and the access point count across a full run", async () => {
      await seedAll();
      const before = await rowsOf(database, "SELECT id FROM carto.access_point ORDER BY id");

      await persist();

      expect(await rowsOf(database, "SELECT id FROM carto.access_point ORDER BY id")).toEqual(before);
    });

    it("should leave untouched the access points matching neither a reftramo nor a section id, and issue no DELETE on access_point", async () => {
      await seedAll();
      const orphans = [
        ...(await insertPoints(database, "9999999", 2)),
        ...(await insertPoints(database, "orphan", 1)),
        ...(await insertPoints(database, "", 1)),
        ...(await insertPoints(database, null, 1)),
      ];
      const before = await rowsOf(database, `SELECT * FROM carto.access_point WHERE id IN (${orphans.join(",")}) ORDER BY id`);
      const log: SqlLog = [];

      const outcome = await persist(log);

      expect(outcome.load.counts).toMatchObject({ renumbered: 1, updated: 1, inserted: 1, pointsMoved: 2 });
      expect(await rowsOf(database, `SELECT * FROM carto.access_point WHERE id IN (${orphans.join(",")}) ORDER BY id`)).toEqual(before);
      expect(log.filter((sql) => /DELETE/i.test(sql) && /access_point/.test(sql))).toEqual([]);
      expect(log.some((sql) => /UPDATE\s+"carto"\."access_point"/.test(sql))).toBe(true);
    });

    it("should change nothing on a second run over the same staging", async () => {
      await seedAll();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      const first = await persist();
      expect(first.load.counts).toMatchObject({ inserted: 1, updated: 1, renumbered: 1, waysCreated: 1, pointsMoved: 2 });
      const afterFirst = await snapshotOf(database);
      vi.setSystemTime(new Date("2026-01-01T10:05:00Z"));

      const second = await persist();

      expect(await snapshotOf(database)).toEqual(afterFirst);
      expect(second.load.counts).toEqual(zeroLoadCounts());
      expect(second.load.renumbered).toEqual([]);
    });

    it("should return counts, skipped and surplus lists and the backup in the load report", async () => {
      await seedAll();

      const outcome = await persist();

      expect(Object.keys(outcome.load).sort()).toEqual(
        ["backup", "counts", "renumbered", "skipped", "skippedByReason", "skippedTotal", "surplus", "surplusTotal"]
      );
      expect(Object.keys(outcome.load.counts).sort()).toEqual(
        [
          "deleted",
          "inserted",
          "merged",
          "pointsMoved",
          "removed",
          "renumberSkipped",
          "renumbered",
          "splitsApplied",
          "topologyAssigned",
          "twinsRemoved",
          "updated",
          "verticesCreated",
          "verticesDeleted",
          "waysCreated",
          "waysRenamed",
        ]
      );
      expect(outcome.load.skipped).toEqual([]);
      expect(outcome.load.skippedTotal).toBe(0);
      expect(outcome.load.skippedByReason).toEqual([]);
      expect(outcome.load.surplus).toEqual([]);
    });

    it("should leave the database untouched, with no backup, on a run that fails on the lock", async () => {
      await seedAll();
      const before = await snapshotOf(database);

      await expect(persist([], (sql) => /^LOCK TABLE/.test(sql))).rejects.toThrow();

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });
  });
});
