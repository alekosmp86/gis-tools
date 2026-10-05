import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { Fuente } from "@/modules/address-dedup/constants";
import { RemovalBlockReason, RemovalTable } from "@/modules/address-dedup/removalConstants";
import { PgRemovalRepository } from "@/modules/address-dedup/services/PgRemovalRepository";
import { REMOVAL_PLAN_SQL } from "@/modules/address-dedup/services/queries/removalPlanQuery";
import type { DbConnection, RepositoryRequest } from "@/modules/address-dedup/types";
import {
  createDedupDatabase,
  DEFAULT_PARAMETERS,
  insertAddress,
  insertDoorRecords,
  RecordingPgliteClient,
  resetDedupDatabase,
  type DoorRecords,
} from "./pgliteHarness";

const CONNECTION: DbConnection = { host: "db.example", port: 5432, db_name: "carto", user: "operator", password: "x" };
const REQUEST: RepositoryRequest = { connection: CONNECTION, parameters: DEFAULT_PARAMETERS };

const BASELINE_FINGERPRINT = "a2dc54a0d81c231bbaaba14c21f56a68";

let database: PGlite;

beforeAll(async () => {
  database = await createDedupDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetDedupDatabase(database);
});

function simulate() {
  return new PgRemovalRepository(() => new RecordingPgliteClient(database)).simulateRemoval(REQUEST);
}

async function addSiblingAddress(door: DoorRecords): Promise<void> {
  await database.query("INSERT INTO carto.address (id_address_master) VALUES ($1)", [door.masterId]);
}

/** A kept row plus one REMOVE target, in a padron of their own so each pair forms its own group. */
async function seedPair(keptNumber: number, targetNumber: number, padron: string, targetFuente: string) {
  const keptUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: keptNumber, padron });
  const targetUrn = await insertAddress(database, { fuente: targetFuente, idNumber: targetNumber, padron });
  await insertDoorRecords(database, keptUrn);
  const target = await insertDoorRecords(database, targetUrn);
  return { targetUrn, target };
}

describe("removal plan, master-shared verdict computed set-based", () => {
  it("should block a target whose master also carries a sibling address row", async () => {
    // Arrange
    const { targetUrn, target } = await seedPair(1, 2, "4053", Fuente.ANTEL);
    await addSiblingAddress(target);

    // Act
    const plan = await simulate();

    // Assert
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].urn).toBe(targetUrn);
    expect(plan.blockers[0].reasons.map((reason) => reason.code)).toContain(RemovalBlockReason.MASTER_SHARED);
  });

  it("should block a target whose master carries several sibling address rows", async () => {
    // Arrange
    const { target } = await seedPair(1, 2, "4053", Fuente.ANTEL);
    await addSiblingAddress(target);
    await addSiblingAddress(target);

    // Act
    const plan = await simulate();

    // Assert
    expect(plan.blockers.flatMap((blocker) => blocker.reasons.map((reason) => reason.code))).toContain(
      RemovalBlockReason.MASTER_SHARED
    );
  });

  it("should not flag a master that has exactly one address", async () => {
    // Arrange
    await seedPair(1, 2, "4053", Fuente.ANTEL);

    // Act
    const plan = await simulate();

    // Assert
    expect(plan.blockers).toEqual([]);
    expect(plan.counts.total).toBe(1);
  });

  it("should flag only the shared master when a shared and an unshared target are planned together", async () => {
    // Arrange
    const shared = await seedPair(1, 2, "4053", Fuente.ANTEL);
    const solo = await seedPair(11, 12, "5000", Fuente.TLK);
    await addSiblingAddress(shared.target);

    // Act
    const plan = await simulate();

    // Assert
    expect(plan.blockers.map((blocker) => blocker.urn)).toEqual([shared.targetUrn]);
    expect(plan.targets.map((target) => target.urn)).toContain(solo.targetUrn);
  });

  it("should flag both targets when each one's master is shared", async () => {
    // Arrange
    const first = await seedPair(1, 2, "4053", Fuente.ANTEL);
    const second = await seedPair(11, 12, "5000", Fuente.TLK);
    await addSiblingAddress(first.target);
    await addSiblingAddress(second.target);

    // Act
    const plan = await simulate();

    // Assert
    expect(plan.blockers.map((blocker) => blocker.urn).sort()).toEqual([first.targetUrn, second.targetUrn].sort());
  });

  it("should keep the plan, blockers and fingerprint of a fixed fixture identical to the per-target-scan implementation", async () => {
    // Arrange
    const keptA = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    const cleanA = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    const cleanB = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 3 });
    const keptB = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 11, padron: "5000" });
    const sharedB = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 12, padron: "5000" });
    const keptC = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 21, padron: "6000" });
    const soloC = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 22, padron: "6000" });
    for (const urn of [keptA, cleanA, cleanB, keptB, keptC, soloC]) await insertDoorRecords(database, urn);
    await addSiblingAddress(await insertDoorRecords(database, sharedB));

    // Act
    const plan = await simulate();

    // Assert
    expect(plan.fingerprint).toBe(BASELINE_FINGERPRINT);
    expect(plan.counts).toEqual({
      total: 4,
      byFuente: { [Fuente.TLK]: 2, [Fuente.ANTEL]: 2 },
      rowsByTable: {
        [RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT]: 0,
        [RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT]: 4,
        [RemovalTable.COMPACT_ADDRESS]: 4,
        [RemovalTable.INTERNAL_ADDRESS]: 0,
        [RemovalTable.ACCESS_POINT]: 4,
        [RemovalTable.ADDRESS]: 5,
        [RemovalTable.ADDRESSES_MASTER]: 4,
      },
    });
    expect(plan.blockers).toEqual([
      {
        urn: sharedB,
        reasons: [
          { code: RemovalBlockReason.URN_AMBIGUOUS, detail: null },
          { code: RemovalBlockReason.MASTER_SHARED, detail: null },
          { code: RemovalBlockReason.NOT_A_DOOR, detail: null },
        ],
      },
    ]);
    expect(plan.targets).toEqual([
      { urn: cleanA, fuente: Fuente.ANTEL },
      { urn: soloC, fuente: Fuente.ANTEL },
      { urn: sharedB, fuente: Fuente.TLK },
      { urn: cleanB, fuente: Fuente.TLK },
    ]);
  });

  it("should not contain a correlated subquery against carto.address in the plan SQL", () => {
    // Arrange
    const forbidden = /\(\s*SELECT[^()]*FROM\s+carto\.address\s+(?!WHERE\s+id\s*=\s*ANY)\w+\s+WHERE/i;

    // Act
    const hasPerRowScan = forbidden.test(REMOVAL_PLAN_SQL) || /FROM carto\.address other/.test(REMOVAL_PLAN_SQL);

    // Assert
    expect(hasPerRowScan).toBe(false);
    expect(REMOVAL_PLAN_SQL).toContain("master_address_counts");
  });
});
