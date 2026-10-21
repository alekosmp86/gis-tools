import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { evaluateLoad } from "@/modules/coverage-loads/sigra-layers/domain/validation";
import { LayerLoadStatus, type LayerLoadResult } from "@/modules/coverage-loads/sigra-layers/types";
import type { WfsFeature } from "@/modules/coverage-loads/sigra-layers/types";
import {
  CONNECTION,
  TestLayer,
  type StoredRow,
  type TestLayerId,
  cableFtthFeature,
  cajitasFeature,
  centralFtthFeature,
  createRig,
  createSigraDatabase,
  fetcherFor,
  finalRows,
  finalTableOf,
  limiteCentralFeature,
  manyFeatures,
  nextGid,
  posteFeature,
  resetSigraDatabase,
  seedFinalRows,
  snapshotFinalTables,
  steadyClock,
  storedGeometry,
  tfoFeature,
  todayText,
  zonaFeature,
} from "./sigraHarness";

let database: PGlite;

beforeAll(async () => {
  database = await createSigraDatabase();
}, 60000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetSigraDatabase(database);
});

async function load(layerId: TestLayerId, pages: ReadonlyArray<ReadonlyArray<WfsFeature>>, dryRun = false) {
  const fetcher = fetcherFor(layerId, ...pages);
  const rig = createRig(database, fetcher, { clock: steadyClock() });
  const result = await rig.repository.loadLayer(CONNECTION, layerId, { dryRun });
  return { result, rig, fetcher };
}

const byKey = (rows: StoredRow[], column: string, key: number): StoredRow => {
  const row = rows.find((candidate) => candidate[column] === key);
  if (!row) throw new Error(`No row with ${column}=${key}`);
  return row;
};

const keysOf = (rows: StoredRow[], column: string): number[] => rows.map((row) => Number(row[column])).sort((a, b) => a - b);

