import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { STATEMENT_TIMEOUT_MS, WRITE_LOCK_TIMEOUT } from "@/modules/coverage-loads/constants";
import {
  DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS,
  REPORT_KINDS,
  REPORT_STATEMENT_TIMEOUT_MS,
  ReportKind,
  WRITE_STATEMENT_TIMEOUT_MS,
} from "@/modules/coverage-loads/avance-ftth/constants";
import { LoadRefusedError } from "@/modules/coverage-loads/avance-ftth/domain/plan";
import { PgAvanceFtthRepository } from "@/modules/coverage-loads/avance-ftth/services/PgAvanceFtthRepository";
import { runReportsGuarded } from "@/modules/coverage-loads/avance-ftth/services/queries/runReportQueries";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { RecordingPgliteClient } from "../pgliteHarness";
import {
  FailingPgliteClient,
  STANDARD_ZONES,
  countRows,
  createAvanceDatabase,
  createSerializedClientFactory,
  installPrivileges,
  resetAvanceDatabase,
  seedPreviousLoad,
  seedZones,
  snapshotAvanceTables,
  standardFiles,
} from "./avanceHarness";

const PASSWORD = "s3cret-password";
const CONNECTION: DbConnection = { host: "db.example", port: 5432, db_name: "carto", user: "operator", password: PASSWORD };

let database: PGlite;
let clients: RecordingPgliteClient[];

beforeAll(async () => {
  database = await createAvanceDatabase();
}, 60000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetAvanceDatabase(database);
  clients = [];
});

function recordingFactory(build: (index: number) => RecordingPgliteClient) {
  return () => {
    const client = build(clients.length);
    clients.push(client);
    return client;
  };
}

function serializedRepository(clockValues: number[] = [1000, 1750]): PgAvanceFtthRepository {
  const serialized = createSerializedClientFactory(database);
  const remaining = [...clockValues];
  return new PgAvanceFtthRepository(
    recordingFactory(() => serialized()),
    () => remaining.shift() ?? 0
  );
}

const hasCommit = (client: RecordingPgliteClient) => client.statements.includes("COMMIT");
const hasRollback = (client: RecordingPgliteClient) => client.statements.includes("ROLLBACK");
const writesOf = (client: RecordingPgliteClient) =>
  client.statements.filter((statement) => /^(TRUNCATE|DELETE|UPDATE)|INSERT INTO|DELETE FROM/.test(statement));

