import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { evaluateLoad } from "@/modules/coverage-loads/sigra-layers/domain/validation";
import { LayerLoadStatus, LayerLoadStep, type LayerLoadResult } from "@/modules/coverage-loads/sigra-layers/types";
import {
  ALL_FINAL_TABLE_GRANTS,
  AUDIT_INSERT,
  AUDIT_UPDATE,
  CONNECTION,
  PAGE_INSERT,
  PASSWORD,
  TestLayer,
  type FailureRule,
  type ScriptedPage,
  auditRows,
  createRig,
  createSigraDatabase,
  fetcherFor,
  finalRows,
  finalTableOf,
  indexOfMatch,
  isAutocommitted,
  limiteCentralFeature,
  manyFeatures,
  resetSigraDatabase,
  seedFinalRows,
  snapshotFinalTables,
  steadyClock,
  swapInsertStatement,
  withSigraRole,
  zonaFeature,
} from "./sigraHarness";

const ZONAS = getSigraLayer(TestLayer.ZONAS);
const ZONAS_TABLE = finalTableOf(TestLayer.ZONAS);

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

const zonaPage = (count = 4, firstKey = 101) => manyFeatures(count, (id) => zonaFeature(id), firstKey);

async function loadZonas(pages: ScriptedPage[], options: { dryRun?: boolean; fail?: FailureRule } = {}) {
  const rig = createRig(database, fetcherFor(TestLayer.ZONAS, ...pages), { clock: steadyClock(), fail: options.fail });
  const result = await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: options.dryRun ?? false });
  return { result, rig };
}

const NO_INSERTED_ROWS = [null, 0];

