import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { LoadRefusedError } from "@/modules/coverage-loads/indicators/domain/plan";
import {
  EXISTING_ROWS_SQL,
  INSERT_STAGING_SQL,
  LOCK_STAGING_SQL,
  REPLACE_HISTORY_SQL,
  STORED_ROWS_SQL,
  TRUNCATE_STAGING_SQL,
} from "@/modules/coverage-loads/indicators/services/queries/historyQueries";
import { PgIndicatorsRepository } from "@/modules/coverage-loads/indicators/services/PgIndicatorsRepository";
import { TABLE_PRIVILEGE_SQL } from "@/modules/coverage-loads/shared/tablePrivileges";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { makeCut, makeRejected, makeRows } from "./csvBuilders";
import {
  createCoverageDatabase,
  readHistory,
  RecordingPgliteClient,
  resetCoverageDatabase,
  seedHistory,
  snapshotTables,
  withLimitedRole,
} from "./pgliteHarness";

const CONNECTION: DbConnection = {
  host: "db.example",
  port: 5432,
  db_name: "carto",
  user: "operator",
  password: "s3cret-password",
};

const HISTORY = "historico.h_cobertura_lte_localidad";
const SEPTEMBER = "2026-09-01";
const WRITE_STATEMENTS = /^(TRUNCATE|INSERT)|WITH borrado/i;
const MISSING_DELETE_GRANTS = `
  GRANT SELECT, INSERT ON ${HISTORY} TO app_limited;
  GRANT TRUNCATE, INSERT ON public.indicadores_lte TO app_limited;
`;

let database: PGlite;
let clients: RecordingPgliteClient[];

/** Runs `beforeLock` right before the LOCK statement: whatever happens while a load waits for it. */
class HookedClient extends RecordingPgliteClient {
  constructor(
    db: PGlite,
    private readonly beforeLock: () => Promise<void>,
    private readonly lockError: Error | null
  ) {
    super(db);
  }

  override async query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }> {
    if (text !== LOCK_STAGING_SQL) return super.query(text, values);
    await this.beforeLock();
    if (this.lockError === null) return super.query(text, values);
    this.calls.push({ text, values });
    throw this.lockError;
  }
}

beforeAll(async () => {
  database = await createCoverageDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetCoverageDatabase(database);
  clients = [];
});

function newRepository(beforeLock: () => Promise<void> = async () => undefined, lockError: Error | null = null) {
  return new PgIndicatorsRepository(() => {
    const client = new HookedClient(database, beforeLock, lockError);
    clients.push(client);
    return client;
  });
}

function lastClient(): RecordingPgliteClient {
  return clients[clients.length - 1];
}

async function seedCut(fechaact: string, count: number): Promise<void> {
  await seedHistory(
    database,
    makeRows(count, "OLD", "10").map((row) => ({
      departamento: row.departamento,
      localidad: row.localidad,
      porcentaje: row.porcentaje,
      cobertura: "SI",
      fechaact,
    }))
  );
}

