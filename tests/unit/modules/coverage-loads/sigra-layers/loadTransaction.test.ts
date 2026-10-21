import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { evaluateLoad } from "@/modules/coverage-loads/sigra-layers/domain/validation";
import {
  LayerLoadStatus,
  LayerLoadStep,
  type LayerLoadResult,
  type WfsFeature,
  type WfsPage,
  type WfsPageFetcher,
} from "@/modules/coverage-loads/sigra-layers/types";
import {
  ALL_FINAL_TABLE_GRANTS,
  ANY_LOCK,
  ANY_SHARE_ROW_EXCLUSIVE,
  AUDIT_GRANTS,
  auditRows,
  CONNECTION,
  PAGE_INSERT,
  PASSWORD,
  ScriptedFetcher,
  TestLayer,
  type FailureRule,
  type Rig,
  type ScriptedPage,
  createRig,
  createSigraDatabase,
  deleteStatement,
  fetcherFor,
  finalRows,
  finalTableOf,
  indexOfMatch,
  lastIndexOfMatch,
  limiteCentralFeature,
  lockStatement,
  manyFeatures,
  nextGid,
  posteFeature,
  resetSigraDatabase,
  revokeTempPrivilege,
  seedFinalRows,
  snapshotFinalTables,
  steadyClock,
  swapInsertStatement,
  temporaryTableCount,
  tfoFeature,
  withSigraRole,
  zonaFeature,
} from "./sigraHarness";

const ZONAS_TABLE = finalTableOf(TestLayer.ZONAS);
const ZONAS_PAGE_SIZE = getSigraLayer(TestLayer.ZONAS).pageSize;

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

/** Old content in three layers, so a test can see that only the loaded one changes. */
async function seedOldWorld(): Promise<void> {
  await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
  await seedFinalRows(database, TestLayer.LIMITE_CENTRAL, { count: 2 });
  await seedFinalRows(database, TestLayer.POSTES, { count: 2 });
}

const zonaPage = (count = 4, firstKey = 101) => manyFeatures(count, (id) => zonaFeature(id), firstKey);

async function loadZonas(pages: ScriptedPage[], dryRun: boolean, options: { fail?: FailureRule } = {}) {
  const fetcher = fetcherFor(TestLayer.ZONAS, ...pages);
  const rig = createRig(database, fetcher, { clock: steadyClock(), ...options });
  const result = await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun });
  return { result, rig, fetcher };
}

const transactionOf = (rig: Rig) => {
  const transaction = rig.loadTransaction();
  if (!transaction) throw new Error("No load transaction was recorded");
  return transaction;
};

const FORBIDDEN_CREATE = /^\s*CREATE\b(?!\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE\b)(?!\s+(UNIQUE\s+)?INDEX\b)/i;

