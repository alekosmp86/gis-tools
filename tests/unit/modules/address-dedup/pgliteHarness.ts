import { PGlite } from "@electric-sql/pglite";
import { DedupRules, Fuente } from "@/modules/address-dedup/constants";
import type { AnalysisRow, DuplicateAnalysisParameters } from "@/modules/address-dedup/types";
import type { PgClientLike } from "@/modules/address-dedup/services/PgAddressRepository";
import { runDuplicateAnalysis } from "@/modules/address-dedup/services/queries/runDuplicateAnalysis";

const URN_PREFIX_BY_FUENTE: Readonly<Record<string, string>> = {
  [Fuente.IDE]: "cgeo:ideuy:address:id:",
  [Fuente.ANTEL]: "cgeo:Antel:address:id:",
  [Fuente.TLK]: "cgeo:TLK:wstlk:id:",
};

/** The real shape of the dev audit table `carto.baja_direccion_operacion`, which an administrator creates. */
const AUDIT_TABLE_SQL = `
  CREATE TABLE carto.baja_direccion_operacion (
    operacion uuid NOT NULL PRIMARY KEY,
    referencia text NOT NULL,
    incluir_internas boolean NOT NULL,
    huella text NOT NULL,
    responsable text NOT NULL,
    motivo text NOT NULL,
    ejecutor_bd text NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
    resultado jsonb NOT NULL
  );
`;

const SCHEMA_SQL = `
  CREATE SCHEMA carto;
  CREATE SCHEMA match_tlk;
  CREATE SCHEMA integrador;
  CREATE TABLE carto.v_address_build (
    name_font text, urn text, name_province text, code_province text,
    rs_censal_locality_code text, rs_censal_locality_name text, rs_name text, number text,
    letter text, square text, sandlot text, km numeric, type_padron text, padron_number text,
    pad_cadastral_locality_name text, postal_code text, block text, tower text, floor text,
    unit text, code_country text, name_country text, id_province int,
    rs_cadastral_locality_name text, rs_idcalle text, rs_reftramo text, rs_short_name text,
    side text, latitud double precision, longitud double precision, document_type text
  );
  CREATE TABLE match_tlk.direcciones_tlk_serv_cto_cgeo (urn text);
  CREATE TABLE integrador.nap_physical_device (urn_site_location text);
  CREATE TABLE carto.addresses_master (addresses_master_id bigserial PRIMARY KEY, urn text);
  CREATE TABLE carto.address (id bigserial PRIMARY KEY, id_address_master bigint);
  CREATE TABLE carto.internal_address_access_point (id_access_point bigint, id_internal_address bigint);
  CREATE TABLE carto.access_point (id bigint PRIMARY KEY);
  CREATE TABLE carto.internal_address (id bigint PRIMARY KEY);
  CREATE TABLE carto.territorial_unit_access_point (id_access_point bigint, territory text);
  CREATE TABLE carto.compact_address (urn text, compact text);
  CREATE TABLE carto.comments_address (id serial PRIMARY KEY);
  CREATE TABLE carto.plural_entity_access_point (id serial PRIMARY KEY);
  ${AUDIT_TABLE_SQL}
`;

const RESET_SQL = `
  TRUNCATE carto.v_address_build;
  TRUNCATE match_tlk.direcciones_tlk_serv_cto_cgeo;
  TRUNCATE integrador.nap_physical_device;
  TRUNCATE carto.addresses_master, carto.address, carto.internal_address_access_point,
           carto.access_point, carto.internal_address, carto.territorial_unit_access_point,
           carto.compact_address, carto.comments_address, carto.plural_entity_access_point RESTART IDENTITY;
  DROP TABLE IF EXISTS carto.baja_direccion_operacion;
  ${AUDIT_TABLE_SQL}
  DROP TABLE IF EXISTS carto.address_notes;
  DROP TRIGGER IF EXISTS refuse_address_delete ON carto.address;
  DROP FUNCTION IF EXISTS carto.refuse_address_delete();
`;