describe("sigra-layers load audit (AC-7)", () => {
  describe("a successful load", () => {
    it("should write INICIADO and then update the same row to EXITO with the extracted and inserted counts", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });

      // Act
      const { result } = await loadZonas([zonaPage(4)]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, auditWarning: null });
      expect(await auditRows(database)).toEqual([
        {
          id_auditoria: expect.any(Number),
          etl_nombre: ZONAS.etlName,
          estado: "EXITO",
          finished: true,
          registros_extraidos: 4,
          registros_insertados: 4,
          transform_error: null,
          paso_error: null,
          mensaje_error: null,
        },
      ]);
    });

    it("should count the staged rows, not the downloaded features, as extracted", async () => {
      // Arrange
      const features = [zonaFeature(1), zonaFeature(1), zonaFeature(2), zonaFeature(3), zonaFeature(3)];

      // Act
      await loadZonas([features]);

      // Assert
      expect(await auditRows(database)).toMatchObject([{ estado: "EXITO", registros_extraidos: 3, registros_insertados: 3 }]);
    });

    it("should insert the INICIADO row in its own committed statement before the load transaction and update it after the transaction ended", async () => {
      // Arrange & Act
      const { rig } = await loadZonas([zonaPage(4)]);

      // Assert
      const statements = rig.statements();
      const transaction = rig.loadTransaction();
      const insert = indexOfMatch(statements, AUDIT_INSERT);
      const update = indexOfMatch(statements, AUDIT_UPDATE);
      expect(transaction).not.toBeNull();
      expect(insert).toBeGreaterThanOrEqual(0);
      expect(insert).toBeLessThan(transaction?.begin ?? -1);
      expect(isAutocommitted(rig.log, insert)).toBe(true);
      expect(update).toBeGreaterThan(transaction?.end ?? Number.MAX_SAFE_INTEGER);
      expect(statements.filter((statement) => AUDIT_INSERT.test(statement))).toHaveLength(1);
      expect(statements.filter((statement) => AUDIT_UPDATE.test(statement))).toHaveLength(1);
    });

    it("should write one audit row per layer call, each with the etlName of its layer", async () => {
      // Arrange
      const limiteRig = createRig(database, fetcherFor(TestLayer.LIMITE_CENTRAL, manyFeatures(2, (id) => limiteCentralFeature(id))));

      // Act
      await loadZonas([zonaPage(4)]);
      await limiteRig.repository.loadLayer(CONNECTION, TestLayer.LIMITE_CENTRAL, { dryRun: false });

      // Assert
      const rows = await auditRows(database);
      expect(rows.map((row) => [row.etl_nombre, row.estado])).toEqual([
        ["Area_Zonas_FTTH", "EXITO"],
        ["Area_Centrales_FTTH", "EXITO"],
      ]);
    });

    it("should load with a role holding INSERT and UPDATE on the audit table", async () => {
      // Arrange
      const grants = `${ALL_FINAL_TABLE_GRANTS} GRANT SELECT, INSERT, UPDATE ON public.etl_auditoria TO sigra_limited;`;
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        result = (await loadZonas([zonaPage(4)])).result;
      });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, auditWarning: null });
      expect(await auditRows(database)).toMatchObject([{ estado: "EXITO" }]);
    });
  });

  describe("failed and rejected loads", () => {
    it("should record a rejected validation as ERROR with paso_error validacion and the verdict as the message", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });

      // Act
      const { result } = await loadZonas([zonaPage(96, 1000)]);

      // Assert
      const verdict = evaluateLoad({ stagedCount: 96, finalCount: 100 }).message;
      expect(result).toMatchObject({ status: LayerLoadStatus.REJECTED_VALIDATION, auditWarning: null });
      const rows = await auditRows(database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        etl_nombre: ZONAS.etlName,
        estado: "ERROR",
        finished: true,
        registros_extraidos: 96,
        transform_error: TestLayer.ZONAS,
        paso_error: LayerLoadStep.VALIDATION,
        mensaje_error: verdict,
      });
      expect(NO_INSERTED_ROWS).toContain(rows[0].registros_insertados);
    });

    it("should record a WFS failure as ERROR with paso_error wfs and the layer id as transform_error, and keep the row although the transaction rolled back", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      const before = await snapshotFinalTables(database);

      // Act
      const { result, rig } = await loadZonas([manyFeatures(ZONAS.pageSize, (id) => zonaFeature(id), 1), new Error(`timeout ${PASSWORD}`)]);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS });
      expect(rig.loadTransaction()?.statements.at(-1)).toBe("ROLLBACK");
      const rows = await auditRows(database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        etl_nombre: ZONAS.etlName,
        estado: "ERROR",
        finished: true,
        paso_error: LayerLoadStep.WFS,
        transform_error: TestLayer.ZONAS,
        mensaje_error: result.message,
      });
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it.each([
      ["a page INSERT into the staging table", LayerLoadStep.INSERT, { pattern: PAGE_INSERT } satisfies FailureRule],
      ["the swap INSERT into the final table", LayerLoadStep.SWAP, { pattern: swapInsertStatement(ZONAS_TABLE) } satisfies FailureRule],
    ])("should record a failure in %s as ERROR with paso_error %s", async (_label, step, fail) => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });

      // Act
      const { result } = await loadZonas([zonaPage(4)], { fail: { ...fail, error: new Error(`fallo ${PASSWORD}`) } });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step, auditWarning: null });
      const rows = await auditRows(database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ estado: "ERROR", finished: true, paso_error: step, transform_error: TestLayer.ZONAS, mensaje_error: result.message });
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(3);
    });

    it("should update the audit row after the failed transaction ended, never inside it", async () => {
      // Arrange & Act
      const { rig } = await loadZonas([new Error("sin respuesta")]);

      // Assert
      const transaction = rig.loadTransaction();
      expect(transaction?.statements.at(-1)).toBe("ROLLBACK");
      expect(indexOfMatch(rig.statements(), AUDIT_UPDATE)).toBeGreaterThan(transaction?.end ?? Number.MAX_SAFE_INTEGER);
    });
  });

  describe("a dry run", () => {
    it("should write no audit row and issue no audit statement", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });

      // Act
      const { result, rig } = await loadZonas([zonaPage(4)], { dryRun: true });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.DRY_RUN_OK, auditWarning: null });
      expect(await auditRows(database)).toEqual([]);
      expect(rig.statements().filter((statement) => /etl_auditoria/i.test(statement) && /^(INSERT|UPDATE)/i.test(statement))).toEqual([]);
    });

    it("should write no audit row for a dry run that would be rejected or that fails", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });

      // Act
      await loadZonas([zonaPage(10, 1000)], { dryRun: true });
      await loadZonas([new Error("sin respuesta")], { dryRun: true });

      // Assert
      expect(await auditRows(database)).toEqual([]);
    });
  });

  describe("an audit that cannot be used never fails the load", () => {
    it("should load and warn when the audit table does not exist", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      await database.exec("DROP TABLE public.etl_auditoria");

      // Act
      const { result } = await loadZonas([zonaPage(4)]);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      expect(result.auditWarning).toEqual(expect.any(String));
      expect((result.auditWarning ?? "").length).toBeGreaterThan(0);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
    });

    it("should keep reporting a rejected validation and a failure, with a warning, when the audit table does not exist", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });
      await database.exec("DROP TABLE public.etl_auditoria");

      // Act
      const rejected = (await loadZonas([zonaPage(10, 1000)])).result;
      const failed = (await loadZonas([new Error("sin respuesta")])).result;

      // Assert
      expect(rejected).toMatchObject({ status: LayerLoadStatus.REJECTED_VALIDATION, step: LayerLoadStep.VALIDATION });
      expect(failed).toMatchObject({ status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS });
      expect(rejected.auditWarning).toEqual(expect.any(String));
      expect(failed.auditWarning).toEqual(expect.any(String));
    });

    it("should load and warn when INSERT on the audit table is not granted", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      const grants = `${ALL_FINAL_TABLE_GRANTS} GRANT SELECT, UPDATE ON public.etl_auditoria TO sigra_limited;`;
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        result = (await loadZonas([zonaPage(4)])).result;
      });

      // Assert
      expect(result?.status).toBe(LayerLoadStatus.LOADED);
      expect(result?.auditWarning).toEqual(expect.any(String));
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
      expect(await auditRows(database)).toEqual([]);
    });

    it("should load and warn when SELECT on the audit table is not granted (INSERT ... RETURNING needs it)", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      const grants = `${ALL_FINAL_TABLE_GRANTS} GRANT INSERT, UPDATE ON public.etl_auditoria TO sigra_limited;`;
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        result = (await loadZonas([zonaPage(4)])).result;
      });

      // Assert
      expect(result?.status).toBe(LayerLoadStatus.LOADED);
      expect(result?.auditWarning).toEqual(expect.any(String));
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
    });

    it("should load and warn when UPDATE on the audit table is not granted", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      const grants = `${ALL_FINAL_TABLE_GRANTS} GRANT SELECT, INSERT ON public.etl_auditoria TO sigra_limited;`;
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        result = (await loadZonas([zonaPage(4)])).result;
      });

      // Assert
      expect(result?.status).toBe(LayerLoadStatus.LOADED);
      expect(result?.auditWarning).toEqual(expect.any(String));
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
    });

    it("should keep the result of a committed load and warn when the closing UPDATE fails", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });

      // Act
      const { result } = await loadZonas([zonaPage(4)], { fail: { pattern: AUDIT_UPDATE, error: new Error(`update roto ${PASSWORD}`) } });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, step: null, downloaded: 4, staged: 4, previousCount: 3, finalCount: 4 });
      expect(result.auditWarning).toEqual(expect.any(String));
      expect(result.auditWarning).not.toContain(PASSWORD);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
      expect(await auditRows(database)).toMatchObject([{ estado: "INICIADO", finished: false }]);
    });

    it("should keep the failed status of a failed load and warn when the closing UPDATE fails", async () => {
      // Arrange & Act
      const { result } = await loadZonas([new Error("sin respuesta")], { fail: { pattern: AUDIT_UPDATE } });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS });
      expect(result.auditWarning).toEqual(expect.any(String));
    });

    it("should load, warn and issue no UPDATE when the opening INSERT fails", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });

      // Act
      const { result, rig } = await loadZonas([zonaPage(4)], { fail: { pattern: AUDIT_INSERT, error: new Error(`insert roto ${PASSWORD}`) } });

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      expect(result.auditWarning).toEqual(expect.any(String));
      expect(result.auditWarning).not.toContain(PASSWORD);
      expect(rig.statements().filter((statement) => AUDIT_UPDATE.test(statement))).toEqual([]);
      expect(await auditRows(database)).toEqual([]);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
    });
  });
});
