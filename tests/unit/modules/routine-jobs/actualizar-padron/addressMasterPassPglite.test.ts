import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import {
  buildAddressMasterApplySql,
  buildAddressMasterClassifySql,
  buildAddressMasterRemainingSql,
  type AddressMasterLinkLayouts,
} from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSql";
import { ADDRESS_MASTER_COLUMN, PADRON_SUBJECT_SPEC } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";

type Row = Record<string, unknown>;

const SETUP_TIMEOUT_MS = 30000;

const SCHEMA_SQL = `
  CREATE SCHEMA carto;
  CREATE TABLE carto.addresses_master (
    addresses_master_id serial PRIMARY KEY, urn text, latitud numeric, longitud numeric
  );
  CREATE TABLE carto.padron (id serial PRIMARY KEY, id_address_master int);
`;

/* Before the run: 1 NEW (no record yet), 2 EXISTING (one record), 3 AMBIGUOUS (two records), 4 already linked. */
const SEED_SQL = `
  INSERT INTO carto.addresses_master (urn, latitud, longitud) VALUES
    ('cgeo:padron:id:2', -34.9, -56.2),
    ('cgeo:padron:id:3', -34.8, -56.1),
    ('cgeo:padron:id:3', -34.8, -56.1),
    ('cgeo:padron:id:4', -34.7, -56.0);
  INSERT INTO carto.padron (id, id_address_master) VALUES (1, NULL), (2, NULL), (3, NULL), (4, 4);
`;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const LAYOUTS: AddressMasterLinkLayouts = {
  subject: tableOf("carto", "padron", ["id", "id_address_master"]),
  addressMaster: tableOf("carto", "addresses_master", Object.values(ADDRESS_MASTER_COLUMN)),
};

const ADDRESS_MASTER_SEQUENCE = {
  schema: "carto",
  table: "addresses_master",
  idColumn: ADDRESS_MASTER_COLUMN.ID,
  idSequence: "carto.addresses_master_addresses_master_id_seq",
};

const SELECT_PADRON_SQL = "SELECT id, id_address_master FROM carto.padron ORDER BY id";
const SELECT_ADDRESS_MASTER_SQL =
  "SELECT addresses_master_id, urn, latitud, longitud FROM carto.addresses_master ORDER BY addresses_master_id";

interface PadronRow {
  id: number;
  id_address_master: number | null;
}

interface AddressMasterRow {
  addresses_master_id: number;
  urn: string;
  latitud: number;
  longitud: number;
}

interface LinkRun {
  classification: Row;
  apply: Row;
  remaining: Row;
}

async function readPadron(database: PGlite): Promise<PadronRow[]> {
  const result = await database.query<Row>(SELECT_PADRON_SQL);
  return result.rows.map((row) => ({
    id: Number(row.id),
    id_address_master: row.id_address_master === null ? null : Number(row.id_address_master),
  }));
}

async function readAddressMaster(database: PGlite): Promise<AddressMasterRow[]> {
  const result = await database.query<Row>(SELECT_ADDRESS_MASTER_SQL);
  return result.rows.map((row) => ({
    addresses_master_id: Number(row.addresses_master_id),
    urn: String(row.urn),
    latitud: Number(row.latitud),
    longitud: Number(row.longitud),
  }));
}

const firstRowOf = (result: { rows: Row[] }): Row => result.rows[0];

/** The pass as the stage runs it inside its transaction: repair the sequence, classify, apply, verify, then COMMIT. */
async function runLinkPass(database: PGlite): Promise<LinkRun> {
  await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await database.query(buildSequenceRepairSql(ADDRESS_MASTER_SEQUENCE));
  const classification = firstRowOf(await database.query<Row>(buildAddressMasterClassifySql(LAYOUTS, PADRON_SUBJECT_SPEC)));
  const apply = firstRowOf(await database.query<Row>(buildAddressMasterApplySql(LAYOUTS, PADRON_SUBJECT_SPEC)));
  const remaining = firstRowOf(await database.query<Row>(buildAddressMasterRemainingSql(LAYOUTS, PADRON_SUBJECT_SPEC)));
  await database.exec("COMMIT");
  return { classification, apply, remaining };
}