export interface AddressFixture {
  readonly fuente: string;
  readonly idNumber: number;
  readonly province?: string;
  readonly idProvince?: number;
  readonly documentType?: string;
  readonly postalCode?: string | null;
  readonly padron?: string | null;
  readonly typePadron?: string | null;
  readonly padronLocality?: string | null;
  readonly streetName?: string | null;
  readonly number?: string | null;
  readonly letter?: string | null;
  readonly square?: string | null;
  readonly sandlot?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
}

export const DEFAULT_LAT = -33.461795;
export const DEFAULT_LNG = -56.730707;

export const DEFAULT_PARAMETERS: DuplicateAnalysisParameters = {
  detectionFuentes: [Fuente.ANTEL, Fuente.TLK, Fuente.IDE],
  provinceId: 7,
  removableFuentes: DedupRules.REMOVABLE_FUENTES,
  protectedFuentes: DedupRules.PROTECTED_FUENTES,
  geoDecimalsWithPadron: DedupRules.GEO_DECIMALS_WITH_PADRON,
  geoDecimalsWithoutPadron: DedupRules.GEO_DECIMALS_WITHOUT_PADRON,
  protectedSiblingRemovesLone: DedupRules.PROTECTED_SIBLING_REMOVES_LONE,
  scope: DedupRules.SCOPE,
};

export function urnOf(fuente: string, idNumber: number): string {
  return `${URN_PREFIX_BY_FUENTE[fuente] ?? `cgeo:${fuente}:address:id:`}${idNumber}`;
}

function pick<TValue>(value: TValue | undefined, fallback: TValue): TValue {
  return value === undefined ? fallback : value;
}

export async function createDedupDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(SCHEMA_SQL);
  return database;
}

export async function resetDedupDatabase(database: PGlite): Promise<void> {
  await database.exec(RESET_SQL);
}