describe("sigra-layers load transaction (D1, D2, D5, AC-4, AC-6, AC-8)", () => {
  describe("statement sequence of a real load", () => {
    it("should run BEGIN, the SET LOCAL timeouts, the TEMP staging table, the page inserts, the lock, the DELETE, the swap INSERT and COMMIT in that order", async () => {
      // Arrange
      await seedOldWorld();

      // Act
      const { rig } = await loadZonas([zonaPage(4)], false);

      // Assert
      const statements = transactionOf(rig).statements;
      const setLocal = indexOfMatch(statements, /^SET LOCAL\s+\w*timeout/i);
      const create = indexOfMatch(statements, /^CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE/i);
      const firstPage = indexOfMatch(statements, PAGE_INSERT);
      const lastPage = lastIndexOfMatch(statements, PAGE_INSERT);
      const lock = indexOfMatch(statements, lockStatement(ZONAS_TABLE));
      const remove = indexOfMatch(statements, deleteStatement(ZONAS_TABLE));
      const swap = indexOfMatch(statements, swapInsertStatement(ZONAS_TABLE));
      expect(statements[0]).toMatch(/^BEGIN/i);
      expect(statements.at(-1)).toBe("COMMIT");
      expect(setLocal).toBeGreaterThan(0);
      expect(create).toBeGreaterThan(setLocal);
      expect(firstPage).toBeGreaterThan(create);
      expect(lock).toBeGreaterThan(lastPage);
      expect(remove).toBeGreaterThan(lock);
      expect(swap).toBeGreaterThan(remove);
      expect(statements.length - 1).toBeGreaterThan(swap);
    });

    it("should take the lock only once, only on the final table and only after the last page was inserted (the downloads happen without it)", async () => {
      // Arrange
      await seedOldWorld();
      const pages = [manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 1), zonaPage(3, ZONAS_PAGE_SIZE + 1)];

      // Act
      const { rig } = await loadZonas(pages, false);

      // Assert
      const statements = transactionOf(rig).statements;
      const locks = statements.filter((statement) => ANY_LOCK.test(statement));
      expect(locks).toHaveLength(1);
      expect(locks[0]).toMatch(lockStatement(ZONAS_TABLE));
      expect(statements.indexOf(locks[0])).toBeGreaterThan(lastIndexOfMatch(statements, PAGE_INSERT));
      expect(statements.filter((statement) => PAGE_INSERT.test(statement)).length).toBeGreaterThanOrEqual(2);
    });

    it("should use DELETE FROM and never TRUNCATE, ACCESS EXCLUSIVE, nor the legacy incoming_sgra_ tables, in any statement", async () => {
      // Arrange
      await seedOldWorld();

      // Act
      const { rig } = await loadZonas([zonaPage()], false);

      // Assert
      const statements = rig.statements();
      expect(statements.filter((statement) => /TRUNCATE|ACCESS\s+EXCLUSIVE/i.test(statement))).toEqual([]);
      expect(statements.filter((statement) => /incoming_sgra_/i.test(statement))).toEqual([]);
      expect(statements.some((statement) => deleteStatement(ZONAS_TABLE).test(statement))).toBe(true);
      expect(statements.filter((statement) => ANY_LOCK.test(statement)).every((statement) => ANY_SHARE_ROW_EXCLUSIVE.test(statement))).toBe(true);
    });

    it("should create nothing but a TEMP table and indexes on it, and drop nothing", async () => {
      // Arrange & Act
      const { rig } = await loadZonas([zonaPage()], false);

      // Assert
      const statements = rig.statements();
      expect(statements.filter((statement) => FORBIDDEN_CREATE.test(statement))).toEqual([]);
      expect(statements.filter((statement) => /^\s*(DROP|ALTER)\b/i.test(statement))).toEqual([]);
      expect(await database.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'incoming_sgra_%'")).toMatchObject({ rows: [] });
    });

    it("should build the staging table ON COMMIT DROP, without defaults or the gid column, with a UNIQUE index on the key column", async () => {
      // Arrange & Act
      const { rig } = await loadZonas([zonaPage()], false);

      // Assert
      const statements = transactionOf(rig).statements;
      const create = indexOfMatch(statements, /^CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE/i);
      const unique = indexOfMatch(statements, /UNIQUE/i);
      expect(statements[create]).toMatch(/ON COMMIT DROP/i);
      expect(statements[create]).not.toMatch(/INCLUDING\s+(DEFAULTS|ALL|IDENTITY)|\bDEFAULT\b|nextval|serial/i);
      expect(statements[create]).not.toMatch(/\bgid\b/i);
      expect(unique).toBeGreaterThanOrEqual(create);
      expect(unique).toBeLessThan(indexOfMatch(statements, PAGE_INSERT));
      expect(statements[unique]).toMatch(/\(\s*"?id_distrito"?\s*\)/);
    });

    it("should give the tfo-divisores staging table its extra spid column and keep spid out of the swap INSERT", async () => {
      // Arrange
      const fetcher = fetcherFor(TestLayer.TFO, [tfoFeature(1, "A"), tfoFeature(2, "B")]);
      const rig = createRig(database, fetcher);

      // Act
      await rig.repository.loadLayer(CONNECTION, TestLayer.TFO, { dryRun: false });

      // Assert
      const statements = transactionOf(rig).statements;
      const create = indexOfMatch(statements, /^CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE/i);
      const unique = statements.find((statement) => /UNIQUE/i.test(statement)) ?? "";
      const swap = statements[indexOfMatch(statements, swapInsertStatement(finalTableOf(TestLayer.TFO)))];
      const stagingSetup = statements.slice(create, indexOfMatch(statements, PAGE_INSERT));
      expect(stagingSetup.some((statement) => /\bspid\b/i.test(statement))).toBe(true);
      expect(unique).toMatch(/\(\s*"?spid"?\s*\)/);
      expect(swap).not.toMatch(/\bspid\b/i);
      expect(swap).toMatch(/fechacarga/i);
    });

    it("should send feature values and the GeoJSON text as bind parameters, never inside the SQL text", async () => {
      // Arrange
      const geometry = { type: "Polygon", coordinates: [[[123456.789, 654321.987], [123457.789, 654321.987], [123456.789, 654322.987], [123456.789, 654321.987]]] };
      const feature = zonaFeature(101, { EDIFICIO: "UNICO-VALOR-ñ-777", CENTRAL_NOMBRE: "NOMBRE-UNICO-999 FTTH" }, geometry);

      // Act
      const { rig } = await loadZonas([[feature]], false);

      // Assert
      const forbidden = ["UNICO-VALOR", "NOMBRE-UNICO", "123456.789", "654321.987", "coordinates", "Polygon"];
      for (const entry of rig.log) {
        for (const fragment of forbidden) expect(entry.sql).not.toContain(fragment);
      }
      const bound = JSON.stringify(rig.log.map((entry) => entry.values));
      for (const fragment of ["UNICO-VALOR-ñ-777", "NOMBRE-UNICO-999 FTTH", "123456.789", "Polygon"]) {
        expect(bound).toContain(fragment);
      }
    });

    it("should leave no TEMP table behind and close every connection it opened", async () => {
      // Arrange & Act
      const { rig } = await loadZonas([zonaPage()], false);

      // Assert
      expect(await temporaryTableCount(database)).toBe(0);
      expect(rig.clients.length).toBeGreaterThanOrEqual(1);
      for (const client of rig.clients) expect(client.endCount).toBe(client.connectCount);
    });

    it("should change only the loaded layer's table", async () => {
      // Arrange
      await seedOldWorld();
      const before = await snapshotFinalTables(database);

      // Act
      await loadZonas([zonaPage()], false);

      // Assert
      const after = await snapshotFinalTables(database);
      expect(after[ZONAS_TABLE]).not.toEqual(before[ZONAS_TABLE]);
      expect({ ...after, [ZONAS_TABLE]: [] }).toEqual({ ...before, [ZONAS_TABLE]: [] });
    });

    it("should load with a role holding only SELECT, INSERT, DELETE and sequence USAGE (no TRUNCATE right)", async () => {
      // Arrange
      await seedOldWorld();
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, ALL_FINAL_TABLE_GRANTS + AUDIT_GRANTS, async () => {
        result = (await loadZonas([zonaPage()], false)).result;
      });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, finalCount: 4, auditWarning: null });
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
    });
  });

  describe("a dry run (D5)", () => {
    it("should run the same path and report the counts, but change nothing", async () => {
      // Arrange
      await seedOldWorld();
      const before = await snapshotFinalTables(database);

      // Act
      const { result } = await loadZonas([zonaPage(4)], true);

      // Assert
      expect(result).toMatchObject({
        layerId: TestLayer.ZONAS,
        status: LayerLoadStatus.DRY_RUN_OK,
        downloaded: 4,
        staged: 4,
        duplicatesIgnored: 0,
        previousCount: 3,
        step: null,
        auditWarning: null,
        elapsedMs: 750,
      });
      expect(result.message.length).toBeGreaterThan(0);
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should end the load transaction with ROLLBACK, never COMMIT, and take no lock, DELETE or swap INSERT on the final table", async () => {
      // Arrange
      await seedOldWorld();

      // Act
      const { rig } = await loadZonas([zonaPage(4)], true);

      // Assert
      const statements = rig.statements();
      expect(transactionOf(rig).statements.at(-1)).toBe("ROLLBACK");
      expect(statements.filter((statement) => /^COMMIT/i.test(statement))).toEqual([]);
      expect(statements.filter((statement) => ANY_LOCK.test(statement))).toEqual([]);
      expect(statements.filter((statement) => deleteStatement(ZONAS_TABLE).test(statement))).toEqual([]);
      expect(statements.filter((statement) => swapInsertStatement(ZONAS_TABLE).test(statement))).toEqual([]);
      expect(statements.some((statement) => PAGE_INSERT.test(statement))).toBe(true);
    });

    it("should not advance the gid sequence of the final table", async () => {
      // Arrange
      await seedOldWorld();
      const before = await nextGid(database, TestLayer.ZONAS);

      // Act
      await loadZonas([zonaPage(4)], true);

      // Assert
      expect(await nextGid(database, TestLayer.ZONAS)).toBe(before + 1);
    });

    it("should leave no TEMP table behind", async () => {
      // Arrange & Act
      await loadZonas([zonaPage()], true);

      // Assert
      expect(await temporaryTableCount(database)).toBe(0);
    });

    it("should still report rejected-validation when the dry run would have been rejected", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });
      const before = await snapshotFinalTables(database);

      // Act
      const { result } = await loadZonas([zonaPage(96, 1000)], true);

      // Assert
      expect(result).toMatchObject({
        status: LayerLoadStatus.REJECTED_VALIDATION,
        step: LayerLoadStep.VALIDATION,
        message: evaluateLoad({ stagedCount: 96, finalCount: 100 }).message,
      });
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should report dry-run-ok for an empty final table", async () => {
      // Arrange & Act
      const { result } = await loadZonas([zonaPage(2)], true);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.DRY_RUN_OK, previousCount: 0, staged: 2 });
    });

    it("should report a WFS failure as failed, like a real load", async () => {
      // Arrange
      await seedOldWorld();

      // Act
      const { result } = await loadZonas([new Error("sin respuesta")], true);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS });
    });
  });

  describe("a rejected validation (AC-5, AC-6)", () => {
    it("should roll back, take no lock, not advance the sequence and leave the table byte-identical", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 100 });
      const before = await snapshotFinalTables(database);
      const gidBefore = await nextGid(database, TestLayer.ZONAS);

      // Act
      const { result, rig } = await loadZonas([zonaPage(10, 1000)], false);

      // Assert
      expect(result.status).toBe(LayerLoadStatus.REJECTED_VALIDATION);
      expect(transactionOf(rig).statements.at(-1)).toBe("ROLLBACK");
      expect(rig.statements().filter((statement) => ANY_LOCK.test(statement))).toEqual([]);
      expect(rig.statements().filter((statement) => deleteStatement(ZONAS_TABLE).test(statement))).toEqual([]);
      expect(await snapshotFinalTables(database)).toEqual(before);
      expect(await nextGid(database, TestLayer.ZONAS)).toBe(gidBefore + 1);
      expect(await temporaryTableCount(database)).toBe(0);
    });
  });

  describe("failures roll the layer back (AC-8)", () => {
    const SECRET_ERROR = new Error(`fallo inesperado con ${PASSWORD}`);

    const FAILURES: ReadonlyArray<{
      readonly label: string;
      readonly step: string;
      readonly pages: () => ScriptedPage[];
      readonly fail?: FailureRule;
      readonly lockExpected: boolean;
    }> = [
      { label: "the WFS fails on the first page", step: LayerLoadStep.WFS, pages: () => [SECRET_ERROR], lockExpected: false },
      {
        label: "the WFS fails on the second page, after the first one was staged",
        step: LayerLoadStep.WFS,
        pages: () => [manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 1), SECRET_ERROR],
        lockExpected: false,
      },
      {
        label: "a page INSERT into the staging table fails",
        step: LayerLoadStep.INSERT,
        pages: () => [zonaPage(4)],
        fail: { pattern: PAGE_INSERT, error: SECRET_ERROR },
        lockExpected: false,
      },
      {
        label: "the LOCK TABLE fails",
        step: LayerLoadStep.SWAP,
        pages: () => [zonaPage(4)],
        fail: { pattern: lockStatement(ZONAS_TABLE), error: SECRET_ERROR },
        lockExpected: true,
      },
      {
        label: "the DELETE of the final table fails",
        step: LayerLoadStep.SWAP,
        pages: () => [zonaPage(4)],
        fail: { pattern: deleteStatement(ZONAS_TABLE), error: SECRET_ERROR },
        lockExpected: true,
      },
      {
        label: "the swap INSERT fails after the DELETE ran",
        step: LayerLoadStep.SWAP,
        pages: () => [zonaPage(4)],
        fail: { pattern: swapInsertStatement(ZONAS_TABLE), error: SECRET_ERROR },
        lockExpected: true,
      },
    ];

    it.each(FAILURES)("should return failed with the right step and roll back when $label", async ({ step, pages, fail, lockExpected }) => {
      // Arrange
      await seedOldWorld();
      const before = await snapshotFinalTables(database);

      // Act
      const { result, rig } = await loadZonas(pages(), false, { fail });

      // Assert
      expect(result.status).toBe(LayerLoadStatus.FAILED);
      expect(result.step).toBe(step);
      expect(result.layerId).toBe(TestLayer.ZONAS);
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).not.toContain(PASSWORD);
      expect(typeof result.elapsedMs).toBe("number");
      const transaction = transactionOf(rig);
      expect(transaction.statements.at(-1)).toBe("ROLLBACK");
      expect(transaction.statements.filter((statement) => /^COMMIT/i.test(statement))).toEqual([]);
      expect(rig.statements().some((statement) => ANY_LOCK.test(statement))).toBe(lockExpected);
      expect(await snapshotFinalTables(database)).toEqual(before);
      expect(await temporaryTableCount(database)).toBe(0);
      for (const client of rig.clients) expect(client.endCount).toBe(client.connectCount);
    });

    it("should fail at the swap step and roll back when the rows inserted into the final table are fewer than the staged rows", async () => {
      // Arrange: a trigger swallows every even id, so the swap INSERT writes fewer rows than staging holds
      await database.query(`INSERT INTO ${ZONAS_TABLE} (id_distrito) VALUES (1), (3), (5)`);
      await database.exec(`
        CREATE FUNCTION swallow_even() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id_distrito % 2 = 0 THEN RETURN NULL; END IF; RETURN NEW; END $$;
        CREATE TRIGGER swallow_even BEFORE INSERT ON ${ZONAS_TABLE} FOR EACH ROW EXECUTE FUNCTION swallow_even();
      `);
      const before = await snapshotFinalTables(database);

      // Act
      const { result, rig } = await loadZonas([zonaPage(4, 101)], false);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step: LayerLoadStep.SWAP, staged: 4 });
      expect(transactionOf(rig).statements.at(-1)).toBe("ROLLBACK");
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should not touch the other layers' tables when one layer fails", async () => {
      // Arrange
      await seedOldWorld();
      const before = await snapshotFinalTables(database);

      // Act
      await loadZonas([zonaPage(4)], false, { fail: { pattern: swapInsertStatement(ZONAS_TABLE) } });

      // Assert
      expect(await snapshotFinalTables(database)).toEqual(before);
    });
  });

  describe("a WFS that repeats a full page (page-repetition guard)", () => {
    const MAX_CALLS = 5;

    /** Answers every request with the same features and throws after MAX_CALLS, so a missing guard cannot loop forever. */
    class RepeatingFetcher implements WfsPageFetcher {
      public calls = 0;

      constructor(private readonly features: ReadonlyArray<WfsFeature>) {}

      async fetchPage(): Promise<WfsPage> {
        this.calls += 1;
        if (this.calls > MAX_CALLS) throw new Error("infinite loop guard of the test");
        return { features: this.features, numberMatched: null };
      }
    }

    async function loadRepeating() {
      await seedOldWorld();
      const before = await snapshotFinalTables(database);
      const fetcher = new RepeatingFetcher(manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 1));
      const rig = createRig(database, fetcher, { clock: steadyClock() });
      const result = await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });
      return { before, fetcher, rig, result };
    }

    it("should stop after the second request, failing at the wfs step with a Spanish message", async () => {
      // Arrange & Act
      const { result, fetcher } = await loadRepeating();

      // Assert
      expect(fetcher.calls).toBe(2);
      expect(result).toMatchObject({ layerId: TestLayer.ZONAS, status: LayerLoadStatus.FAILED, step: LayerLoadStep.WFS });
      expect(result.message.trim().length).toBeGreaterThan(0);
      expect(result.message).not.toContain("infinite loop guard");
      expect(result.message).not.toContain(PASSWORD);
    });

    it("should roll back, take no lock and leave the final table untouched", async () => {
      // Arrange & Act
      const { result, rig, before } = await loadRepeating();

      // Assert
      expect(result.status).toBe(LayerLoadStatus.FAILED);
      expect(transactionOf(rig).statements.at(-1)).toBe("ROLLBACK");
      expect(rig.statements().some((statement) => ANY_LOCK.test(statement))).toBe(false);
      expect(await snapshotFinalTables(database)).toEqual(before);
      expect(await temporaryTableCount(database)).toBe(0);
    });

    it("should leave an ERROR audit row with paso_error wfs and never an EXITO one", async () => {
      // Arrange & Act
      const { result } = await loadRepeating();

      // Assert
      const rows = await auditRows(database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ estado: "ERROR", finished: true, paso_error: LayerLoadStep.WFS, mensaje_error: result.message });
      expect(rows.some((row) => row.estado === "EXITO")).toBe(false);
    });

    it("should not fail a short page that adds no new rows: it is just the end of the data", async () => {
      // Arrange
      const firstPage = manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 1);
      const shortRepeat = manyFeatures(3, (id) => zonaFeature(id), 1);

      // Act
      const { result } = await loadZonas([firstPage, shortRepeat], false);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, staged: ZONAS_PAGE_SIZE, downloaded: ZONAS_PAGE_SIZE + 3 });
    });

    it("should not fail a full page that adds at least one new row", async () => {
      // Arrange
      const firstPage = manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 1);
      const overlapping = manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 2);

      // Act
      const { result } = await loadZonas([firstPage, overlapping, []], false);

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.LOADED, staged: ZONAS_PAGE_SIZE + 1 });
    });
  });

  describe("no lock on the final table during the download", () => {
    const CASES = [
      {
        label: "zonas-ftth",
        layerId: TestLayer.ZONAS,
        pages: (): ScriptedPage[] => [manyFeatures(ZONAS_PAGE_SIZE, (id) => zonaFeature(id), 1), zonaPage(3, ZONAS_PAGE_SIZE + 1)],
      },
      {
        label: "tfo-divisores",
        layerId: TestLayer.TFO,
        pages: (): ScriptedPage[] => [[tfoFeature(1, "A"), tfoFeature(2, "B")]],
      },
    ] as const;

    const bareName = (layerId: (typeof CASES)[number]["layerId"]): string => finalTableOf(layerId).replace(/^public\./, "");

    it.each(CASES)("should not name the final table in any statement from BEGIN to the last page insert of $label", async ({ layerId, pages }) => {
      // Arrange
      const rig = createRig(database, fetcherFor(layerId, ...pages()), { clock: steadyClock() });

      // Act
      const result = await rig.repository.loadLayer(CONNECTION, layerId, { dryRun: false });

      // Assert
      expect(result.status).toBe(LayerLoadStatus.LOADED);
      const statements = transactionOf(rig).statements;
      const lastPage = lastIndexOfMatch(statements, PAGE_INSERT);
      expect(lastPage).toBeGreaterThan(0);
      const naming = statements.slice(0, lastPage + 1).filter((statement) => statement.toLowerCase().includes(bareName(layerId)));
      expect(naming).toEqual([]);
      expect(statements.at(-1)).toBe("COMMIT");
    });

    it.each(CASES)("should read the column types by a bind-parameter name and create the staging table with explicit column types for $label", async ({ layerId, pages }) => {
      // Arrange
      const rig = createRig(database, fetcherFor(layerId, ...pages()), { clock: steadyClock() });

      // Act
      await rig.repository.loadLayer(CONNECTION, layerId, { dryRun: true });

      // Assert
      const statements = transactionOf(rig).statements;
      const create = statements[indexOfMatch(statements, /^CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE/i)];
      const firstPage = rig.log.findIndex((entry) => PAGE_INSERT.test(entry.sql));
      const bound = JSON.stringify(rig.log.slice(0, firstPage).map((entry) => entry.values)).toLowerCase();
      expect(create).not.toMatch(/\bAS\s+SELECT\b/i);
      expect(create).toMatch(/ON COMMIT DROP/i);
      expect(bound).toContain(bareName(layerId));
    });

    it("should still lock and DELETE the final table, in that order, only after the last page", async () => {
      // Arrange
      await seedOldWorld();
      const rig = createRig(database, fetcherFor(TestLayer.ZONAS, zonaPage(4)), { clock: steadyClock() });

      // Act
      await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });

      // Assert
      const statements = transactionOf(rig).statements;
      const lock = indexOfMatch(statements, lockStatement(ZONAS_TABLE));
      expect(lock).toBeGreaterThan(lastIndexOfMatch(statements, PAGE_INSERT));
      expect(indexOfMatch(statements, deleteStatement(ZONAS_TABLE))).toBeGreaterThan(lock);
    });
  });

  describe("a final table that lacks a mapped column", () => {
    it("should fail at the insert step with a Spanish message naming the table and the column, leaving nothing behind", async () => {
      // Arrange
      await seedOldWorld();
      await database.exec(`ALTER TABLE ${ZONAS_TABLE} DROP COLUMN conca`);
      const before = await snapshotFinalTables(database);
      const gidBefore = await nextGid(database, TestLayer.ZONAS);

      // Act
      const { result, rig } = await loadZonas([zonaPage(4)], false);

      // Assert
      expect(result).toMatchObject({ layerId: TestLayer.ZONAS, status: LayerLoadStatus.FAILED, step: LayerLoadStep.INSERT });
      expect(result.message).toMatch(/no tiene la columna/i);
      expect(result.message).toContain("conca");
      expect(result.message).toContain(ZONAS_TABLE.replace(/^public\./, ""));
      expect(result.message).not.toContain(PASSWORD);
      expect(rig.statements().some((statement) => /^ROLLBACK/i.test(statement))).toBe(true);
      expect(rig.statements().some((statement) => /^COMMIT/i.test(statement))).toBe(false);
      expect(rig.statements().some((statement) => ANY_LOCK.test(statement))).toBe(false);
      expect(await snapshotFinalTables(database)).toEqual(before);
      expect(await nextGid(database, TestLayer.ZONAS)).toBe(gidBefore + 1);
      expect(await temporaryTableCount(database)).toBe(0);
      for (const client of rig.clients) expect(client.endCount).toBe(client.connectCount);
    });

    it("should record an ERROR audit row with paso_error insert", async () => {
      // Arrange
      await database.exec(`ALTER TABLE ${ZONAS_TABLE} DROP COLUMN conca`);

      // Act
      const { result } = await loadZonas([zonaPage(4)], false);

      // Assert
      const rows = await auditRows(database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ estado: "ERROR", finished: true, paso_error: LayerLoadStep.INSERT, mensaje_error: result.message });
    });

    it("should restore the full schema for the next test", async () => {
      // Arrange & Act
      await resetSigraDatabase(database);

      // Assert
      const columns = await database.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'area_zonas_ftth_f' AND column_name = 'conca'"
      );
      expect(columns.rows).toHaveLength(1);
    });
  });

  describe("connection failures", () => {
    it("should return failed with no step and without the password when the connection cannot be made", async () => {
      // Arrange
      await seedOldWorld();
      const before = await snapshotFinalTables(database);
      const fetcher = new ScriptedFetcher([zonaPage(4)], ZONAS_PAGE_SIZE);
      const rig = createRig(database, fetcher, { connectError: new Error(`connection refused (password ${PASSWORD})`) });

      // Act
      const result = await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });

      // Assert
      expect(result).toMatchObject({ layerId: TestLayer.ZONAS, status: LayerLoadStatus.FAILED, step: null, downloaded: 0, staged: 0 });
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).not.toContain(PASSWORD);
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(fetcher.urls).toEqual([]);
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should return failed instead of throwing when the client factory itself throws", async () => {
      // Arrange
      const fetcher = new ScriptedFetcher([zonaPage(4)], ZONAS_PAGE_SIZE);
      const rig = createRig(database, fetcher, { factoryError: new Error(`cannot build client for ${PASSWORD}`) });

      // Act
      const result = await rig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step: null });
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(fetcher.urls).toEqual([]);
    });

    it("should return failed when TEMP tables cannot be created and leave the table untouched", async () => {
      // Arrange
      await seedOldWorld();
      await revokeTempPrivilege(database);
      const before = await snapshotFinalTables(database);
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, ALL_FINAL_TABLE_GRANTS + AUDIT_GRANTS, async () => {
        result = (await loadZonas([zonaPage(4)], false)).result;
      });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED });
      expect(result?.message).not.toContain(PASSWORD);
      expect(await snapshotFinalTables(database)).toEqual(before);
    });

    it("should fail at the swap step when the role lacks DELETE, and leave the table untouched", async () => {
      // Arrange
      await seedOldWorld();
      const before = await snapshotFinalTables(database);
      const grants = `
        GRANT SELECT, INSERT ON ${ZONAS_TABLE} TO sigra_limited;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sigra_limited;
        ${AUDIT_GRANTS}
      `;
      let result: LayerLoadResult | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        result = (await loadZonas([zonaPage(4)], false)).result;
      });

      // Assert
      expect(result).toMatchObject({ status: LayerLoadStatus.FAILED, step: LayerLoadStep.SWAP });
      expect(await snapshotFinalTables(database)).toEqual(before);
    });
  });

  describe("layers are independent calls", () => {
    it("should load two layers one after the other, each in its own transaction", async () => {
      // Arrange
      await seedOldWorld();
      const zonasRig = createRig(database, fetcherFor(TestLayer.ZONAS, zonaPage(4)));
      const limiteRig = createRig(database, fetcherFor(TestLayer.LIMITE_CENTRAL, manyFeatures(3, (id) => limiteCentralFeature(id), 50)));

      // Act
      const zonas = await zonasRig.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });
      const limite = await limiteRig.repository.loadLayer(CONNECTION, TestLayer.LIMITE_CENTRAL, { dryRun: false });

      // Assert
      expect([zonas.status, limite.status]).toEqual([LayerLoadStatus.LOADED, LayerLoadStatus.LOADED]);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
      expect(await finalRows(database, TestLayer.LIMITE_CENTRAL)).toHaveLength(3);
      expect(await finalRows(database, TestLayer.POSTES)).toHaveLength(2);
    });

    it("should keep a failed layer from undoing a layer that already loaded", async () => {
      // Arrange
      const first = createRig(database, fetcherFor(TestLayer.ZONAS, zonaPage(4)));
      const second = createRig(database, fetcherFor(TestLayer.POSTES, new Error("caido")));

      // Act
      await first.repository.loadLayer(CONNECTION, TestLayer.ZONAS, { dryRun: false });
      const failed = await second.repository.loadLayer(CONNECTION, TestLayer.POSTES, { dryRun: false });

      // Assert
      expect(failed.status).toBe(LayerLoadStatus.FAILED);
      expect(await finalRows(database, TestLayer.ZONAS)).toHaveLength(4);
    });

    it("should load postes with the same transaction shape as zonas", async () => {
      // Arrange
      const rig = createRig(database, fetcherFor(TestLayer.POSTES, manyFeatures(3, (id) => posteFeature(id))));

      // Act
      await rig.repository.loadLayer(CONNECTION, TestLayer.POSTES, { dryRun: false });

      // Assert
      const statements = transactionOf(rig).statements;
      expect(indexOfMatch(statements, lockStatement(finalTableOf(TestLayer.POSTES)))).toBeGreaterThan(lastIndexOfMatch(statements, PAGE_INSERT));
      expect(statements.at(-1)).toBe("COMMIT");
    });
  });
});