describe("sigra-layers loadLayer result and data (AC-4, AC-6, AC-9)", () => {
  describe("zonas-ftth full replacement", () => {
    it("should replace the old rows with the downloaded ones and report every count of the result", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      const features = [101, 102, 103, 104].map((id) => zonaFeature(id));

      // Act
      const { result } = await load(TestLayer.ZONAS, [features]);

      // Assert
      expect(result).toEqual<LayerLoadResult>({
        layerId: TestLayer.ZONAS,
        status: LayerLoadStatus.LOADED,
        downloaded: 4,
        staged: 4,
        duplicatesIgnored: 0,
        previousCount: 3,
        finalCount: 4,
        elapsedMs: 750,
        step: null,
        message: expect.any(String),
        auditWarning: null,
      });
      expect(result.message.length).toBeGreaterThan(0);
      expect(keysOf(await finalRows(database, TestLayer.ZONAS), "id_distrito")).toEqual([101, 102, 103, 104]);
    });

    it("should write the mapped columns, the derived zona columns, fuente, fechaact and the geometry with SRID 31981", async () => {
      // Arrange
      const feature = zonaFeature(101);

      // Act
      await load(TestLayer.ZONAS, [[feature]]);

      // Assert
      const row = (await finalRows(database, TestLayer.ZONAS))[0];
      expect(row).toMatchObject({
        id_distrito: 101,
        edificio: "ABCDEFGHIJ",
        identificacion_de_la_central: "ABCDEFGHIJKLM",
        codigo_distrito: "C009Z04",
        nombre_central: "AGUADA FTTH",
        cable: "009",
        zona: "04",
        conca: "AGUADAC09ZONA 04",
        situacion_distrito: "Existente",
        id_terminalfibraoptica: "EMP-101",
        codigo_terminalfibraoptica: "CEMP-101",
        situacion_geom: "Valida",
        fuente: "SIGRA/WFS",
        fechaact: await todayText(database),
        geom: storedGeometry(feature),
      });
    });

    it("should leave the final columns the spec does not list (x, txt_geometria) NULL", async () => {
      // Arrange & Act
      await load(TestLayer.ZONAS, [[zonaFeature(101)]]);

      // Assert
      expect((await finalRows(database, TestLayer.ZONAS))[0]).toMatchObject({ x: null, txt_geometria: null });
    });

    it("should regenerate gid from the final table sequence without burning values in the staging table", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      const lastUsed = await nextGid(database, TestLayer.ZONAS);

      // Act
      await load(TestLayer.ZONAS, [[zonaFeature(101), zonaFeature(102), zonaFeature(103)]]);

      // Assert
      const gids = keysOf(await finalRows(database, TestLayer.ZONAS), "gid");
      expect(gids).toEqual([lastUsed + 1, lastUsed + 2, lastUsed + 3]);
    });

    it("should not require the old rows to share anything with the new ones", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 5, firstKey: 1 });

      // Act
      const { result } = await load(TestLayer.ZONAS, [manyFeatures(5, (id) => zonaFeature(id), 1000)]);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      expect(keysOf(await finalRows(database, TestLayer.ZONAS), "id_distrito")).toEqual([1000, 1001, 1002, 1003, 1004]);
    });

    it("should write NULL for a missing property and for a feature without geometry, and still load the feature", async () => {
      // Arrange
      const feature = zonaFeature(101, { SITUACION: undefined, CODIGO_AREA: undefined }, null);

      // Act
      const { result } = await load(TestLayer.ZONAS, [[feature]]);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      expect((await finalRows(database, TestLayer.ZONAS))[0]).toMatchObject({
        id_distrito: 101,
        situacion_distrito: null,
        codigo_distrito: null,
        cable: null,
        zona: null,
        conca: "AGUADACZONA ",
        geom: null,
      });
    });

    it("should store quotes, SQL fragments and accents in a value verbatim", async () => {
      // Arrange
      const nasty = `O'Brien "Ñandú"; DROP TABLE public.area_zonas_ftth_f; --`;

      // Act
      const { result } = await load(TestLayer.ZONAS, [[zonaFeature(101, { CENTRAL_NOMBRE: nasty, SITUACION: nasty })]]);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      expect((await finalRows(database, TestLayer.ZONAS))[0]).toMatchObject({ nombre_central: nasty, situacion_distrito: nasty });
    });
  });

  describe("pages and duplicates", () => {
    it("should read a second page when the first one is full and count both pages as downloaded", async () => {
      // Arrange
      const pageSize = getSigraLayer(TestLayer.ZONAS).pageSize;
      const first = manyFeatures(pageSize, (id) => zonaFeature(id), 1);
      const second = manyFeatures(5, (id) => zonaFeature(id), pageSize + 1);

      // Act
      const { result, fetcher } = await load(TestLayer.ZONAS, [first, second]);

      // Assert
      expect(fetcher.startIndexes).toEqual([0, pageSize]);
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, downloaded: pageSize + 5, staged: pageSize + 5, duplicatesIgnored: 0 });
      expect(result.finalCount).toBe(pageSize + 5);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(pageSize + 5);
    });

    it("should stop at a short first page and request nothing more", async () => {
      // Arrange & Act
      const { fetcher } = await load(TestLayer.ZONAS, [manyFeatures(3, (id) => zonaFeature(id))]);

      // Assert
      expect(fetcher.startIndexes).toEqual([0]);
    });

    it("should accept a full page followed by an empty one", async () => {
      // Arrange
      const pageSize = getSigraLayer(TestLayer.ZONAS).pageSize;

      // Act
      const { result, fetcher } = await load(TestLayer.ZONAS, [manyFeatures(pageSize, (id) => zonaFeature(id)), []]);

      // Assert
      expect(fetcher.startIndexes).toEqual([0, pageSize]);
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, downloaded: pageSize, staged: pageSize });
    });

    it("should ignore a repeated key inside a page, keep the first feature and count it as a duplicate", async () => {
      // Arrange
      const features = [zonaFeature(7, { CENTRAL_NOMBRE: "PRIMERA FTTH" }), zonaFeature(7, { CENTRAL_NOMBRE: "SEGUNDA FTTH" }), zonaFeature(8)];

      // Act
      const { result } = await load(TestLayer.ZONAS, [features]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, downloaded: 3, staged: 2, duplicatesIgnored: 1, finalCount: 2 });
      const rows = await finalRows(database, TestLayer.ZONAS);
      expect(keysOf(rows, "id_distrito")).toEqual([7, 8]);
      expect(byKey(rows, "id_distrito", 7).nombre_central).toBe("PRIMERA FTTH");
    });

    it("should ignore a key repeated on a later page", async () => {
      // Arrange
      const pageSize = getSigraLayer(TestLayer.ZONAS).pageSize;
      const first = manyFeatures(pageSize, (id) => zonaFeature(id), 1);
      const second = [zonaFeature(5), zonaFeature(pageSize + 100)];

      // Act
      const { result } = await load(TestLayer.ZONAS, [first, second]);

      // Assert
      expect(result).toMatchObject({ downloaded: pageSize + 2, staged: pageSize + 1, duplicatesIgnored: 1, finalCount: pageSize + 1 });
    });
  });

  describe("validation 97% rule (AC-5 as seen by AC-9)", () => {
    it("should accept exactly 97 of 100 (the boundary)", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });

      // Act
      const { result } = await load(TestLayer.ZONAS, [manyFeatures(97, (id) => zonaFeature(id), 1000)]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, staged: 97, previousCount: 100, finalCount: 97, step: null });
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(97);
    });

    it("should reject 96 of 100, name both counts and leave the final table untouched", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });
      const before = await snapshotFinalTables(database);

      // Act
      const { result } = await load(TestLayer.ZONAS, [manyFeatures(96, (id) => zonaFeature(id), 1000)]);

      // Assert
      expect(result).toMatchObject({
        status: LayerLoadStatus.REJECTED_VALIDATION,
        step: "validacion",
        downloaded: 96,
        staged: 96,
        previousCount: 100,
        message: evaluateLoad({ stagedCount: 96, finalCount: 100 }).message,
      });
      expect(result.message).toContain("96");
      expect(result.message).toContain("100");
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should accept more rows than before", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 10 });

      // Act
      const { result } = await load(TestLayer.ZONAS, [manyFeatures(15, (id) => zonaFeature(id), 1000)]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, previousCount: 10, finalCount: 15 });
    });

    it("should accept any count, including a single feature, when the final table is empty", async () => {
      // Arrange & Act
      const { result } = await load(TestLayer.ZONAS, [[zonaFeature(1)]]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, previousCount: 0, finalCount: 1 });
    });

    it("should accept zero downloaded features when the final table is empty", async () => {
      // Arrange & Act
      const { result } = await load(TestLayer.ZONAS, [[]]);

      // Assert
      expect(result).toMatchObject({
        status: LayerLoadStatus.LOADED,
        downloaded: 0,
        staged: 0,
        duplicatesIgnored: 0,
        previousCount: 0,
        finalCount: 0,
        step: null,
      });
    });

    it("should reject zero downloaded features when the final table has rows, and keep them", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 5 });
      const before = await snapshotFinalTables(database);

      // Act
      const { result } = await load(TestLayer.ZONAS, [[]]);

      // Assert
      expect(result).toMatchObject({
        status: LayerLoadStatus.REJECTED_VALIDATION,
        step: "validacion",
        downloaded: 0,
        staged: 0,
        previousCount: 5,
        message: evaluateLoad({ stagedCount: 0, finalCount: 5 }).message,
      });
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should compare the distinct staged rows, not the downloaded features", async () => {
      // Arrange: 100 downloaded but only 50 distinct keys against 100 rows
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });
      const features = [...manyFeatures(50, (id) => zonaFeature(id), 1000), ...manyFeatures(50, (id) => zonaFeature(id), 1000)];

      // Act
      const { result } = await load(TestLayer.ZONAS, [features]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.REJECTED_VALIDATION, downloaded: 100, staged: 50, duplicatesIgnored: 50 });
    });
  });

  describe("per-layer columns", () => {
    it("should load limite-central-ftth with area_m2 from the geometry, codigo_sitio from EDIFICIO and the central name column", async () => {
      // Arrange
      const feature = limiteCentralFeature(11);

      // Act
      const { result } = await load(TestLayer.LIMITE_CENTRAL, [[feature]]);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      const row = (await finalRows(database, TestLayer.LIMITE_CENTRAL))[0];
      const geom = storedGeometry(feature) as string;
      expect(row).toMatchObject({
        id_area: 11,
        edificio: "EDIF1234",
        id_sitio: 511,
        codigo_sitio: "EDIF1234",
        nombre_central_ftth: "AGUADA FTTH",
        cr_site_ty: 9,
        fuente: "SIGRA/WFS",
        direccion: null,
        geom,
      });
      expect(row.area_m2 as number).toBeCloseTo(geom.length + 0.12365, 5);
      expect(String(row.fechaact).startsWith(await todayText(database))).toBe(true);
    });

    it("should round area_m2 of area-cable-ftth to 3 decimals (rounding, not truncation)", async () => {
      // Arrange
      const feature = cableFtthFeature(21);

      // Act
      await load(TestLayer.CABLE_FTTH, [[feature]]);

      // Assert
      const row = (await finalRows(database, TestLayer.CABLE_FTTH))[0];
      const geom = storedGeometry(feature) as string;
      expect(row.area_m2).toBe(Number(`${geom.length}.124`));
      expect(row).toMatchObject({
        id_area: 21,
        edificio: "ED1",
        identificacion_central: "IDC",
        nombre_central: "CENTRAL X",
        codigo: "COD",
        situacion: "Existente",
        tipo_area: "Primaria",
        fuente: "SIGRA/WFS",
        txt_geometria: null,
        geom,
      });
    });

    it("should load area-cajitas-cobre into its `geometry` column, with no fuente column to write", async () => {
      // Arrange
      const feature = cajitasFeature(31);

      // Act
      const { result } = await load(TestLayer.CAJITAS, [[feature]]);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      const row = (await finalRows(database, TestLayer.CAJITAS))[0];
      expect(row).toMatchObject({
        id_area: 31,
        codigo_area: "CA-31",
        central_nombre: "AGUADA",
        edificio: "ED2",
        situacion: "Existente",
        id_cajita: 731,
        codigo_cajita: "CJ-31",
        caja_de_distribucion: "CD-1",
        geometry: storedGeometry(feature),
      });
      expect(row).not.toHaveProperty("fuente");
      expect(String(row.fechaact)).toBe(await todayText(database));
    });

    it("should load tfo-divisores deduplicated by spid, with fechacarga instead of fechaact and no spid column", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.TFO, { count: 2 });
      const features = [tfoFeature(1, "PRIMERO"), tfoFeature(1, "REPETIDO"), tfoFeature(2, "SEGUNDO")];

      // Act
      const { result } = await load(TestLayer.TFO, [features]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, downloaded: 3, staged: 2, duplicatesIgnored: 1, previousCount: 2, finalCount: 2 });
      const rows = await finalRows(database, TestLayer.TFO);
      expect(rows.map((row) => row.id_terminalfibra).sort()).toEqual(["PRIMERO", "SEGUNDO"]);
      expect(rows[0]).not.toHaveProperty("spid");
      expect(rows[0]).not.toHaveProperty("fechaact");
      expect(rows.find((row) => row.id_terminalfibra === "PRIMERO")).toMatchObject({
        edificio_terminalfibra: "TED",
        cable_terminalfibra: "009",
        zona_terminalfibra: "04",
        codigo_terminalfibra: "T-009-04",
        situacion_terminalfibra: "Instalado",
        observacion: "sin observaciones",
        codigo_divisoroptico: "DIV-1",
        situacion_divisoroptico: "Activo",
        fuente: "SIGRA/WFS",
        fechacarga: await todayText(database),
        geom: storedGeometry(features[0]),
      });
    });

    it("should load centrales-ftth leaving edificio and every unlisted column NULL", async () => {
      // Arrange
      const feature = centralFtthFeature(41);

      // Act
      await load(TestLayer.CENTRALES, [[feature]]);

      // Assert
      expect((await finalRows(database, TestLayer.CENTRALES))[0]).toMatchObject({
        id_sitio: 41,
        codigo_sitio: "EDIF-C",
        nombre_central_ftth: "CENTRO FTTH",
        rotation: 12.5,
        tipo_de_central: "CENTRAL FTTH",
        fuente: "SIGRA/WFS",
        edificio: null,
        direccion: null,
        departamento: null,
        localidad: null,
        x: null,
        y: null,
        status: null,
        geom: storedGeometry(feature),
      });
    });

    it("should load postes with latitud and longitud taken from the geometry transformed to 4326", async () => {
      // Arrange
      const feature = posteFeature(51);

      // Act
      await load(TestLayer.POSTES, [[feature]]);

      // Assert
      const row = (await finalRows(database, TestLayer.POSTES))[0];
      const transformed = `T4326:${storedGeometry(feature)}`;
      expect(row).toMatchObject({
        id_sgra: 51,
        tipo: "Hormigon",
        codigo_sga: "P-51",
        altura: 9.5,
        material: "Hormigon",
        situacion: "Existente",
        perforada: "SI",
        base_hormigonada: "true",
        rotation: 45,
        fuente: "SIGRA/WFS",
        direccion: null,
        geom: storedGeometry(feature),
      });
      expect(row.latitud as number).toBeCloseTo(transformed.length + 0.25, 5);
      expect(row.longitud as number).toBeCloseTo(transformed.length + 0.5, 5);
    });

    it.each([
      [TestLayer.ZONAS, (id: number) => zonaFeature(id)],
      [TestLayer.LIMITE_CENTRAL, (id: number) => limiteCentralFeature(id)],
      [TestLayer.CABLE_FTTH, (id: number) => cableFtthFeature(id)],
      [TestLayer.CAJITAS, (id: number) => cajitasFeature(id)],
      [TestLayer.TFO, (id: number) => tfoFeature(id, `TFO-${id}`)],
      [TestLayer.CENTRALES, (id: number) => centralFtthFeature(id)],
      [TestLayer.POSTES, (id: number) => posteFeature(id)],
    ])("should replace the whole of %s end to end", async (layerId, build) => {
      // Arrange
      await seedFinalRows(database, layerId, { count: 4 });

      // Act
      const { result } = await load(layerId, [manyFeatures(5, build, 100)]);

      // Assert
      expect(result).toMatchObject({ layerId, status: LayerLoadStatus.LOADED, downloaded: 5, staged: 5, previousCount: 4, finalCount: 5 });
      expect(await finalRows(database, layerId)).toHaveLength(5);
      expect(finalTableOf(layerId)).toBe(getSigraLayer(layerId).finalTable);
    });
  });

  describe("elapsed time", () => {
    it("should measure elapsedMs with the injected clock", async () => {
      // Arrange
      const readings = [5000, 5750];
      const fetcher = fetcherFor(TestLayer.ZONAS, [zonaFeature(1)]);
      const rig = createRig(database, fetcher, { clock: () => readings.shift() ?? 5750 });

      // Act
      const result = await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });

      // Assert
      expect(result.elapsedMs).toBe(750);
    });
  });
});