describe("address master link pass on embedded Postgres", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(SCHEMA_SQL);
    await database.exec(SEED_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  describe("classify and apply (AP-52, AP-55, AP-60)", () => {
    it("should classify one NEW, one EXISTING and one AMBIGUOUS padron among the unlinked rows", async () => {
      const run = await runLinkPass(database);

      expect(Number(run.classification.without_address_master)).toBe(3);
      expect(Number(run.classification.to_create)).toBe(1);
      expect(Number(run.classification.already_had_record)).toBe(1);
      expect(Number(run.classification.ambiguous)).toBe(1);
      expect(Number(run.apply.created)).toBe(1);
      expect(Number(run.apply.linked)).toBe(2);
      expect(Number(run.remaining.remaining)).toBe(1);
    });

    it("should keep every padron id and every existing address master id unchanged", async () => {
      const padronsBefore = await readPadron(database);
      const recordsBefore = await readAddressMaster(database);

      await runLinkPass(database);

      const padronIdsAfter = (await readPadron(database)).map((row) => row.id);
      expect(padronIdsAfter).toEqual(padronsBefore.map((row) => row.id));
      const recordsAfter = await readAddressMaster(database);
      expect(recordsAfter.filter((row) => recordsBefore.some((before) => before.addresses_master_id === row.addresses_master_id))).toEqual(
        recordsBefore
      );
    });

    it("should create one record at (0, 0) for the NEW padron and link the padron to it", async () => {
      await runLinkPass(database);

      const newRecords = (await readAddressMaster(database)).filter((row) => row.urn === "cgeo:padron:id:1");
      const newPadron = (await readPadron(database)).find((row) => row.id === 1);
      expect(newRecords).toHaveLength(1);
      expect(newRecords[0]).toMatchObject({ latitud: 0, longitud: 0 });
      expect(newPadron?.id_address_master).toBe(newRecords[0].addresses_master_id);
    });

    it("should link the EXISTING padron to its one record without creating another record", async () => {
      const recordsBefore = await readAddressMaster(database);

      await runLinkPass(database);

      const existingRecord = recordsBefore.find((row) => row.urn === "cgeo:padron:id:2");
      const padronAfter = (await readPadron(database)).find((row) => row.id === 2);
      expect(padronAfter?.id_address_master).toBe(existingRecord?.addresses_master_id);
      expect((await readAddressMaster(database)).filter((row) => row.urn === "cgeo:padron:id:2")).toHaveLength(1);
    });

    it("should leave the AMBIGUOUS padron NULL and insert no record for it", async () => {
      await runLinkPass(database);

      const padronAfter = (await readPadron(database)).find((row) => row.id === 3);
      expect(padronAfter?.id_address_master).toBeNull();
      expect((await readAddressMaster(database)).filter((row) => row.urn === "cgeo:padron:id:3")).toHaveLength(2);
    });

    it("should leave the already linked padron untouched", async () => {
      const padronBefore = (await readPadron(database)).find((row) => row.id === 4);

      await runLinkPass(database);

      expect((await readPadron(database)).find((row) => row.id === 4)).toEqual(padronBefore);
    });

    it("should create and link nothing when the pass runs a second time", async () => {
      await runLinkPass(database);
      const padronsAfterFirst = await readPadron(database);
      const recordsAfterFirst = await readAddressMaster(database);

      const second = await runLinkPass(database);

      expect(Number(second.apply.created)).toBe(0);
      expect(Number(second.apply.linked)).toBe(0);
      expect(await readPadron(database)).toEqual(padronsAfterFirst);
      expect(await readAddressMaster(database)).toEqual(recordsAfterFirst);
    });
  });
});
