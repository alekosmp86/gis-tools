import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { Decision, DecisionReason, Fuente } from "@/modules/address-dedup/constants";
import { RemovalRefusedError } from "@/modules/address-dedup/domain/removal";
import {
  AUDIT_REQUIRED_COLUMNS,
  AUDIT_TABLE,
  RemovalBlockReason,
  RemovalState,
  RemovalTable,
  REMOVAL_PENDING_MESSAGE,
} from "@/modules/address-dedup/removalConstants";
import type { RemovalConfirmation } from "@/modules/address-dedup/removalTypes";
import { PgRemovalRepository } from "@/modules/address-dedup/services/PgRemovalRepository";
import type { DbConnection, RepositoryRequest } from "@/modules/address-dedup/types";
import {
  analyze,
  attachInternalUnit,
  countRows,
  createDedupDatabase,
  DEFAULT_PARAMETERS,
  insertAddress,
  insertDoorRecords,
  RecordingPgliteClient,
  resetDedupDatabase,
  snapshotCarto,
  tableExists,
  type DoorRecords,
} from "./pgliteHarness";

const CONNECTION: DbConnection = {
  host: "db.example",
  port: 5432,
  db_name: "carto",
  user: "operator",
  password: "s3cret-password",
};

const REQUEST: RepositoryRequest = { connection: CONNECTION, parameters: DEFAULT_PARAMETERS };

const OPERATION_ID = "6f1c2a3e-8b4d-4e5f-9a0b-1c2d3e4f5a6b";

const DELETE_ORDER = [
  RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT,
  RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT,
  RemovalTable.COMPACT_ADDRESS,
  RemovalTable.INTERNAL_ADDRESS,
  RemovalTable.ACCESS_POINT,
  RemovalTable.ADDRESS,
  RemovalTable.ADDRESSES_MASTER,
];

interface Scenario {
  readonly keptUrn: string;
  readonly removeAntelUrn: string;
  readonly removeTlkUrn: string;
  readonly reviewKeptUrn: string;
  readonly reviewInternalUrn: string;
  readonly removeAntel: DoorRecords;
  readonly removeTlk: DoorRecords;
  readonly reviewInternal: DoorRecords;
}

let database: PGlite;
let clients: RecordingPgliteClient[];

beforeAll(async () => {
  database = await createDedupDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetDedupDatabase(database);
  clients = [];
});

function newRepository(): PgRemovalRepository {
  return new PgRemovalRepository(() => {
    const client = new RecordingPgliteClient(database);
    clients.push(client);
    return client;
  });
}

function lastClient(): RecordingPgliteClient {
  return clients[clients.length - 1];
}

function confirmation(fingerprint: string, overrides: Partial<RemovalConfirmation> = {}): RemovalConfirmation {
  return {
    operationId: OPERATION_ID,
    responsable: "operador",
    motivo: "CGEO-2192 baja de duplicados",
    expectedFingerprint: fingerprint,
    ...overrides,
  };
}

/** Group A: one kept plus two REMOVE (ANTEL, TLK). Group B: one kept plus a door with internal units (HAS_INTERNAL_UNITS). */
async function seedScenario(): Promise<Scenario> {
  const keptUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
  const removeAntelUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
  const removeTlkUrn = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 3 });
  const reviewKeptUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 11, padron: "5000" });
  const reviewInternalUrn = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 12, padron: "5000" });

  await insertDoorRecords(database, keptUrn);
  const removeAntel = await insertDoorRecords(database, removeAntelUrn);
  const removeTlk = await insertDoorRecords(database, removeTlkUrn);
  await insertDoorRecords(database, reviewKeptUrn);
  const reviewInternal = await insertDoorRecords(database, reviewInternalUrn);
  await attachInternalUnit(database, reviewInternal.addressId);

  return {
    keptUrn,
    removeAntelUrn,
    removeTlkUrn,
    reviewKeptUrn,
    reviewInternalUrn,
    removeAntel,
    removeTlk,
    reviewInternal,
  };
}

/** One REMOVE target with a complete, healthy set of rows; the blocker tests each break one thing. */
async function seedSingleTarget(): Promise<{ targetUrn: string; target: DoorRecords }> {
  const keptUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
  const targetUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
  await insertDoorRecords(database, keptUrn);
  const target = await insertDoorRecords(database, targetUrn);
  return { targetUrn, target };
}

/** A complete door whose master and address ids are chosen by the test, for ids beyond 2^53. */
async function insertDoorWithIds(urn: string, masterId: string, addressId: string): Promise<void> {
  await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn) VALUES ($1::bigint, $2)", [masterId, urn]);
  await database.query("INSERT INTO carto.address (id, id_address_master) VALUES ($1::bigint, $2::bigint)", [addressId, masterId]);
  await database.query("INSERT INTO carto.access_point (id) VALUES ($1::bigint)", [addressId]);
  await database.query("INSERT INTO carto.territorial_unit_access_point (id_access_point, territory) VALUES ($1::bigint, 'T')", [addressId]);
  await database.query("INSERT INTO carto.compact_address (urn, compact) VALUES ($1, 'C')", [urn]);
}

async function masterUrns(): Promise<string[]> {
  const result = await database.query<{ urn: string }>("SELECT urn FROM carto.addresses_master ORDER BY urn");
  return result.rows.map((row) => row.urn);
}

const PROTECTED_SIBLING_REQUEST: RepositoryRequest = {
  connection: CONNECTION,
  parameters: { ...DEFAULT_PARAMETERS, protectedSiblingRemovesLone: true },
};