/** Defaults describe a padron-only RURAL address in Flores; a fixture overrides what it tests. */
export async function insertAddress(database: PGlite, fixture: AddressFixture): Promise<string> {
  const urn = urnOf(fixture.fuente, fixture.idNumber);
  await database.query(
    `INSERT INTO carto.v_address_build
       (name_font, urn, name_province, code_province, postal_code, padron_number,
        type_padron, pad_cadastral_locality_name, rs_name, number, letter, square, sandlot,
        latitud, longitud, id_province, document_type)
     VALUES ($1, $2, $3, 'UY-FL', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      fixture.fuente,
      urn,
      pick(fixture.province, "FLORES"),
      pick(fixture.postalCode, "85000"),
      pick(fixture.padron, "4053"),
      pick(fixture.typePadron, "RURAL"),
      pick(fixture.padronLocality, null),
      pick(fixture.streetName, null),
      pick(fixture.number, "0"),
      pick(fixture.letter, null),
      pick(fixture.square, null),
      pick(fixture.sandlot, null),
      pick(fixture.lat, DEFAULT_LAT),
      pick(fixture.lng, DEFAULT_LNG),
      pick(fixture.idProvince, 7),
      pick(fixture.documentType, "PARENT"),
    ]
  );
  return urn;
}

export async function markMatchedInServCto(database: PGlite, urn: string): Promise<void> {
  await database.query("INSERT INTO match_tlk.direcciones_tlk_serv_cto_cgeo (urn) VALUES ($1)", [urn]);
}

export async function markMatchedInNapDevice(database: PGlite, urn: string): Promise<void> {
  await database.query("INSERT INTO integrador.nap_physical_device (urn_site_location) VALUES ($1)", [urn]);
}

export async function markHasInternalUnits(database: PGlite, urn: string): Promise<void> {
  const master = await database.query<{ addresses_master_id: number }>(
    "INSERT INTO carto.addresses_master (urn) VALUES ($1) RETURNING addresses_master_id",
    [urn]
  );
  const address = await database.query<{ id: number }>(
    "INSERT INTO carto.address (id_address_master) VALUES ($1) RETURNING id",
    [master.rows[0].addresses_master_id]
  );
  await database.query(
    "INSERT INTO carto.internal_address_access_point (id_access_point, id_internal_address) VALUES ($1, $2)",
    [address.rows[0].id, address.rows[0].id + 1000]
  );
}

export async function analyze(
  database: PGlite,
  overrides: Partial<DuplicateAnalysisParameters> = {}
): Promise<AnalysisRow[]> {
  return runDuplicateAnalysis(database, { ...DEFAULT_PARAMETERS, ...overrides });
}

export function findRow(rows: ReadonlyArray<AnalysisRow>, urn: string): AnalysisRow {
  const row = rows.find((candidate) => candidate.urn === urn);
  if (!row) {
    throw new Error(`Expected ${urn} in the output, got: ${rows.map((entry) => entry.urn).join(", ")}`);
  }
  return row;
}

export function urnsOf(rows: ReadonlyArray<AnalysisRow>): string[] {
  return rows.map((row) => row.urn);
}

export interface DoorRecords {
  readonly masterId: number;
  readonly addressId: number;
}

/** The full set of rows a door has in `carto`: master, address, access point, one territory, one compact address. */
export async function insertDoorRecords(database: PGlite, urn: string): Promise<DoorRecords> {
  const master = await database.query<{ addresses_master_id: number }>(
    "INSERT INTO carto.addresses_master (urn) VALUES ($1) RETURNING addresses_master_id",
    [urn]
  );
  const masterId = master.rows[0].addresses_master_id;
  const address = await database.query<{ id: number }>(
    "INSERT INTO carto.address (id_address_master) VALUES ($1) RETURNING id",
    [masterId]
  );
  const addressId = address.rows[0].id;
  await database.query("INSERT INTO carto.access_point (id) VALUES ($1)", [addressId]);
  await database.query(
    "INSERT INTO carto.territorial_unit_access_point (id_access_point, territory) VALUES ($1, 'T')",
    [addressId]
  );
  await database.query("INSERT INTO carto.compact_address (urn, compact) VALUES ($1, 'C')", [urn]);
  return { masterId, addressId };
}

export async function attachInternalUnit(database: PGlite, doorAddressId: number): Promise<void> {
  const internalId = doorAddressId + 1000;
  await database.query("INSERT INTO carto.internal_address (id) VALUES ($1)", [internalId]);
  await database.query(
    "INSERT INTO carto.internal_address_access_point (id_access_point, id_internal_address) VALUES ($1, $2)",
    [doorAddressId, internalId]
  );
}

export async function countRows(database: PGlite, qualifiedTable: string): Promise<number> {
  const result = await database.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${qualifiedTable}`);
  return result.rows[0].total;
}

export async function tableExists(database: PGlite, qualifiedTable: string): Promise<boolean> {
  const result = await database.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [qualifiedTable]
  );
  return result.rows[0].present;
}

/** What the removal tables hold, so a test can compare the world before and after. */
export async function snapshotCarto(database: PGlite): Promise<Record<string, number>> {
  const tables = [
    "addresses_master",
    "address",
    "access_point",
    "internal_address",
    "internal_address_access_point",
    "territorial_unit_access_point",
    "compact_address",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table] = await countRows(database, `carto.${table}`);
  return counts;
}

/** A PGlite-backed client that records every statement, so a test can assert the exact transaction. */
export class RecordingPgliteClient implements PgClientLike {
  public readonly calls: Array<{ readonly text: string; readonly values: unknown[] }> = [];
  public connectCount = 0;
  public endCount = 0;

  constructor(private readonly database: PGlite) {}

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }> {
    this.calls.push({ text, values });
    const result = await this.database.query(text, values);
    return { rows: result.rows };
  }

  on(): void {}

  async end(): Promise<void> {
    this.endCount += 1;
  }

  get statements(): string[] {
    return this.calls.map((call) => call.text);
  }

  statementsMatching(pattern: RegExp): string[] {
    return this.statements.filter((statement) => pattern.test(statement));
  }
}
