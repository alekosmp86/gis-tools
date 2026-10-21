import { describe, expect, it } from "vitest";
import { PgShpPlanRepository } from "@/modules/coverage-loads/shp/services/PgShpPlanRepository";
import { ADVISORY_LOCK_ID_BY_TABLE, ADVISORY_LOCK_NAMESPACE, PLAN_STATEMENT_TIMEOUT_MS } from "@/modules/coverage-loads/shp/constants";
import type { PgClientLike } from "@/modules/coverage-loads/shared/pgClient";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { CANARY_PASSWORD, CONNECTION_BODY } from "../helpers/apiTestEnv";

const CONNECTION: DbConnection = { ...CONNECTION_BODY, port: 5432 } as DbConnection;

interface Recorded {
  text: string;
  values: unknown[];
}

interface FakeClientOptions {
  tableExists?: boolean;
  granted?: boolean | ((privilege: string) => boolean);
  schemaCreate?: boolean;
  postgis?: boolean;
  leftovers?: string[];
  advisoryHeld?: boolean;
  total?: string;
  failOn?: RegExp;
  failConnect?: boolean;
}

function createFakeClient(options: FakeClientOptions = {}) {
  const queries: Recorded[] = [];
  const events: string[] = [];
  const client: PgClientLike = {
    async connect() {
      events.push("connect");
      if (options.failConnect) throw new Error(`connect failed for ${CANARY_PASSWORD}`);
    },
    async end() {
      events.push("end");
    },
    on() {
      return undefined;
    },
    async query(text: string, values: unknown[]) {
      queries.push({ text, values });
      if (options.failOn?.test(text)) throw new Error("boom");
      if (/^BEGIN|^SET LOCAL|^ROLLBACK|^COMMIT/.test(text)) return { rows: [] };
      if (text.includes("has_table_privilege")) {
        const grantedOption = options.granted ?? true;
        const granted = typeof grantedOption === "function" ? grantedOption(String(values[1])) : grantedOption;
        return { rows: [{ table_exists: options.tableExists ?? true, granted }] };
      }
      if (text.includes("has_schema_privilege")) return { rows: [{ granted: options.schemaCreate ?? true }] };
      if (text.includes("pg_extension")) return { rows: [{ available: options.postgis ?? true }] };
      if (text.includes("pg_class")) return { rows: (options.leftovers ?? []).map((relname) => ({ relname })) };
      if (text.includes("pg_locks")) return { rows: [{ held: options.advisoryHeld ?? false }] };
      if (text.includes("count(*)")) return { rows: [{ total: options.total ?? "7" }] };
      throw new Error(`unexpected statement: ${text}`);
    },
  };
  return { client, queries, events };
}

function repositoryFor(fake: ReturnType<typeof createFakeClient>) {
  return new PgShpPlanRepository(() => fake.client);
}