describe("avance-ftth repository transaction (AC-12, AC-13, AC-19, AC-21)", () => {
  describe("a real load", () => {
    it("should run in ONE connection and ONE transaction, with the lock and statement timeouts, and COMMIT at the end", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = serializedRepository();

      // Act
      await repository.load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      const [write] = clients;
      expect(write.statements.slice(0, 3)).toEqual([
        "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE",
        `SET LOCAL lock_timeout = '${WRITE_LOCK_TIMEOUT}'`,
        `SET LOCAL statement_timeout = ${WRITE_STATEMENT_TIMEOUT_MS}`,
      ]);
      expect(write.statements.at(-1)).toBe("COMMIT");
      expect(write.statements.filter((statement) => /^BEGIN/.test(statement))).toHaveLength(1);
      expect(hasRollback(write)).toBe(false);
      expect(write.connectCount).toBe(1);
      expect(write.endCount).toBe(1);
    });

    it.each([
      ["a real load", false],
      ["a dry run", true],
    ])("should take both staging locks before reading any plan state in %s, then verify the plan under the locks", async (_label, dryRun) => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = serializedRepository();

      // Act
      await repository.load(CONNECTION, { files: standardFiles(), dryRun });

      // Assert: nothing but BEGIN and the two SET LOCAL precede the locks (a read first would take ACCESS SHARE and deadlock on the upgrade)
      const statements = clients[0].statements;
      const locks = statements.flatMap((statement, index) => (/^LOCK TABLE/.test(statement) ? [index] : []));
      const firstTruncate = statements.findIndex((statement) => /^TRUNCATE public\.avance_planilla_int/.test(statement));
      const stateReads = statements.flatMap((statement, index) => (/FROM public\.area_zonas_ftth_f$/.test(statement) ? [index] : []));
      expect(locks).toEqual([3, 4]);
      expect(statements[3]).toMatch(/^LOCK TABLE public\.avance_planilla_int/);
      expect(statements[4]).toMatch(/^LOCK TABLE public\.avance_planilla_mvd/);
      expect(stateReads.length).toBeGreaterThanOrEqual(1);
      expect(stateReads.every((index) => index > Math.max(...locks))).toBe(true);
      expect(stateReads.some((index) => index < firstTruncate)).toBe(true);
    });

    it("should still abort with ROLLBACK, after the locks and before any write, when a blocker appears once the locks are held", async () => {
      // Arrange: the zones layer is empty, a blocker only visible to the check made under the locks
      await seedPreviousLoad(database);
      await database.exec("TRUNCATE public.area_zonas_ftth_f");
      const before = await snapshotAvanceTables(database);

      // Act
      const attempt = serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      await expect(attempt).rejects.toBeInstanceOf(LoadRefusedError);
      const statements = clients[0].statements;
      expect(statements.slice(3, 5).every((statement) => /^LOCK TABLE/.test(statement))).toBe(true);
      expect(statements.at(-1)).toBe("ROLLBACK");
      expect(hasCommit(clients[0])).toBe(false);
      expect(writesOf(clients[0])).toEqual([]);
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should leave the new content committed in all four tables", async () => {
      // Arrange
      await seedPreviousLoad(database);

      // Act
      const result = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      expect(result.dryRun).toBe(false);
      expect(result.avanceInserted).toBe(4);
      expect(result.history).toEqual({ copied: 2, skipped: false, reason: null });
      expect(await countRows(database, "public.avance_uruguay_planilla")).toBe(4);
      expect(await countRows(database, "public.avance_planilla_int")).toBe(5);
      expect(await countRows(database, "public.avance_planilla_mvd")).toBe(2);
      expect(await countRows(database, "historico.h_avance_uruguay")).toBe(3);
    });

    it("should read the reports after the COMMIT in two read-only transactions: four fast ones, then fuera_central alone", async () => {
      // Arrange
      await seedPreviousLoad(database);

      // Act
      const result = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      expect(clients).toHaveLength(3);
      const [, fast, slow] = clients;
      for (const client of [fast, slow]) {
        expect(client.statements.slice(0, 2)).toEqual(["BEGIN READ ONLY", `SET LOCAL statement_timeout = ${REPORT_STATEMENT_TIMEOUT_MS}`]);
        expect(hasCommit(client)).toBe(false);
        expect(writesOf(client)).toEqual([]);
        expect(client.statements).not.toContain(`SET LOCAL statement_timeout = ${DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS}`);
      }
      expect(fast.statements.filter((statement) => statement === "SAVEPOINT avance_report")).toHaveLength(4);
      expect(slow.statements.filter((statement) => statement === "SAVEPOINT avance_report")).toHaveLength(1);
      expect(slow.statements.some((statement) => /st_intersects/.test(statement))).toBe(true);
      expect(result.reports.map((report) => report.kind)).toEqual(REPORT_KINDS);
      expect(result.reports.every((report) => report.error === null && report.rows !== null)).toBe(true);
    });

    it("should order the write transaction before the reports: the reports see the committed state", async () => {
      // Arrange
      await seedPreviousLoad(database);

      // Act
      await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      expect(clients[0].statements.at(-1)).toBe("COMMIT");
      expect(clients[1].statements[0]).toBe("BEGIN READ ONLY");
      expect(hasCommit(clients[0])).toBe(true);
    });

    it("should measure elapsed milliseconds with the injected clock", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = serializedRepository([5000, 5750]);

      // Act
      const result = await repository.load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      expect(result.elapsedMs).toBe(750);
    });

    it("should report a report failure as a warning and keep the committed load", async () => {
      // Arrange
      await seedPreviousLoad(database);
      await database.exec("ALTER FUNCTION st_area(text) RENAME TO st_area_hidden");

      // Act
      let result;
      try {
        result = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });
      } finally {
        await database.exec("ALTER FUNCTION st_area_hidden(text) RENAME TO st_area");
      }

      // Assert
      expect(await countRows(database, "public.avance_uruguay_planilla")).toBe(4);
      const failed = result.reports.filter((report) => report.error !== null);
      expect(failed.map((report) => report.kind)).toEqual([ReportKind.FUERA_CENTRAL]);
      expect(failed[0].rows).toBeNull();
      expect(result.reports.filter((report) => report.error === null)).toHaveLength(4);
      expect(result.warnings.some((warning) => warning.includes("Zonas FTTH fuera de la central"))).toBe(true);
    });
  });

  describe("a dry run (AC-19)", () => {
    it("should run the same path, compute the reports inside the transaction and end with ROLLBACK, never COMMIT", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = serializedRepository();

      // Act
      const result = await repository.load(CONNECTION, { files: standardFiles(), dryRun: true });

      // Assert
      expect(clients).toHaveLength(1);
      const [only] = clients;
      expect(only.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      expect(only.statements.at(-1)).toBe("ROLLBACK");
      expect(hasCommit(only)).toBe(false);
      expect(only.statements.filter((statement) => /^TRUNCATE TABLE public\.avance_uruguay_planilla/.test(statement))).toHaveLength(1);
      expect(only.statements.filter((statement) => statement === "SAVEPOINT avance_report")).toHaveLength(5);
      expect(only.statements).toContain(`SET LOCAL statement_timeout = ${DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS}`);
      expect(result.dryRun).toBe(true);
      expect(result.avanceInserted).toBe(4);
      expect(result.reports).toHaveLength(5);
    });

    it("should use the named 60 s dry-run report timeout, shorter than the post-commit report timeout", () => {
      expect(DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS).toBe(60_000);
      expect(DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS).toBeLessThan(REPORT_STATEMENT_TIMEOUT_MS);
    });

    it("should set the dry-run statement timeout before EACH report and never the post-commit one inside the write transaction", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const timeoutSql = `SET LOCAL statement_timeout = ${DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS}`;

      // Act
      await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: true });

      // Assert: each report block (up to its RELEASE / ROLLBACK TO) holds exactly one dry-run timeout, set before the report query
      const statements = clients[0].statements;
      expect(statements).not.toContain(`SET LOCAL statement_timeout = ${REPORT_STATEMENT_TIMEOUT_MS}`);
      const firstSavepoint = statements.indexOf("SAVEPOINT avance_report");
      const blocks: string[][] = [];
      let current: string[] = [];
      for (const statement of statements.slice(firstSavepoint, -1)) {
        current.push(statement);
        if (statement === "RELEASE SAVEPOINT avance_report" || statement === "ROLLBACK TO SAVEPOINT avance_report") {
          blocks.push(current);
          current = [];
        }
      }
      expect(blocks).toHaveLength(5);
      for (const block of blocks) {
        const control = new Set(["SAVEPOINT avance_report", "RELEASE SAVEPOINT avance_report", "ROLLBACK TO SAVEPOINT avance_report", timeoutSql]);
        const reportIndex = block.findIndex((statement) => !control.has(statement));
        expect(block.filter((statement) => statement === timeoutSql)).toHaveLength(1);
        expect(block.indexOf(timeoutSql)).toBeLessThan(reportIndex);
      }
    });

    it("should turn a report cancelled by statement_timeout (57014) into a failed report, run the remaining ones and end in ROLLBACK", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);
      const cancelled = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
      const repository = new PgAvanceFtthRepository(
        recordingFactory(() => new FailingPgliteClient(database, /SELECT a\.central/, 1, cancelled)),
        () => 0
      );

      // Act
      const result = await repository.load(CONNECTION, { files: standardFiles(), dryRun: true });

      // Assert
      const failed = result.reports.filter((report) => report.error !== null);
      expect(failed.map((report) => report.kind)).toEqual([ReportKind.DUPLICADO]);
      expect(failed[0].rows).toBeNull();
      expect(failed[0].error).toContain("statement timeout");
      expect(result.reports.filter((report) => report.error === null && report.rows !== null)).toHaveLength(4);
      expect(result.warnings.some((warning) => warning.includes("statement timeout"))).toBe(true);
      const statements = clients[0].statements;
      expect(statements).toContain("ROLLBACK TO SAVEPOINT avance_report");
      expect(statements.filter((statement) => statement === "RELEASE SAVEPOINT avance_report")).toHaveLength(4);
      expect(statements.filter((statement) => statement === `SET LOCAL statement_timeout = ${DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS}`)).toHaveLength(5);
      expect(statements.at(-1)).toBe("ROLLBACK");
      expect(hasCommit(clients[0])).toBe(false);
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should persist nothing: all four tables are exactly as before", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);

      // Act
      await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: true });

      // Assert
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should isolate a failing report in its savepoint and still run the others and roll back", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);
      await database.exec("ALTER FUNCTION st_area(text) RENAME TO st_area_hidden");

      // Act
      let result;
      try {
        result = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: true });
      } finally {
        await database.exec("ALTER FUNCTION st_area_hidden(text) RENAME TO st_area");
      }

      // Assert
      expect(result.reports.filter((report) => report.error !== null).map((report) => report.kind)).toEqual([ReportKind.FUERA_CENTRAL]);
      expect(result.reports.filter((report) => report.error === null)).toHaveLength(4);
      expect(clients[0].statements.at(-1)).toBe("ROLLBACK");
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should continue with the remaining reports after one fails (failing report first)", async () => {
      // Arrange
      await seedPreviousLoad(database);
      await database.exec("ALTER FUNCTION st_area(text) RENAME TO st_area_hidden");
      const client = new RecordingPgliteClient(database);

      // Act
      let reports;
      try {
        await client.query("BEGIN READ ONLY", []);
        reports = await runReportsGuarded(client, [ReportKind.FUERA_CENTRAL, ReportKind.DUPLICADO, ReportKind.ERROR_ESTADOS], (error) =>
          error instanceof Error ? error.message : "?"
        );
        await client.query("ROLLBACK", []);
      } finally {
        await database.exec("ALTER FUNCTION st_area_hidden(text) RENAME TO st_area");
      }

      // Assert
      expect(reports.map((report) => [report.kind, report.rows === null ? "failed" : "ok"])).toEqual([
        [ReportKind.FUERA_CENTRAL, "failed"],
        [ReportKind.DUPLICADO, "ok"],
        [ReportKind.ERROR_ESTADOS, "ok"],
      ]);
      expect(reports[0].error).toContain("st_area");
      expect(client.statements).toContain("ROLLBACK TO SAVEPOINT avance_report");
      expect(client.statements.filter((statement) => statement === "RELEASE SAVEPOINT avance_report")).toHaveLength(2);
    });
  });

  describe("rollback on any failure (AC-13): all four tables keep their previous content", () => {
    const FAILURES: ReadonlyArray<readonly [string, RegExp, number]> = [
      ["the INT staging insert", /^INSERT INTO public\.avance_planilla_int/, 1],
      ["the UDPEM staging insert (INT staging already replaced)", /^INSERT INTO public\.avance_planilla_mvd/, 1],
      ["the junk delete of INT", /DELETE FROM public\.avance_planilla_int/, 1],
      ["the junk delete of UDPEM", /DELETE FROM public\.avance_planilla_mvd/, 1],
      ["the history copy", /INSERT INTO historico\.h_avance_uruguay/, 1],
      ["the Avance truncate (history already copied)", /^TRUNCATE TABLE public\.avance_uruguay_planilla/, 1],
      ["the INT Avance insert (Avance already truncated)", /INSERT INTO public\.avance_uruguay_planilla/, 1],
      ["the UDPEM Avance insert (INT already inserted)", /INSERT INTO public\.avance_uruguay_planilla/, 2],
      ["the fuente update", /^UPDATE public\.avance_uruguay_planilla SET fuente/, 1],
      ["the final count check", /^SELECT count\(\*\)::int AS total FROM public\.avance_uruguay_planilla/, 1],
    ];

    it.each(FAILURES)("should roll everything back when %s fails", async (_label, pattern, occurrence) => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);
      const repository = new PgAvanceFtthRepository(
        recordingFactory(() => new FailingPgliteClient(database, pattern, occurrence, new Error(`falló ${PASSWORD}`))),
        () => 0
      );

      // Act
      const attempt = repository.load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      await expect(attempt).rejects.toThrow("falló");
      expect(clients).toHaveLength(1);
      expect(hasCommit(clients[0])).toBe(false);
      expect(clients[0].statements.at(-1)).toBe("ROLLBACK");
      expect(clients[0].endCount).toBe(1);
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should roll back and not commit when the consistency check finds a mismatch", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);
      class MiscountingClient extends RecordingPgliteClient {
        override async query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }> {
          if (/^SELECT count\(\*\)::int AS total FROM public\.avance_uruguay_planilla/.test(text.trim())) {
            this.calls.push({ text, values });
            return { rows: [{ total: 999 }] };
          }
          return super.query(text, values);
        }
      }
      const repository = new PgAvanceFtthRepository(recordingFactory(() => new MiscountingClient(database)), () => 0);

      // Act
      const attempt = repository.load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      await expect(attempt).rejects.toThrow("El Avance quedó con 999 filas y los inserts escribieron 4; se deshizo la carga.");
      expect(hasCommit(clients[0])).toBe(false);
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should not attempt the reports when the write transaction failed", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = new PgAvanceFtthRepository(
        recordingFactory(() => new FailingPgliteClient(database, /^UPDATE public\.avance_uruguay_planilla/)),
        () => 0
      );

      // Act
      await repository.load(CONNECTION, { files: standardFiles(), dryRun: false }).catch(() => undefined);

      // Assert
      expect(clients).toHaveLength(1);
    });

    it("should refuse with a LoadRefusedError before any write when the plan no longer holds inside the transaction", async () => {
      // Arrange: the zones layer is empty, a blocker the handler's earlier plan could not have seen
      await seedPreviousLoad(database);
      await database.exec("TRUNCATE public.area_zonas_ftth_f");
      const before = await snapshotAvanceTables(database);
      const repository = serializedRepository();

      // Act
      const attempt = repository.load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      await expect(attempt).rejects.toBeInstanceOf(LoadRefusedError);
      expect(writesOf(clients[0])).toEqual([]);
      expect(clients[0].statements.at(-1)).toBe("ROLLBACK");
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should refuse a dry run the same way: the plan is rechecked for dry runs too", async () => {
      // Arrange
      await seedPreviousLoad(database);
      await database.exec("TRUNCATE public.area_zonas_ftth_f");

      // Act
      const attempt = serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: true });

      // Assert
      await expect(attempt).rejects.toBeInstanceOf(LoadRefusedError);
    });
  });

  describe("privileges are rechecked inside the write transaction (AC-12)", () => {
    const grants = (avanceTruncate: boolean) => `
      GRANT SELECT, INSERT, DELETE, TRUNCATE ON public.avance_planilla_int, public.avance_planilla_mvd TO avance_limited;
      GRANT SELECT, INSERT, UPDATE${avanceTruncate ? ", TRUNCATE" : ""} ON public.avance_uruguay_planilla TO avance_limited;
      GRANT SELECT, INSERT ON historico.h_avance_uruguay TO avance_limited;
      GRANT SELECT ON public.area_zonas_ftth_f, public.limite_central_ftth TO avance_limited;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public, historico TO avance_limited;
    `;

    it("should refuse before any write when TRUNCATE on the Avance is missing and name the privilege", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);
      const repository = serializedRepository();
      let message = "";
      let refused = false;

      // Act
      await installPrivileges(database, grants(false), async () => {
        try {
          await repository.load(CONNECTION, { files: standardFiles(), dryRun: false });
        } catch (error) {
          refused = error instanceof LoadRefusedError;
          message = error instanceof Error ? error.message : "";
        }
      });

      // Assert
      expect(refused).toBe(true);
      expect(message).toContain("Faltan privilegios sobre public.avance_uruguay_planilla: TRUNCATE.");
      expect(writesOf(clients[0])).toEqual([]);
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });

    it("should load with exactly the documented grants (staging x2, Avance, history, zones, limits, sequences)", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = serializedRepository();
      let result;

      // Act
      await installPrivileges(database, grants(true), async () => {
        result = await repository.load(CONNECTION, { files: standardFiles(), dryRun: true });
      });

      // Assert
      expect(result).toMatchObject({ dryRun: true, avanceInserted: 4 });
    });
  });

  describe("inspect (AC-7)", () => {
    it("should read in BEGIN READ ONLY with the module statement timeout and write nothing", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);
      const repository = serializedRepository();

      // Act
      const state = await repository.inspect(CONNECTION);

      // Assert
      expect(clients[0].statements.slice(0, 2)).toEqual(["BEGIN READ ONLY", `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`]);
      expect(hasCommit(clients[0])).toBe(false);
      expect(writesOf(clients[0])).toEqual([]);
      expect(state.zoneRows).toBe(STANDARD_ZONES.length);
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });
  });

  describe("readReports (AC-23)", () => {
    it("should open one read-only transaction for the fast group and one for fuera_central when all are asked", async () => {
      // Arrange
      await seedPreviousLoad(database);

      // Act
      const reports = await serializedRepository().readReports(CONNECTION, REPORT_KINDS);

      // Assert
      expect(clients).toHaveLength(2);
      expect(reports.map((report) => report.kind)).toEqual(REPORT_KINDS);
    });

    it("should open a single transaction when only one report is asked", async () => {
      // Arrange
      await seedPreviousLoad(database);

      // Act
      const reports = await serializedRepository().readReports(CONNECTION, [ReportKind.FUERA_CENTRAL]);

      // Assert
      expect(clients).toHaveLength(1);
      expect(reports.map((report) => report.kind)).toEqual([ReportKind.FUERA_CENTRAL]);
    });

    it("should mark every report of a group as failed with the password scrubbed when its connection cannot be made", async () => {
      // Arrange
      class UnreachableClient extends RecordingPgliteClient {
        override async connect(): Promise<void> {
          throw new Error(`connection refused (password ${PASSWORD})`);
        }
      }
      const repository = new PgAvanceFtthRepository(recordingFactory(() => new UnreachableClient(database)), () => 0);

      // Act
      const reports = await repository.readReports(CONNECTION, [ReportKind.DUPLICADO, ReportKind.ERROR_ESTADOS]);

      // Assert
      expect(reports.map((report) => [report.kind, report.rows])).toEqual([
        [ReportKind.DUPLICADO, null],
        [ReportKind.ERROR_ESTADOS, null],
      ]);
      for (const report of reports) {
        expect(report.error).toBe("connection refused (password ***)");
        expect(report.error).not.toContain(PASSWORD);
      }
    });

    it("should scrub the password from a failing report", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const repository = new PgAvanceFtthRepository(
        recordingFactory(() => new FailingPgliteClient(database, /SELECT a\.central/, 1, new Error(`boom ${PASSWORD}`))),
        () => 0
      );

      // Act
      const reports = await repository.readReports(CONNECTION, [ReportKind.DUPLICADO, ReportKind.ERROR_ESTADOS]);

      // Assert
      expect(reports[0]).toMatchObject({ kind: ReportKind.DUPLICADO, rows: null, error: "boom ***" });
      expect(reports[1]).toMatchObject({ kind: ReportKind.ERROR_ESTADOS, error: null });
    });

    it("should leave the database untouched", async () => {
      // Arrange
      await seedPreviousLoad(database);
      const before = await snapshotAvanceTables(database);

      // Act
      await serializedRepository().readReports(CONNECTION, REPORT_KINDS);

      // Assert
      expect(await snapshotAvanceTables(database)).toEqual(before);
    });
  });

  describe("O2 end to end through the repository", () => {
    it("should skip the history copy on a second load the same day and copy on a load after an older one", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);

      // Act
      const first = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });
      const second = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });
      await database.exec("UPDATE public.avance_uruguay_planilla SET fechacarga = current_date - 3");
      const third = await serializedRepository().load(CONNECTION, { files: standardFiles(), dryRun: false });

      // Assert
      expect(first.history).toMatchObject({ copied: 0, skipped: false });
      expect(second.history).toMatchObject({ copied: 0, skipped: true });
      expect(second.warnings[0]).toBe("historial omitido: el Avance actual ya fue cargado hoy");
      expect(third.history).toMatchObject({ copied: 4, skipped: false });
      expect(await countRows(database, "historico.h_avance_uruguay")).toBe(4);
    });
  });
});
