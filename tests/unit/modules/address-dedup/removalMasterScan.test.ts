import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { Fuente } from "@/modules/address-dedup/constants";
import { RemovalBlockReason } from "@/modules/address-dedup/removalConstants";
import { PgRemovalRepository } from "@/modules/address-dedup/services/PgRemovalRepository";
import type { DbConnection, RepositoryRequest } from "@/modules/address-dedup/types";
import {
  createDedupDatabase,
  DEFAULT_PARAMETERS,
  insertAddress,
  insertDoorRecords,
  RecordingPgliteClient,
  resetDedupDatabase,
} from "./pgliteHarness";

const CONNECTION: DbConnection = { host: "db.example", port: 5432, db_name: "carto", user: "operator", password: "x" };
const REQUEST: RepositoryRequest = { connection: CONNECTION, parameters: DEFAULT_PARAMETERS };

let database: PGlite;

beforeAll(async () => {
  database = await createDedupDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetDedupDatabase(database);
  await database.exec(`
    CREATE TABLE carto.legacy_refs (addresses_master_id text);
    CREATE TABLE carto.numeric_refs (address_master_id integer);
  `);
});

afterEach(async () => {
  await database.exec("DROP TABLE IF EXISTS carto.legacy_refs; DROP TABLE IF EXISTS carto.numeric_refs;");
});

async function seedTarget(): Promise<{ masterId: number }> {
  const keptUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
  const targetUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
  await insertDoorRecords(database, keptUrn);
  const target = await insertDoorRecords(database, targetUrn);
  return { masterId: target.masterId };
}

async function simulateRecorded() {
  const client = new RecordingPgliteClient(database);
  const plan = await new PgRemovalRepository(() => client).simulateRemoval(REQUEST);
  return { plan, client };
}

describe("removal master-reference scan, type-agnostic", () => {
  it("should not throw when a reference column is typed text", async () => {
    // Arrange
    await seedTarget();

    // Act
    const outcome = simulateRecorded();

    // Assert
    await expect(outcome).resolves.toBeDefined();
  });

  it("should block a target whose master is referenced from the text-typed column", async () => {
    // Arrange
    const { masterId } = await seedTarget();
    await database.query("INSERT INTO carto.legacy_refs (addresses_master_id) VALUES ($1)", [String(masterId)]);

    // Act
    const { plan } = await simulateRecorded();

    // Assert
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].reasons).toEqual([
      { code: RemovalBlockReason.MASTER_REFERENCED, detail: "carto.legacy_refs (addresses_master_id)" },
    ]);
  });

  it("should not block a target whose master is not referenced by either table", async () => {
    // Arrange
    const { masterId } = await seedTarget();
    await database.query("INSERT INTO carto.legacy_refs (addresses_master_id) VALUES ($1)", [String(masterId + 500)]);
    await database.query("INSERT INTO carto.numeric_refs (address_master_id) VALUES ($1)", [masterId + 500]);

    // Act
    const { plan } = await simulateRecorded();

    // Assert
    expect(plan.blockers).toEqual([]);
    expect(plan.counts.total).toBe(1);
  });

  it("should block a target whose master is referenced from the integer-typed column", async () => {
    // Arrange
    const { masterId } = await seedTarget();
    await database.query("INSERT INTO carto.numeric_refs (address_master_id) VALUES ($1)", [masterId]);

    // Act
    const { plan } = await simulateRecorded();

    // Assert
    expect(plan.blockers[0].reasons).toEqual([
      { code: RemovalBlockReason.MASTER_REFERENCED, detail: "carto.numeric_refs (address_master_id)" },
    ]);
  });

  it("should compare on the text side with a text[] parameter, never bigint", async () => {
    // Arrange
    await seedTarget();

    // Act
    const { client } = await simulateRecorded();
    const scans = client.statementsMatching(/FROM "?carto"?\."?(legacy_refs|numeric_refs)"?/);

    // Assert
    expect(scans).toHaveLength(2);
    for (const statement of scans) {
      expect(statement).toContain("::text = ANY($1::text[])");
      expect(statement).not.toContain("bigint");
    }
  });
});