describe("PgShpPlanRepository.inspect", () => {
  it("should open a READ ONLY transaction first and set a statement timeout right after", async () => {
    // Arrange
    const fake = createFakeClient();

    // Act
    await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(fake.queries[0].text).toBe("BEGIN READ ONLY");
    expect(fake.queries[1].text).toBe(`SET LOCAL statement_timeout = ${PLAN_STATEMENT_TIMEOUT_MS}`);
    expect(fake.events[0]).toBe("connect");
  });

  it("should issue only SELECT statements apart from the transaction control", async () => {
    // Arrange
    const fake = createFakeClient();

    // Act
    await repositoryFor(fake).inspect(CONNECTION, "cobertura5g");

    // Assert
    const body = fake.queries.map((query) => query.text.trim()).filter((text) => !/^(BEGIN READ ONLY|SET LOCAL|ROLLBACK)/.test(text));
    expect(body.length).toBeGreaterThan(5);
    for (const text of body) expect(text).toMatch(/^SELECT\b/);
    const all = fake.queries.map((query) => query.text).join("\n");
    expect(all).not.toMatch(/TRUNCATE\s+TABLE|INSERT\s+INTO|DROP\s|DELETE\s+FROM|UPDATE\s|ALTER\s|CREATE\s+TABLE|pg_advisory_lock|pg_try_advisory/i);
  });

  it("should always roll back (never commit) and close the connection on success", async () => {
    // Arrange
    const fake = createFakeClient();

    // Act
    await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    const texts = fake.queries.map((query) => query.text);
    expect(texts[texts.length - 1]).toBe("ROLLBACK");
    expect(texts).not.toContain("COMMIT");
    expect(fake.events[fake.events.length - 1]).toBe("end");
  });

  it("should roll back and close the connection when a query fails", async () => {
    // Arrange
    const fake = createFakeClient({ failOn: /pg_extension/ });

    // Act & Assert
    await expect(repositoryFor(fake).inspect(CONNECTION, "lte")).rejects.toThrow("boom");
    expect(fake.queries[fake.queries.length - 1].text).toBe("ROLLBACK");
    expect(fake.events[fake.events.length - 1]).toBe("end");
  });

  it("should close the connection without a rollback when the connection itself fails", async () => {
    // Arrange
    const fake = createFakeClient({ failConnect: true });

    // Act & Assert
    await expect(repositoryFor(fake).inspect(CONNECTION, "lte")).rejects.toThrow("connect failed");
    expect(fake.queries).toEqual([]);
    expect(fake.events).toEqual(["connect", "end"]);
  });

  it("should read the advisory lock from pg_locks with the table's key and never take it", async () => {
    // Arrange
    const fake = createFakeClient({ advisoryHeld: true });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "nbiot");

    // Assert
    const lockQuery = fake.queries.find((query) => query.text.includes("pg_locks"));
    expect(lockQuery?.values).toEqual([ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID_BY_TABLE.nbiot]);
    expect(lockQuery?.text).toMatch(/^\s*SELECT/);
    expect(fake.queries.some((query) => /pg_(try_)?advisory_(xact_)?lock/i.test(query.text))).toBe(false);
    expect(inspection.advisoryLockHeld).toBe(true);
  });

  it("should restrict the advisory lock lookup to the current database", async () => {
    // Arrange
    const fake = createFakeClient();

    // Act
    await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    const lockQuery = fake.queries.find((query) => query.text.includes("pg_locks"));
    expect(lockQuery?.text).toMatch(/database\s*=\s*\(\s*SELECT\s+oid\s+FROM\s+pg_database\s+WHERE\s+datname\s*=\s*current_database\(\)\s*\)/i);
  });

  it("should map a healthy database to a complete inspection", async () => {
    // Arrange
    const fake = createFakeClient({ leftovers: ["shp_stage_lte"], total: "12345" });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(inspection).toEqual({
      tableExists: true,
      missingTablePrivileges: [],
      schemaCreateGranted: true,
      postgisAvailable: true,
      leftovers: ["shp_stage_lte"],
      advisoryLockHeld: false,
      currentRows: 12345,
    });
  });

  it("should look for the stage and work leftovers of the target table in the public schema", async () => {
    // Arrange
    const fake = createFakeClient();

    // Act
    await repositoryFor(fake).inspect(CONNECTION, "wcdma");

    // Assert
    const query = fake.queries.find((recorded) => recorded.text.includes("pg_class"));
    expect(query?.values).toEqual(["public", ["shp_stage_wcdma", "shp_work_wcdma"]]);
  });

  it("should report a missing table without counting rows", async () => {
    // Arrange
    const fake = createFakeClient({ tableExists: false });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(inspection.tableExists).toBe(false);
    expect(inspection.missingTablePrivileges).toEqual([]);
    expect(inspection.currentRows).toBeNull();
    expect(fake.queries.some((query) => query.text.includes("count(*)"))).toBe(false);
  });

  it("should list the missing privileges and skip the row count when SELECT is missing", async () => {
    // Arrange
    const fake = createFakeClient({ granted: (privilege) => privilege === "INSERT" });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(inspection.missingTablePrivileges).toEqual(["DELETE", "SELECT"]);
    expect(inspection.currentRows).toBeNull();
  });

  it("should count rows when SELECT is granted even if another privilege is missing", async () => {
    // Arrange
    const fake = createFakeClient({ granted: (privilege) => privilege !== "DELETE", total: "9" });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(inspection.missingTablePrivileges).toEqual(["DELETE"]);
    expect(inspection.currentRows).toBe(9);
  });

  it("should require exactly DELETE, INSERT and SELECT on the target and never ask for TRUNCATE", async () => {
    // Arrange
    const fake = createFakeClient();

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    const asked = fake.queries.filter((query) => query.text.includes("has_table_privilege")).map((query) => String(query.values[1]));
    expect([...asked].sort()).toEqual(["DELETE", "INSERT", "SELECT"]);
    expect(inspection.missingTablePrivileges).toEqual([]);
  });

  it("should report no shortfall for a role that lacks only TRUNCATE", async () => {
    // Arrange
    const fake = createFakeClient({ granted: (privilege) => privilege !== "TRUNCATE" });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(inspection.missingTablePrivileges).toEqual([]);
  });

  it("should report schema CREATE and PostGIS shortfalls", async () => {
    // Arrange
    const fake = createFakeClient({ schemaCreate: false, postgis: false });

    // Act
    const inspection = await repositoryFor(fake).inspect(CONNECTION, "lte");

    // Assert
    expect(inspection.schemaCreateGranted).toBe(false);
    expect(inspection.postgisAvailable).toBe(false);
  });

  it("should hand the connection it was given to the client factory", async () => {
    // Arrange
    const fake = createFakeClient();
    const seen: DbConnection[] = [];
    const repository = new PgShpPlanRepository((connection) => {
      seen.push(connection);
      return fake.client;
    });

    // Act
    await repository.inspect(CONNECTION, "lte");

    // Assert
    expect(seen).toEqual([CONNECTION]);
  });
});