/** One group: IDE (protected), ANTEL (lowest removable urn), TLK; each with a full set of rows. */
async function seedProtectedGroup(): Promise<{ ideUrn: string; antelUrn: string; tlkUrn: string }> {
  const ideUrn = await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
  const antelUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
  const tlkUrn = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 3 });
  for (const urn of [ideUrn, antelUrn, tlkUrn]) await insertDoorRecords(database, urn);
  return { ideUrn, antelUrn, tlkUrn };
}

async function simulateFingerprint(): Promise<string> {
  return (await newRepository().simulateRemoval(REQUEST)).fingerprint;
}

function deleteOrderOf(client: RecordingPgliteClient): string[] {
  return client
    .statementsMatching(/DELETE FROM carto\./)
    .map((statement) => /DELETE FROM carto\.(\w+)/.exec(statement)?.[1] ?? "");
}

describe("PgRemovalRepository", () => {
  describe("simulateRemoval", () => {
    it("should return a fingerprint and a target set holding only the REMOVE rows", async () => {
      // Arrange
      const scenario = await seedScenario();

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.fingerprint).toMatch(/^[0-9a-f]{32}$/);
      expect(plan.blockers).toEqual([]);
      expect(plan.counts.total).toBe(2);
      expect(plan.counts.byFuente).toEqual({ [Fuente.ANTEL]: 1, [Fuente.TLK]: 1 });
      const snapshotUrns = (plan.snapshot.direcciones as Array<{ master: { urn: string } }>).map(
        (entry) => entry.master.urn
      );
      expect(snapshotUrns.sort()).toEqual([scenario.removeAntelUrn, scenario.removeTlkUrn].sort());
    });

    it("should leave the HAS_INTERNAL_UNITS row, its door and its internal units out of the plan", async () => {
      // Arrange
      const scenario = await seedScenario();

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      const serialized = JSON.stringify(plan.snapshot);
      expect(serialized).not.toContain(scenario.reviewInternalUrn);
      expect(serialized).not.toContain(scenario.reviewKeptUrn);
      expect(serialized).not.toContain(scenario.keptUrn);
      expect(plan.counts.rowsByTable[RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT]).toBe(0);
      expect(plan.counts.rowsByTable[RemovalTable.INTERNAL_ADDRESS]).toBe(0);
    });

    it("should list as targets only the REMOVE urns, sorted, in the set the counts and the fingerprint cover", async () => {
      // Arrange
      const scenario = await seedScenario();
      const extraUrns = [await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 10 })];
      for (const urn of extraUrns) await insertDoorRecords(database, urn);

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      const urns = plan.targets.map((target) => target.urn);
      const expectedUrns = [scenario.removeAntelUrn, scenario.removeTlkUrn, ...extraUrns];
      expect(urns).toEqual([...expectedUrns].sort());
      expect(urns).toHaveLength(plan.counts.total);
      expect(plan.targets.find((target) => target.urn === scenario.removeTlkUrn)?.fuente).toBe(Fuente.TLK);
      const snapshotUrns = (plan.snapshot.direcciones as Array<{ master: { urn: string } }>).map((entry) => entry.master.urn);
      expect(urns).toEqual([...snapshotUrns].sort());
      for (const absent of [scenario.keptUrn, scenario.reviewKeptUrn, scenario.reviewInternalUrn]) {
        expect(urns).not.toContain(absent);
      }
      const byFuente: Record<string, number> = {};
      for (const target of plan.targets) byFuente[target.fuente] = (byFuente[target.fuente] ?? 0) + 1;
      expect(byFuente).toEqual(plan.counts.byFuente);
    });

    it("should list no targets when nothing is removable", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.targets).toEqual([]);
    });

    it("should count the rows planned in each of the seven tables", async () => {
      // Arrange
      await seedScenario();

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.counts.rowsByTable).toEqual({
        [RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT]: 0,
        [RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT]: 2,
        [RemovalTable.COMPACT_ADDRESS]: 2,
        [RemovalTable.INTERNAL_ADDRESS]: 0,
        [RemovalTable.ACCESS_POINT]: 2,
        [RemovalTable.ADDRESS]: 2,
        [RemovalTable.ADDRESSES_MASTER]: 2,
      });
    });

    it("should produce the same fingerprint twice and a different one once the data changes", async () => {
      // Arrange
      const scenario = await seedScenario();
      const first = await simulateFingerprint();

      // Act
      const second = await simulateFingerprint();
      await database.query("INSERT INTO carto.territorial_unit_access_point (id_access_point, territory) VALUES ($1, 'X')", [
        scenario.removeAntel.addressId,
      ]);
      const afterChange = await simulateFingerprint();

      // Assert
      expect(second).toBe(first);
      expect(afterChange).not.toBe(first);
    });

    it("should run read-only, write nothing and always roll back", async () => {
      // Arrange
      await seedScenario();
      const before = await snapshotCarto(database);

      // Act
      await newRepository().simulateRemoval(REQUEST);

      // Assert
      const client = lastClient();
      expect(client.statements[0]).toBe("BEGIN READ ONLY");
      expect(client.statements[client.statements.length - 1]).toBe("ROLLBACK");
      const writingStatements = client
        .statementsMatching(/\b(DELETE|INSERT|UPDATE|LOCK|COMMIT|CREATE)\b/)
        .filter((statement) => !statement.includes("has_table_privilege"));
      expect(writingStatements).toEqual([]);
      expect(await snapshotCarto(database)).toEqual(before);
      expect(client.endCount).toBe(1);
    });

    it("should plan nothing when no row is a REMOVE candidate", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.counts.total).toBe(0);
      expect(plan.blockers).toEqual([]);
    });

    it.each([
      [
        "the master is shared by another address",
        [RemovalBlockReason.URN_AMBIGUOUS, RemovalBlockReason.MASTER_SHARED, RemovalBlockReason.NOT_A_DOOR],
        async (target: DoorRecords) => {
          await database.query("INSERT INTO carto.address (id_address_master) VALUES ($1)", [target.masterId]);
        },
      ],
      [
        "the address is not a door",
        [RemovalBlockReason.NOT_A_DOOR],
        async (target: DoorRecords) => {
          await database.query("DELETE FROM carto.access_point WHERE id = $1", [target.addressId]);
        },
      ],
      [
        "the address is also an internal address",
        [RemovalBlockReason.IS_INTERNAL],
        async (target: DoorRecords) => {
          await database.query("INSERT INTO carto.internal_address (id) VALUES ($1)", [target.addressId]);
        },
      ],
      [
        "the door is linked as an internal of another door",
        [RemovalBlockReason.LINKED_AS_INTERNAL],
        async (target: DoorRecords) => {
          await database.query(
            "INSERT INTO carto.internal_address_access_point (id_access_point, id_internal_address) VALUES (9999, $1)",
            [target.addressId]
          );
        },
      ],
      [
        "the urn resolves to no address and master",
        [RemovalBlockReason.URN_NOT_FOUND],
        async (target: DoorRecords) => {
          await database.query("DELETE FROM carto.address WHERE id = $1", [target.addressId]);
          await database.query("DELETE FROM carto.addresses_master WHERE addresses_master_id = $1", [target.masterId]);
        },
      ],
      [
        "another master carries the same urn",
        [RemovalBlockReason.URN_AMBIGUOUS],
        async (_target: DoorRecords, targetUrn: string) => {
          await database.query("INSERT INTO carto.addresses_master (urn) VALUES ($1)", [targetUrn]);
        },
      ],
    ])("should report a blocker when %s", async (_description, reasonCodes, breakIt) => {
      // Arrange
      const { targetUrn, target } = await seedSingleTarget();
      await breakIt(target, targetUrn);

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.blockers).toEqual([
        { urn: targetUrn, reasons: reasonCodes.map((code) => ({ code, detail: null })) },
      ]);
    });

    it("should report a blocker naming the table when another table still references the master", async () => {
      // Arrange
      const { targetUrn, target } = await seedSingleTarget();
      await database.exec("CREATE TABLE carto.address_notes (id_address_master int)");
      await database.query("INSERT INTO carto.address_notes (id_address_master) VALUES ($1)", [target.masterId]);

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.blockers).toEqual([
        {
          urn: targetUrn,
          reasons: [{ code: RemovalBlockReason.MASTER_REFERENCED, detail: "carto.address_notes (id_address_master)" }],
        },
      ]);
    });

    it("should not block a target merely because an unrelated master is referenced", async () => {
      // Arrange
      await seedSingleTarget();
      await database.exec("CREATE TABLE carto.address_notes (id_address_master int)");
      await database.query("INSERT INTO carto.address_notes (id_address_master) VALUES (424242)");

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(plan.blockers).toEqual([]);
    });
  });

  describe("executeRemoval", () => {
    it("should delete exactly the planned rows from all seven tables and write the audit row", async () => {
      // Arrange
      const scenario = await seedScenario();
      const fingerprint = await simulateFingerprint();

      // Act
      const result = await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      expect(result.recovered).toBe(false);
      expect(result.state).toBe(RemovalState.DELETED_PENDING_INDEXES);
      expect(result.pending).toBe(REMOVAL_PENDING_MESSAGE);
      expect(result.operationId).toBe(OPERATION_ID);
      expect(result.deletedByTable).toEqual({
        [RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT]: 0,
        [RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT]: 2,
        [RemovalTable.COMPACT_ADDRESS]: 2,
        [RemovalTable.INTERNAL_ADDRESS]: 0,
        [RemovalTable.ACCESS_POINT]: 2,
        [RemovalTable.ADDRESS]: 2,
        [RemovalTable.ADDRESSES_MASTER]: 2,
      });
      const remainingMasters = await database.query<{ urn: string }>("SELECT urn FROM carto.addresses_master ORDER BY urn");
      expect(remainingMasters.rows.map((row) => row.urn)).toEqual(
        [scenario.keptUrn, scenario.reviewKeptUrn, scenario.reviewInternalUrn].sort()
      );
      expect(await countRows(database, "carto.address")).toBe(3);
      expect(await countRows(database, "carto.access_point")).toBe(3);
      expect(await countRows(database, "carto.territorial_unit_access_point")).toBe(3);
      expect(await countRows(database, "carto.compact_address")).toBe(3);
      expect(await countRows(database, "carto.internal_address_access_point")).toBe(1);
      expect(await countRows(database, "carto.internal_address")).toBe(1);
    });

    it("should write the audit row with the scope, the operator, the fingerprint, the counts and the urn list", async () => {
      // Arrange
      const scenario = await seedScenario();
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Act
      const result = await newRepository().executeRemoval(REQUEST, confirmation(plan.fingerprint));

      // Assert
      const audit = await database.query<{
        operacion: string;
        referencia: string;
        incluir_internas: boolean;
        huella: string;
        responsable: string;
        motivo: string;
        ejecutor_bd: string;
        creado_en: Date;
        resultado: Record<string, unknown>;
      }>(`SELECT * FROM ${AUDIT_TABLE}`);
      expect(audit.rows).toHaveLength(1);
      const row = audit.rows[0];
      expect(row.operacion).toBe(OPERATION_ID);
      expect(row.referencia).toBe("address-dedup:province=7;protectedSiblingRemovesLone=false");
      expect(row.incluir_internas).toBe(false);
      expect(row.huella).toBe(plan.fingerprint);
      expect(row.responsable).toBe("operador");
      expect(row.motivo).toBe("CGEO-2192 baja de duplicados");
      expect(row.ejecutor_bd).toBe("postgres");
      expect(row.creado_en).toBeInstanceOf(Date);
      expect(row.resultado).toEqual({
        operationId: OPERATION_ID,
        fingerprint: plan.fingerprint,
        state: RemovalState.DELETED_PENDING_INDEXES,
        counts: plan.counts,
        deletedByTable: result.deletedByTable,
        pending: REMOVAL_PENDING_MESSAGE,
        recovered: false,
        provinceId: 7,
        protectedSiblingRemovesLone: false,
        targets: [
          { urn: scenario.removeAntelUrn, fuente: Fuente.ANTEL },
          { urn: scenario.removeTlkUrn, fuente: Fuente.TLK },
        ].sort((left, right) => left.urn.localeCompare(right.urn)),
      });
      expect(JSON.stringify(row.resultado)).not.toContain("snapshot");
    });

    it("should run one READ COMMITTED transaction: settings, advisory lock, table locks, ordered deletes, audit, one commit", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      const client = lastClient();
      const statements = client.statements;
      const indexOf = (pattern: RegExp) => statements.findIndex((statement) => pattern.test(statement));
      expect(statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
      expect(indexOf(/pg_advisory_xact_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/)).toBeLessThan(indexOf(/to_regclass/));
      expect(indexOf(/to_regclass/)).toBeLessThan(indexOf(/^LOCK TABLE carto\.address,/));
      expect(indexOf(/^LOCK TABLE carto\.address,/)).toBeLessThan(indexOf(/pg_class/));
      expect(indexOf(/pg_class/)).toBeLessThan(indexOf(/analysis AS/));
      expect(indexOf(/analysis AS/)).toBeLessThan(indexOf(/DELETE FROM/));
      expect(deleteOrderOf(client)).toEqual(DELETE_ORDER);
      expect(indexOf(/DELETE FROM carto\.addresses_master/)).toBeLessThan(indexOf(/INSERT INTO carto\.baja_direccion_operacion/));
      expect(statements[statements.length - 1]).toBe("COMMIT");
      expect(client.statementsMatching(/^COMMIT$/)).toHaveLength(1);
      expect(client.statementsMatching(/^ROLLBACK$/)).toHaveLength(0);
      expect(client.endCount).toBe(1);
      const lock = statements.find((statement) => statement.startsWith("LOCK TABLE carto.address,")) ?? "";
      for (const table of [
        "address",
        "addresses_master",
        "access_point",
        "internal_address",
        "internal_address_access_point",
        "territorial_unit_access_point",
        "compact_address",
        "comments_address",
        "plural_entity_access_point",
      ]) {
        expect(lock).toContain(`carto.${table}`);
      }
      expect(lock).toContain("SHARE ROW EXCLUSIVE");
    });

    it("should use a connection of its own, separate from the read-only simulation", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      expect(clients).toHaveLength(2);
      expect(clients[0].statements[0]).toBe("BEGIN READ ONLY");
      expect(clients[1].statements[0]).toContain("READ WRITE");
      expect(clients[1]).not.toBe(clients[0]);
    });

    it("should lock every other table that references a master before scanning it", async () => {
      // Arrange
      await seedScenario();
      await database.exec("CREATE TABLE carto.address_notes (addresses_master_id int)");
      const fingerprint = await simulateFingerprint();

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      const statements = lastClient().statements;
      const lockIndex = statements.indexOf("LOCK TABLE carto.address_notes IN SHARE ROW EXCLUSIVE MODE");
      expect(lockIndex).toBeGreaterThan(-1);
      expect(lockIndex).toBeLessThan(statements.findIndex((statement) => /analysis AS/.test(statement)));
    });

    it("should throw and write nothing when the data moved since the plan was reviewed", async () => {
      // Arrange
      await seedScenario();
      const staleFingerprint = await simulateFingerprint();
      const driftedUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 4 });
      await insertDoorRecords(database, driftedUrn);
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(staleFingerprint));

      // Assert
      await expect(attempt).rejects.toThrow(RemovalRefusedError);
      await expect(attempt).rejects.toThrow(/Simular y confirmar nuevamente/);
      expect(await snapshotCarto(database)).toEqual(before);
      expect(await countRows(database, AUDIT_TABLE)).toBe(0);
      const client = lastClient();
      expect(client.statementsMatching(/DELETE FROM/)).toEqual([]);
      expect(client.statements[client.statements.length - 1]).toBe("ROLLBACK");
      expect(client.statementsMatching(/^COMMIT$/)).toEqual([]);
    });

    it("should return the stored result and delete nothing when the same operation id is replayed", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      const first = await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));
      const newCandidateUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 4 });
      await insertDoorRecords(database, newCandidateUrn);
      const before = await snapshotCarto(database);

      // Act
      const replay = await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      expect(replay).toEqual({ ...first, recovered: true });
      expect(await snapshotCarto(database)).toEqual(before);
      expect(await countRows(database, AUDIT_TABLE)).toBe(1);
      expect(lastClient().statementsMatching(/DELETE FROM|^LOCK TABLE/)).toEqual([]);
    });

    it.each([
      ["responsable", { responsable: "otra persona" }],
      ["motivo", { motivo: "otro motivo" }],
    ])("should throw and change nothing when the operation id is replayed with another %s", async (_field, overrides) => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint, overrides));

      // Assert
      await expect(attempt).rejects.toThrow("El UUID ya fue utilizado con otros parametros.");
      expect(await snapshotCarto(database)).toEqual(before);
      expect(await countRows(database, AUDIT_TABLE)).toBe(1);
    });

    it("should throw when the operation id is replayed with another fingerprint", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation("0".repeat(32)));

      // Assert
      await expect(attempt).rejects.toThrow("El UUID ya fue utilizado con otros parametros.");
      expect(await snapshotCarto(database)).toEqual(before);
      expect(await countRows(database, AUDIT_TABLE)).toBe(1);
    });

    it("should throw when the operation id is replayed for another province", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Act
      const attempt = newRepository().executeRemoval(
        { connection: CONNECTION, parameters: { ...DEFAULT_PARAMETERS, provinceId: 8 } },
        confirmation(fingerprint)
      );

      // Assert
      await expect(attempt).rejects.toThrow("El UUID ya fue utilizado con otros parametros.");
    });

    it("should throw when the operation id is replayed for another toggle", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));
      const otherRequest: RepositoryRequest = {
        connection: CONNECTION,
        parameters: { ...DEFAULT_PARAMETERS, protectedSiblingRemovesLone: true },
      };

      // Act
      const attempt = newRepository().executeRemoval(otherRequest, confirmation(fingerprint));

      // Assert
      await expect(attempt).rejects.toThrow("El UUID ya fue utilizado con otros parametros.");
    });

    it.each([
      ["carto.comments_address", "INSERT INTO carto.comments_address DEFAULT VALUES"],
      ["carto.plural_entity_access_point", "INSERT INTO carto.plural_entity_access_point DEFAULT VALUES"],
    ])("should throw before deleting anything when %s has a row", async (_table, insertRow) => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await database.exec(insertRow);
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      await expect(attempt).rejects.toThrow(/comentarios o entidades plurales/);
      expect(await snapshotCarto(database)).toEqual(before);
      const client = lastClient();
      expect(client.statementsMatching(/DELETE FROM|analysis AS/)).toEqual([]);
      expect(client.statements[client.statements.length - 1]).toBe("ROLLBACK");
    });

    it("should refuse while any blocker exists, even with the right fingerprint, and delete none of the unblocked remainder", async () => {
      // Arrange
      const scenario = await seedScenario();
      await database.query("INSERT INTO carto.address (id_address_master) VALUES ($1)", [scenario.removeAntel.masterId]);
      const plan = await newRepository().simulateRemoval(REQUEST);
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(plan.fingerprint));

      // Assert
      expect(plan.blockers.map((blocker) => blocker.urn)).toEqual([scenario.removeAntelUrn]);
      await expect(attempt).rejects.toThrow(/no pueden eliminarse/);
      expect(await snapshotCarto(database)).toEqual(before);
      expect(lastClient().statementsMatching(/DELETE FROM/)).toEqual([]);
    });

    it("should refuse to run an empty plan", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      const fingerprint = await simulateFingerprint();

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      await expect(attempt).rejects.toThrow("No hay direcciones para eliminar.");
      expect(await countRows(database, AUDIT_TABLE)).toBe(0);
    });

    it("should never delete a HAS_INTERNAL_UNITS row, even when a hand-crafted request names it", async () => {
      // Arrange
      const scenario = await seedScenario();
      const fingerprint = await simulateFingerprint();
      const craftedRequest = {
        ...REQUEST,
        urns: [scenario.reviewInternalUrn],
        addressIds: [scenario.reviewInternal.addressId],
        masterIds: [scenario.reviewInternal.masterId],
        decision: "REMOVE",
      } as unknown as RepositoryRequest;

      // Act
      await newRepository().executeRemoval(craftedRequest, confirmation(fingerprint));

      // Assert
      const survivingAddresses = await database.query<{ id: number }>("SELECT id FROM carto.address WHERE id = $1", [
        scenario.reviewInternal.addressId,
      ]);
      expect(survivingAddresses.rows).toHaveLength(1);
      expect(await countRows(database, "carto.internal_address_access_point")).toBe(1);
      expect(await countRows(database, "carto.internal_address")).toBe(1);
      const surviving = await database.query<{ urn: string }>("SELECT urn FROM carto.addresses_master WHERE urn = $1", [
        scenario.reviewInternalUrn,
      ]);
      expect(surviving.rows).toHaveLength(1);
      const sentValues = JSON.stringify(lastClient().calls.map((call) => call.values));
      expect(sentValues).not.toContain(scenario.reviewInternalUrn);
    });

    it("should delete only ids the fresh analysis resolved, whatever the request carries", async () => {
      // Arrange
      const scenario = await seedScenario();
      const fingerprint = await simulateFingerprint();

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      const deleteCalls = lastClient().calls.filter((call) => /DELETE FROM carto\./.test(call.text));
      const expectedIds = [scenario.removeAntel.addressId, scenario.removeTlk.addressId].map(String).sort();
      for (const call of deleteCalls) {
        const values = (call.values[0] as string[]).map(String).sort();
        if (/compact_address/.test(call.text)) {
          expect(values).toEqual([scenario.removeAntelUrn, scenario.removeTlkUrn].sort());
        } else if (/addresses_master/.test(call.text)) {
          expect(values).toEqual([scenario.removeAntel.masterId, scenario.removeTlk.masterId].map(String).sort());
        } else {
          expect(values).toEqual(expectedIds);
        }
      }
      expect(deleteCalls).toHaveLength(DELETE_ORDER.length);
    });

    it("should roll back every earlier delete when a later one fails", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await database.exec(`
        CREATE FUNCTION carto.refuse_address_delete() RETURNS trigger LANGUAGE plpgsql
          AS $$ BEGIN RAISE EXCEPTION 'address delete refused'; END $$;
        CREATE TRIGGER refuse_address_delete BEFORE DELETE ON carto.address
          FOR EACH ROW EXECUTE FUNCTION carto.refuse_address_delete();
      `);
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      await expect(attempt).rejects.toThrow("address delete refused");
      expect(await snapshotCarto(database)).toEqual(before);
      expect(await countRows(database, AUDIT_TABLE)).toBe(0);
      const client = lastClient();
      expect(deleteOrderOf(client)).toEqual(DELETE_ORDER.slice(0, DELETE_ORDER.indexOf(RemovalTable.ADDRESS) + 1));
      expect(client.statements[client.statements.length - 1]).toBe("ROLLBACK");
      expect(client.endCount).toBe(1);
    });

    it.each([
      ["a malformed operation id", { operationId: "not-a-uuid" }, /UUID válido/],
      ["a blank responsable", { responsable: "   " }, /responsable y el motivo/],
      ["a blank motivo", { motivo: "" }, /responsable y el motivo/],
      ["a missing fingerprint", { expectedFingerprint: "" }, /huella/],
      ["a malformed fingerprint", { expectedFingerprint: "xyz" }, /huella/],
    ])("should refuse %s before opening any connection", async (_description, overrides, message) => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      const clientsBefore = clients.length;

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint, overrides));

      // Assert
      await expect(attempt).rejects.toThrow(message);
      expect(clients).toHaveLength(clientsBefore);
    });
  });

  describe("protected sources", () => {
    it("should leave the IDE row and the lowest-urn removable row out of the plan and alive after execute", async () => {
      // Arrange
      const { ideUrn, antelUrn, tlkUrn } = await seedProtectedGroup();

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);
      await newRepository().executeRemoval(REQUEST, confirmation(plan.fingerprint));

      // Assert
      expect(plan.targets).toEqual([{ urn: tlkUrn, fuente: Fuente.TLK }]);
      expect(JSON.stringify(plan.snapshot)).not.toContain(ideUrn);
      expect(JSON.stringify(plan.snapshot)).not.toContain(antelUrn);
      expect(await masterUrns()).toEqual([ideUrn, antelUrn].sort());
      expect(await countRows(database, "carto.address")).toBe(2);
      expect(await countRows(database, "carto.access_point")).toBe(2);
      expect(await countRows(database, "carto.territorial_unit_access_point")).toBe(2);
      const compacts = await database.query<{ urn: string }>("SELECT urn FROM carto.compact_address ORDER BY urn");
      expect(compacts.rows.map((row) => row.urn)).toEqual([ideUrn, antelUrn].sort());
    });

    it("should target only the ANTEL and TLK rows and keep the IDE alive when the toggle is on", async () => {
      // Arrange
      const { ideUrn, antelUrn, tlkUrn } = await seedProtectedGroup();

      // Act
      const plan = await newRepository().simulateRemoval(PROTECTED_SIBLING_REQUEST);
      await newRepository().executeRemoval(PROTECTED_SIBLING_REQUEST, confirmation(plan.fingerprint));

      // Assert
      expect(plan.targets).toEqual([
        { urn: antelUrn, fuente: Fuente.ANTEL },
        { urn: tlkUrn, fuente: Fuente.TLK },
      ]);
      expect(await masterUrns()).toEqual([ideUrn]);
      expect(await countRows(database, "carto.address")).toBe(1);
      expect(await countRows(database, "carto.access_point")).toBe(1);
      expect(await countRows(database, "carto.territorial_unit_access_point")).toBe(1);
      expect(await countRows(database, "carto.compact_address")).toBe(1);
    });

    it("should never put a KEPT_ALONGSIDE_PROTECTED row in the snapshot or the targets", async () => {
      // Arrange
      const { antelUrn } = await seedProtectedGroup();
      const analysisRows = await analyze(database);

      // Act
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Assert
      expect(analysisRows.find((row) => row.urn === antelUrn)).toMatchObject({
        decision: Decision.KEEP,
        decision_reason: DecisionReason.KEPT_ALONGSIDE_PROTECTED,
      });
      expect(plan.targets.map((target) => target.urn)).not.toContain(antelUrn);
      expect(JSON.stringify(plan.snapshot)).not.toContain(antelUrn);
    });
  });

  describe("ids beyond 2^53", () => {
    const KEPT_ID = "9007199254740992";
    const TARGET_ID = "9007199254740993";

    async function seedBigIntPair(): Promise<{ keptUrn: string; targetUrn: string }> {
      const keptUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      const targetUrn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
      await insertDoorWithIds(keptUrn, KEPT_ID, KEPT_ID);
      await insertDoorWithIds(targetUrn, TARGET_ID, TARGET_ID);
      return { keptUrn, targetUrn };
    }

    it("should delete exactly the row whose id is 2^53 + 1 and leave its neighbour at 2^53", async () => {
      // Arrange
      const { keptUrn, targetUrn } = await seedBigIntPair();
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(plan.fingerprint));

      // Assert
      expect(plan.targets).toEqual([{ urn: targetUrn, fuente: Fuente.ANTEL }]);
      expect(plan.blockers).toEqual([]);
      const addresses = await database.query<{ id: string }>("SELECT id::text AS id FROM carto.address");
      expect(addresses.rows).toEqual([{ id: KEPT_ID }]);
      const masters = await database.query<{ id: string }>("SELECT addresses_master_id::text AS id FROM carto.addresses_master");
      expect(masters.rows).toEqual([{ id: KEPT_ID }]);
      expect(await masterUrns()).toEqual([keptUrn]);
      expect(await countRows(database, "carto.access_point")).toBe(1);
    });

    it("should hand the delete statements the ids as exact strings", async () => {
      // Arrange
      await seedBigIntPair();
      const plan = await newRepository().simulateRemoval(REQUEST);

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(plan.fingerprint));

      // Assert
      const idCalls = lastClient().calls.filter(
        (call) => /DELETE FROM carto\./.test(call.text) && /::bigint\[\]/.test(call.text)
      );
      expect(idCalls.length).toBeGreaterThan(0);
      for (const call of idCalls) expect(call.values[0]).toEqual([TARGET_ID]);
    });
  });

  describe("audit table preconditions", () => {
    const FOREIGN_AUDIT_TABLE_SQL = `
      DROP TABLE ${AUDIT_TABLE};
      CREATE TABLE ${AUDIT_TABLE} (
        operacion uuid PRIMARY KEY, huella text NOT NULL, responsable text NOT NULL, motivo text NOT NULL,
        resultado jsonb NOT NULL
      )`;

    const MISSING_TABLE_MESSAGE = `La tabla de auditoria ${AUDIT_TABLE} no existe en esta base. Debe crearla un administrador antes de ejecutar bajas.`;

    function expectNothingTouched(client: RecordingPgliteClient): void {
      expect(client.statementsMatching(/DELETE FROM|^LOCK TABLE|INSERT INTO|CREATE|analysis AS/i)).toEqual([]);
    }

    it("should refuse the execution, with zero writes and no DDL, when the audit table does not exist", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await database.exec(`DROP TABLE ${AUDIT_TABLE}`);
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      await expect(attempt).rejects.toThrow(RemovalRefusedError);
      await expect(attempt).rejects.toThrow(MISSING_TABLE_MESSAGE);
      expect(await snapshotCarto(database)).toEqual(before);
      expect(await tableExists(database, AUDIT_TABLE)).toBe(false);
      const client = lastClient();
      expectNothingTouched(client);
      expect(client.statementsMatching(/CREATE/i)).toEqual([]);
      expect(client.statements[client.statements.length - 1]).toBe("ROLLBACK");
    });

    it("should refuse the simulation too, before resolving the plan, when the audit table does not exist", async () => {
      // Arrange
      await seedScenario();
      await database.exec(`DROP TABLE ${AUDIT_TABLE}`);

      // Act
      const attempt = newRepository().simulateRemoval(REQUEST);

      // Assert
      await expect(attempt).rejects.toThrow(MISSING_TABLE_MESSAGE);
      expectNothingTouched(lastClient());
    });

    it("should never issue a CREATE statement on a successful execution either", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();

      // Act
      await newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      for (const client of clients) expect(client.statementsMatching(/CREATE/i)).toEqual([]);
    });

    it("should refuse with a message naming the missing columns and delete nothing", async () => {
      // Arrange
      await seedScenario();
      const fingerprint = await simulateFingerprint();
      await database.exec(FOREIGN_AUDIT_TABLE_SQL);
      const before = await snapshotCarto(database);

      // Act
      const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

      // Assert
      await expect(attempt).rejects.toThrow(RemovalRefusedError);
      await expect(attempt).rejects.toThrow(
        `La tabla de auditoria ${AUDIT_TABLE} existe con otra estructura; faltan columnas: referencia, incluir_internas, ejecutor_bd, creado_en.`
      );
      expect(await snapshotCarto(database)).toEqual(before);
      const client = lastClient();
      expectNothingTouched(client);
      expect(client.statements[client.statements.length - 1]).toBe("ROLLBACK");
      expect(await countRows(database, AUDIT_TABLE)).toBe(0);
    });

    it("should refuse the simulation too when the audit table lacks columns", async () => {
      // Arrange
      await seedScenario();
      await database.exec(FOREIGN_AUDIT_TABLE_SQL);

      // Act
      const attempt = newRepository().simulateRemoval(REQUEST);

      // Assert
      await expect(attempt).rejects.toThrow(RemovalRefusedError);
      expectNothingTouched(lastClient());
    });
  });

  describe("privilege preconditions", () => {
    interface FakeCall {
      readonly text: string;
      readonly values: unknown[];
    }

    interface ScriptedOptions {
      readonly canSelect?: boolean;
      readonly canInsert?: boolean;
      readonly lackingDelete?: string[];
    }

    /** A fake connection that answers each precondition query from a script and records every statement. */
    function scriptedClient(options: ScriptedOptions) {
      const calls: FakeCall[] = [];
      return {
        calls,
        async connect() {},
        on() {},
        async end() {},
        async query(text: string, values: unknown[]) {
          calls.push({ text, values });
          if (/to_regclass/.test(text)) return { rows: [{ present: true }] };
          if (/information_schema\.columns/.test(text)) {
            return { rows: AUDIT_REQUIRED_COLUMNS.map((column_name) => ({ column_name })) };
          }
          if (/AS can_select/.test(text)) {
            return { rows: [{ can_select: options.canSelect ?? true, can_insert: options.canInsert ?? true }] };
          }
          if (/NOT has_table_privilege/.test(text)) {
            return { rows: (options.lackingDelete ?? []).map((table_name) => ({ table_name })) };
          }
          return { rows: [] };
        },
      };
    }

    function scriptedRepository(client: ReturnType<typeof scriptedClient>): PgRemovalRepository {
      return new PgRemovalRepository(() => client);
    }

    const MUTATING = /DELETE FROM|^LOCK TABLE|INSERT INTO|CREATE|analysis AS/i;

    it("should check SELECT and INSERT on the audit table and DELETE on the seven tables, before any lock", async () => {
      // Arrange
      const client = scriptedClient({});

      // Act
      await scriptedRepository(client)
        .executeRemoval(REQUEST, confirmation("a".repeat(32)))
        .catch(() => undefined);

      // Assert
      const privilegeCall = client.calls.find((call) => /AS can_select/.test(call.text));
      expect(privilegeCall?.values).toEqual([AUDIT_TABLE]);
      expect(privilegeCall?.text).toContain("has_table_privilege(current_user, $1, 'SELECT')");
      expect(privilegeCall?.text).toContain("has_table_privilege(current_user, $1, 'INSERT')");
      const deleteCall = client.calls.find((call) => /NOT has_table_privilege/.test(call.text));
      expect(deleteCall?.text).toContain("has_table_privilege(current_user, t, 'DELETE')");
      expect(deleteCall?.values).toEqual([DELETE_ORDER.map((table) => `carto.${table}`)]);
      const texts = client.calls.map((call) => call.text);
      const firstLock = texts.findIndex((text) => /^LOCK TABLE/.test(text));
      const deleteCheck = texts.findIndex((text) => /NOT has_table_privilege/.test(text));
      expect(firstLock).toBeGreaterThan(deleteCheck);
    });

    it.each([
      ["INSERT", { canInsert: false }],
      ["SELECT", { canSelect: false }],
      ["SELECT ni INSERT", { canSelect: false, canInsert: false }],
    ])("should refuse before any lock or delete when the role lacks %s on the audit table", async (privilege, options) => {
      // Arrange
      const client = scriptedClient(options);

      // Act
      const attempt = scriptedRepository(client).executeRemoval(REQUEST, confirmation("a".repeat(32)));

      // Assert
      await expect(attempt).rejects.toThrow(RemovalRefusedError);
      await expect(attempt).rejects.toThrow(
        `El usuario conectado no tiene el privilegio ${privilege} sobre ${AUDIT_TABLE}.`
      );
      expect(client.calls.filter((call) => MUTATING.test(call.text))).toEqual([]);
    });

    it("should refuse before any lock or delete, listing the tables, when the role lacks DELETE on a deletion table", async () => {
      // Arrange
      const client = scriptedClient({ lackingDelete: ["carto.address", "carto.compact_address"] });

      // Act
      const attempt = scriptedRepository(client).executeRemoval(REQUEST, confirmation("a".repeat(32)));

      // Assert
      await expect(attempt).rejects.toThrow(RemovalRefusedError);
      await expect(attempt).rejects.toThrow(
        "El usuario conectado no tiene el privilegio DELETE sobre: carto.address, carto.compact_address."
      );
      expect(client.calls.filter((call) => MUTATING.test(call.text))).toEqual([]);
    });

    it("should refuse the simulation too when a privilege is missing", async () => {
      // Arrange
      const client = scriptedClient({ canInsert: false });

      // Act
      const attempt = scriptedRepository(client).simulateRemoval(REQUEST);

      // Assert
      await expect(attempt).rejects.toThrow(/privilegio INSERT/);
      expect(client.calls.filter((call) => MUTATING.test(call.text))).toEqual([]);
    });

    describe("against a real limited role in pglite", () => {
      async function withRole(grants: string, run: () => Promise<void>): Promise<void> {
        await database.exec(`
          CREATE ROLE app_limited;
          GRANT USAGE ON SCHEMA carto, match_tlk, integrador TO app_limited;
          GRANT SELECT ON ALL TABLES IN SCHEMA carto, match_tlk, integrador TO app_limited;
          ${grants}
          SET ROLE app_limited;
        `);
        try {
          await run();
        } finally {
          await database.exec(`
            RESET ROLE;
            DROP OWNED BY app_limited;
            DROP ROLE app_limited;
          `);
        }
      }

      it("should refuse when the connected role cannot INSERT into the audit table, and write nothing", async () => {
        // Arrange
        await seedScenario();
        const fingerprint = await simulateFingerprint();
        const before = await snapshotCarto(database);

        await withRole("GRANT DELETE ON ALL TABLES IN SCHEMA carto TO app_limited;", async () => {
          // Act
          const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

          // Assert
          await expect(attempt).rejects.toThrow(`privilegio INSERT sobre ${AUDIT_TABLE}`);
          expect(lastClient().statementsMatching(/DELETE FROM|^LOCK TABLE/)).toEqual([]);
        });
        expect(await snapshotCarto(database)).toEqual(before);
      });

      it("should refuse when the connected role cannot DELETE from a deletion table, and write nothing", async () => {
        // Arrange
        await seedScenario();
        const fingerprint = await simulateFingerprint();
        const before = await snapshotCarto(database);

        await withRole(
          `GRANT DELETE ON ALL TABLES IN SCHEMA carto TO app_limited;
           REVOKE DELETE ON carto.compact_address FROM app_limited;
           GRANT INSERT ON ${AUDIT_TABLE} TO app_limited;`,
          async () => {
            // Act
            const attempt = newRepository().executeRemoval(REQUEST, confirmation(fingerprint));

            // Assert
            await expect(attempt).rejects.toThrow("privilegio DELETE sobre: carto.compact_address.");
            expect(lastClient().statementsMatching(/DELETE FROM|^LOCK TABLE/)).toEqual([]);
          }
        );
        expect(await snapshotCarto(database)).toEqual(before);
      });
    });
  });
});