describe("PgIndicatorsRepository.loadCuts statement order", () => {
  describe("lock before reading counts", () => {
    it("should run BEGIN, the SET LOCALs, the privilege checks, LOCK, the count read, then write and COMMIT", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 3);

      // Act
      await newRepository().loadCuts(CONNECTION, {
        cuts: [makeCut(SEPTEMBER, makeRows(3, "NEW"))],
        acceptShrink: false,
      });

      // Assert
      const statements = lastClient().statements;
      const at = (sql: string) => statements.indexOf(sql.trim());
      const lastPrivilegeCheck = statements.lastIndexOf(TABLE_PRIVILEGE_SQL.trim());
      expect(statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      expect(statements[1]).toBe("SET LOCAL lock_timeout = '10s'");
      expect(statements[2]).toBe("SET LOCAL statement_timeout = 120000");
      expect(statements.indexOf(TABLE_PRIVILEGE_SQL.trim())).toBe(3);
      expect(at(LOCK_STAGING_SQL)).toBeGreaterThan(lastPrivilegeCheck);
      expect(at(EXISTING_ROWS_SQL)).toBeGreaterThan(at(LOCK_STAGING_SQL));
      expect(at(TRUNCATE_STAGING_SQL)).toBeGreaterThan(at(EXISTING_ROWS_SQL));
      expect(at(INSERT_STAGING_SQL)).toBeGreaterThan(at(TRUNCATE_STAGING_SQL));
      expect(at(REPLACE_HISTORY_SQL)).toBeGreaterThan(at(INSERT_STAGING_SQL));
      expect(at(STORED_ROWS_SQL)).toBeGreaterThan(at(REPLACE_HISTORY_SQL));
      expect(statements.at(-1)).toBe("COMMIT");
    });

    it("should read the counts once, and not before the lock", async () => {
      // Arrange & Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(2))], acceptShrink: false });

      // Assert
      const statements = lastClient().statements;
      const counts = statements.map((sql, index) => (sql === EXISTING_ROWS_SQL.trim() ? index : -1)).filter((i) => i >= 0);
      expect(counts).toHaveLength(1);
      expect(counts[0]).toBeGreaterThan(statements.indexOf(LOCK_STAGING_SQL.trim()));
    });

    it("should issue the LOCK exactly once, as ACCESS EXCLUSIVE on the staging table", async () => {
      // Arrange & Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(2))], acceptShrink: false });

      // Assert
      expect(lastClient().statementsMatching(/^LOCK TABLE/)).toEqual([
        "LOCK TABLE public.indicadores_lte IN ACCESS EXCLUSIVE MODE",
      ]);
    });

    it("should refuse a shrink using the post-lock count when the history grew while waiting for the lock", async () => {
      // Arrange: empty when the load starts; 615 rows appear (same session, so rolled back with the refusal) while it waits
      const partial = makeCut(SEPTEMBER, makeRows(612), makeRejected("f.csv", 3));

      // Act
      const attempt = newRepository(() => seedCut(SEPTEMBER, 615)).loadCuts(CONNECTION, {
        cuts: [partial],
        acceptShrink: false,
      });

      // Assert
      await expect(attempt).rejects.toThrow(LoadRefusedError);
      await expect(attempt).rejects.toThrow(/aceptar explícitamente la reducción/);
      expect(lastClient().statementsMatching(WRITE_STATEMENTS)).toEqual([]);
      expect(lastClient().statements.at(-1)).toBe("ROLLBACK");
    });

    it("should report the post-lock count as the replaced rows when the load goes ahead", async () => {
      // Arrange & Act
      const result = await newRepository(() => seedCut(SEPTEMBER, 5)).loadCuts(CONNECTION, {
        cuts: [makeCut(SEPTEMBER, makeRows(7, "NEW"))],
        acceptShrink: false,
      });

      // Assert
      expect(result.cuts[0].replacedRows).toBe(5);
      expect(await readHistory(database, SEPTEMBER)).toHaveLength(7);
    });
  });

  describe("lock failure", () => {
    it("should fail at the LOCK, change nothing and roll back when the lock cannot be acquired in time", async () => {
      // Arrange: stands in for a second session holding ACCESS EXCLUSIVE (PGlite has one session only)
      await seedCut(SEPTEMBER, 3);
      const before = await snapshotTables(database);

      // Act
      const attempt = newRepository(async () => undefined, new Error("canceling statement due to lock timeout")).loadCuts(
        CONNECTION,
        { cuts: [makeCut(SEPTEMBER, makeRows(4, "NEW"))], acceptShrink: true }
      );

      // Assert
      await expect(attempt).rejects.toThrow(/lock timeout/);
      const client = lastClient();
      expect(client.statementsMatching(WRITE_STATEMENTS)).toEqual([]);
      expect(client.statements).not.toContain(EXISTING_ROWS_SQL.trim());
      expect(client.statements.at(-1)).toBe("ROLLBACK");
      expect(client.endCount).toBe(1);
      expect(await snapshotTables(database)).toEqual(before);
    });
  });

  describe("privileges before lock", () => {
    it("should refuse with LoadRefusedError, issue no LOCK and write nothing when a privilege is missing", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 3);
      const before = await snapshotTables(database);

      await withLimitedRole(database, MISSING_DELETE_GRANTS, async () => {
        // Act
        const attempt = newRepository().loadCuts(CONNECTION, {
          cuts: [makeCut(SEPTEMBER, makeRows(3))],
          acceptShrink: true,
        });

        // Assert
        await expect(attempt).rejects.toThrow(LoadRefusedError);
        await expect(attempt).rejects.toThrow(`Faltan privilegios sobre ${HISTORY}: DELETE.`);
        await expect(attempt).rejects.not.toThrow(/permission denied/i);
        const client = lastClient();
        expect(client.statementsMatching(/^LOCK TABLE/)).toEqual([]);
        expect(client.statementsMatching(WRITE_STATEMENTS)).toEqual([]);
        expect(client.statements.at(-1)).toBe("ROLLBACK");
      });
      expect(await snapshotTables(database)).toEqual(before);
    });

    it("should carry a plan that lists the privilege shortfall and blocks the load", async () => {
      // Arrange
      await withLimitedRole(database, MISSING_DELETE_GRANTS, async () => {
        // Act
        const error = await newRepository()
          .loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(3))], acceptShrink: true })
          .catch((caught: unknown) => caught);

        // Assert
        expect(error).toBeInstanceOf(LoadRefusedError);
        const { plan } = error as LoadRefusedError;
        expect(plan.canLoad).toBe(false);
        expect(plan.privilegeShortfalls.find((item) => item.table === HISTORY)).toMatchObject({
          tableExists: true,
          missing: ["DELETE"],
        });
      });
    });

    it("should not read the counts nor lock when the history cannot be read", async () => {
      // Arrange
      await withLimitedRole(database, `GRANT INSERT, DELETE ON ${HISTORY} TO app_limited;`, async () => {
        // Act
        const attempt = newRepository().loadCuts(CONNECTION, {
          cuts: [makeCut(SEPTEMBER, makeRows(2))],
          acceptShrink: true,
        });

        // Assert
        await expect(attempt).rejects.toThrow(LoadRefusedError);
        expect(lastClient().statementsMatching(/^LOCK TABLE/)).toEqual([]);
        expect(lastClient().statements).not.toContain(EXISTING_ROWS_SQL.trim());
      });
    });
  });
});
