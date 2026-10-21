import { PGlite } from "@electric-sql/pglite";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { PgSigraLayersRepository } from "@/modules/coverage-loads/sigra-layers/services/PgSigraLayersRepository";
import type { WfsFeature, WfsPage, WfsPageFetcher } from "@/modules/coverage-loads/sigra-layers/types";
import type { PgClientFactory } from "@/modules/coverage-loads/shared/pgClient";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { RecordingPgliteClient } from "../pgliteHarness";

/**
 * PGlite has no PostGIS. Geometry columns are `text` and the ST_* functions the load calls are SQL
 * stubs with deterministic, easy to recompute results:
 *   ST_GeomFromGeoJSON(t)  -> 'GJ:' || t          ST_SetSRID(g, n) -> 'SRID=' || n || ';' || g
 *   ST_Transform(g, n)     -> 'T' || n || ':' || g
 *   ST_Area(g) = length(g) + 0.12365               ST_X(g) = length(g) + 0.5    ST_Y(g) = length(g) + 0.25
 * so a stored geometry is `SRID=31981;GJ:<the GeoJSON text that was bound>`.
 */
const STUBS_SQL = `
  CREATE FUNCTION st_geomfromgeojson(text) RETURNS text LANGUAGE sql AS $f$ SELECT 'GJ:' || $1 $f$;
  CREATE FUNCTION st_setsrid(text, integer) RETURNS text LANGUAGE sql AS $f$ SELECT 'SRID=' || $2 || ';' || $1 $f$;
  CREATE FUNCTION st_transform(text, integer) RETURNS text LANGUAGE sql AS $f$ SELECT 'T' || $2 || ':' || $1 $f$;
  CREATE FUNCTION st_area(text) RETURNS double precision LANGUAGE sql AS $f$ SELECT length($1)::double precision + 0.12365 $f$;
  CREATE FUNCTION st_x(text) RETURNS double precision LANGUAGE sql AS $f$ SELECT length($1)::double precision + 0.5 $f$;
  CREATE FUNCTION st_y(text) RETURNS double precision LANGUAGE sql AS $f$ SELECT length($1)::double precision + 0.25 $f$;
`;

/** Final tables as in production: a `gid serial`, columns the load never writes, and per-layer quirks. */
const TABLES_SQL = `
  CREATE TABLE public.area_zonas_ftth_f (
    gid serial PRIMARY KEY,
    id_distrito integer, edificio varchar(10), identificacion_de_la_central text, codigo_distrito varchar(30),
    nombre_central text, cable text, zona text, conca text, situacion_distrito text,
    id_terminalfibraoptica text, codigo_terminalfibraoptica text, situacion_geom text,
    x double precision, txt_geometria text, fechaact date, fuente text, geom text
  );
  CREATE TABLE public.limite_central_ftth (
    gid serial PRIMARY KEY,
    id_area integer, edificio text, id_sitio integer, codigo_sitio text, nombre_central_ftth text,
    cr_site_ty integer, area_m2 double precision, direccion text, fechaact timestamp, fuente text, geom text
  );
  CREATE TABLE public.area_cable_ftth_f (
    gid serial PRIMARY KEY,
    id_area integer, edificio text, identificacion_central text, nombre_central text, codigo text,
    situacion text, tipo_area text, area_m2 numeric, txt_geometria text, fechaact date, fuente text, geom text
  );
  CREATE TABLE public.area_cajitas_f (
    gid serial PRIMARY KEY,
    id_area integer, codigo_area text, central_nombre text, edificio text, situacion text,
    id_cajita integer, codigo_cajita text, caja_de_distribucion text, fechaact date, geometry text
  );
  CREATE TABLE public.tfo_divisores (
    gid serial PRIMARY KEY,
    id_terminalfibra text, edificio_terminalfibra text, cable_terminalfibra text, zona_terminalfibra text,
    codigo_terminalfibra text, situacion_terminalfibra text, observacion text, codigo_divisoroptico text,
    situacion_divisoroptico text, fechacarga date, fuente text, geom text
  );
  CREATE TABLE public.centrales_ftth (
    gid serial PRIMARY KEY,
    id_sitio integer, codigo_sitio text, nombre_central_ftth text, rotation double precision,
    tipo_de_central text, edificio text, direccion text, departamento text, localidad text,
    x double precision, y double precision, status text, fechaact date, fuente text, geom text
  );
  CREATE TABLE public.postes (
    gid serial PRIMARY KEY,
    id_sgra integer, tipo text, codigo_sga text, altura numeric, material text, situacion text,
    perforada text, base_hormigonada text, rotation double precision, latitud double precision,
    longitud double precision, direccion text, fechaact date, fuente text, geom text
  );
  CREATE TABLE public.etl_auditoria (
    id_auditoria serial PRIMARY KEY,
    etl_nombre varchar(100), fecha_inicio timestamp DEFAULT now(), fecha_fin timestamp, estado varchar(20),
    registros_extraidos integer, registros_insertados integer, transform_error text, paso_error text,
    mensaje_error text, usuario_db varchar(100) DEFAULT current_user
  );
`;

const LIMITED_ROLE = "sigra_limited";

const DROP_LIMITED_ROLE_SQL = `
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LIMITED_ROLE}') THEN
      DROP OWNED BY ${LIMITED_ROLE};
      DROP ROLE ${LIMITED_ROLE};
    END IF;
  END $$;
`;

export const PASSWORD = "s3cret-password";
export const CONNECTION: DbConnection = { host: "db.example", port: 5432, db_name: "carto", user: "operator", password: PASSWORD };

/** The representative subset of the registry the PGlite schema models. */
export const TestLayer = {
  ZONAS: SigraLayerId.ZONAS_FTTH,
  LIMITE_CENTRAL: SigraLayerId.LIMITE_CENTRAL_FTTH,
  CABLE_FTTH: SigraLayerId.AREA_CABLE_FTTH,
  CAJITAS: SigraLayerId.AREA_CAJITAS_COBRE,
  TFO: SigraLayerId.TFO_DIVISORES,
  CENTRALES: SigraLayerId.CENTRALES_FTTH,
  POSTES: SigraLayerId.POSTES,
} as const;

export type TestLayerId = (typeof TestLayer)[keyof typeof TestLayer];

export const TEST_LAYER_IDS: ReadonlyArray<TestLayerId> = Object.values(TestLayer);

/** Column holding the row identity in the final table (tfo-divisores has no `spid` there). */
const SEED_KEY_COLUMN: Readonly<Record<TestLayerId, string>> = {
  [TestLayer.ZONAS]: "id_distrito",
  [TestLayer.LIMITE_CENTRAL]: "id_area",
  [TestLayer.CABLE_FTTH]: "id_area",
  [TestLayer.CAJITAS]: "id_area",
  [TestLayer.TFO]: "id_terminalfibra",
  [TestLayer.CENTRALES]: "id_sitio",
  [TestLayer.POSTES]: "id_sgra",
};

const DATE_COLUMN: Readonly<Record<TestLayerId, "fechaact" | "fechacarga">> = {
  [TestLayer.ZONAS]: "fechaact",
  [TestLayer.LIMITE_CENTRAL]: "fechaact",
  [TestLayer.CABLE_FTTH]: "fechaact",
  [TestLayer.CAJITAS]: "fechaact",
  [TestLayer.TFO]: "fechacarga",
  [TestLayer.CENTRALES]: "fechaact",
  [TestLayer.POSTES]: "fechaact",
};

export const finalTableOf = (layerId: TestLayerId): string => getSigraLayer(layerId).finalTable;
export const gidSequenceOf = (layerId: TestLayerId): string => `${finalTableOf(layerId)}_gid_seq`;

const FINAL_TABLES: ReadonlyArray<string> = TEST_LAYER_IDS.map(finalTableOf);

const OLD_DATE = "2020-01-15";

async function currentDatabaseName(database: PGlite): Promise<string> {
  return (await database.query<{ name: string }>("SELECT current_database() AS name")).rows[0].name;
}

export async function createSigraDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await resetSigraDatabase(database);
  return database;
}

/** Drops everything the tests (or a failed test) may have changed and rebuilds the full schema. */
export async function resetSigraDatabase(database: PGlite): Promise<void> {
  await database.exec("RESET ROLE;");
  await database.exec(DROP_LIMITED_ROLE_SQL);
  await database.exec(`GRANT TEMP ON DATABASE ${await currentDatabaseName(database)} TO PUBLIC;`);
  await database.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
  await database.exec(STUBS_SQL);
  await database.exec(TABLES_SQL);
}

export interface SeedOptions {
  readonly count: number;
  readonly firstKey?: number;
  /** `YYYY-MM-DD`. */
  readonly date?: string;
}

/** Old content of a final table: `count` rows with consecutive keys and the given load date. */
export async function seedFinalRows(database: PGlite, layerId: TestLayerId, options: SeedOptions): Promise<void> {
  const first = options.firstKey ?? 1;
  await database.query(
    `INSERT INTO ${finalTableOf(layerId)} (${SEED_KEY_COLUMN[layerId]}, ${DATE_COLUMN[layerId]})
     SELECT g, $1::text::date FROM generate_series($2::int, $3::int) AS g`,
    [options.date ?? OLD_DATE, first, first + options.count - 1],
  );
}

/** One old row per date, keys 1..n, to check the "last update" read. */
export async function seedFinalRowsDated(database: PGlite, layerId: TestLayerId, dates: ReadonlyArray<string>): Promise<void> {
  for (const [index, date] of dates.entries()) {
    await seedFinalRows(database, layerId, { count: 1, firstKey: index + 1, date });
  }
}

async function selectRows<TRow extends object>(database: PGlite, sql: string, values: unknown[] = []): Promise<TRow[]> {
  return (await database.query<TRow>(sql, values)).rows;
}

export type StoredRow = Record<string, unknown>;

/** Every column of a final table as JSON (dates as text), ordered by gid. */
export async function finalRows(database: PGlite, layerId: TestLayerId): Promise<StoredRow[]> {
  const rows = await selectRows<{ r: StoredRow }>(database, `SELECT to_jsonb(t) AS r FROM ${finalTableOf(layerId)} t ORDER BY gid`);
  return rows.map((row) => row.r);
}

export async function snapshotFinalTables(database: PGlite): Promise<Record<string, StoredRow[]>> {
  const snapshot: Record<string, StoredRow[]> = {};
  for (const layerId of TEST_LAYER_IDS) snapshot[finalTableOf(layerId)] = await finalRows(database, layerId);
  return snapshot;
}

/** Consumes one value of the final table's `gid` sequence and returns it. */
export async function nextGid(database: PGlite, layerId: TestLayerId): Promise<number> {
  return (await selectRows<{ value: number }>(database, `SELECT nextval('${gidSequenceOf(layerId)}')::int AS value`))[0].value;
}

export async function todayText(database: PGlite): Promise<string> {
  return (await selectRows<{ today: string }>(database, "SELECT to_char(current_date, 'YYYY-MM-DD') AS today"))[0].today;
}

export async function temporaryTableCount(database: PGlite): Promise<number> {
  return (await selectRows<{ total: number }>(database, "SELECT count(*)::int AS total FROM pg_class WHERE relpersistence = 't'"))[0].total;
}

export interface AuditRow {
  readonly id_auditoria: number;
  readonly etl_nombre: string;
  readonly estado: string;
  readonly finished: boolean;
  readonly registros_extraidos: number | null;
  readonly registros_insertados: number | null;
  readonly transform_error: string | null;
  readonly paso_error: string | null;
  readonly mensaje_error: string | null;
}

export async function auditRows(database: PGlite): Promise<AuditRow[]> {
  return selectRows<AuditRow>(
    database,
    `SELECT id_auditoria, etl_nombre, estado, fecha_fin IS NOT NULL AS finished, registros_extraidos,
            registros_insertados, transform_error, paso_error, mensaje_error
     FROM public.etl_auditoria ORDER BY id_auditoria`,
  );
}

export const ALL_FINAL_TABLE_GRANTS = `
  GRANT SELECT, INSERT, DELETE ON ${FINAL_TABLES.join(", ")} TO ${LIMITED_ROLE};
  GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${LIMITED_ROLE};
`;

export const AUDIT_GRANTS = `GRANT SELECT, INSERT, UPDATE ON public.etl_auditoria TO ${LIMITED_ROLE};`;

/** Runs `run` as a role that holds only `grants`; always restores the superuser afterwards. */
export async function withSigraRole(database: PGlite, grants: string, run: () => Promise<void>): Promise<void> {
  await database.exec(`
    CREATE ROLE ${LIMITED_ROLE};
    GRANT USAGE ON SCHEMA public TO ${LIMITED_ROLE};
    ${grants}
    SET ROLE ${LIMITED_ROLE};
  `);
  try {
    await run();
  } finally {
    await database.exec(`RESET ROLE;`);
    await database.exec(DROP_LIMITED_ROLE_SQL);
  }
}

/** Takes TEMP away from everybody; the next `resetSigraDatabase` gives it back. */
export async function revokeTempPrivilege(database: PGlite): Promise<void> {
  await database.exec(`REVOKE TEMP ON DATABASE ${await currentDatabaseName(database)} FROM PUBLIC;`);
}

// ---------------------------------------------------------------------------------------------
// WFS features and the scripted fetcher

const polygonOf = (n: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [n, 0],
      [n, 1],
      [n + 1, 1],
      [n, 0],
    ],
  ],
});

/** What the stubbed ST_SetSRID(ST_GeomFromGeoJSON(<bound GeoJSON text>), 31981) stores for a feature. */
export function storedGeometry(feature: WfsFeature): string | null {
  return feature.geometry === null || feature.geometry === undefined ? null : `SRID=31981;GJ:${JSON.stringify(feature.geometry)}`;
}

export type Overrides = Readonly<Record<string, unknown>>;

function feature(properties: Record<string, unknown>, overrides: Overrides, geometry: unknown): WfsFeature {
  return { geometry, properties: { ...properties, ...overrides } };
}

export const zonaFeature = (n: number, overrides: Overrides = {}, geometry: unknown = polygonOf(n)): WfsFeature =>
  feature(
    {
      ID_AREA: n,
      EDIFICIO: "ABCDEFGHIJKLM",
      CODIGO_AREA: "C009Z04",
      CENTRAL_NOMBRE: "AGUADA FTTH",
      SITUACION: "Existente",
      ID_EMPALME: `EMP-${n}`,
      CODIGO_EMPALME: `CEMP-${n}`,
      SITUACION_GEOM: "Valida",
      OT_ACTUAL_CODIGO: "OT-1",
    },
    overrides,
    geometry,
  );

export const limiteCentralFeature = (n: number, overrides: Overrides = {}, geometry: unknown = polygonOf(n)): WfsFeature =>
  feature(
    { ID_AREA: n, EDIFICIO: "EDIF1234", ID_SITIO: 500 + n, CENTRAL_NOMBRE: "AGUADA FTTH", CR_SITE_TYPE_ID: 9 },
    overrides,
    geometry,
  );

export const cableFtthFeature = (n: number, overrides: Overrides = {}, geometry: unknown = polygonOf(n)): WfsFeature =>
  feature(
    {
      ID_AREA: n,
      EDIFICIO: "ED1",
      IDENTIFICACION_CENTRAL: "IDC",
      NOMBRE_CENTRAL: "CENTRAL X",
      CODIGO: "COD",
      SITUACION: "Existente",
      TIPO_AREA: "Primaria",
    },
    overrides,
    geometry,
  );

export const cajitasFeature = (n: number, overrides: Overrides = {}, geometry: unknown = polygonOf(n)): WfsFeature =>
  feature(
    {
      ID_AREA: n,
      CODIGO_AREA: `CA-${n}`,
      CENTRAL_NOMBRE: "AGUADA",
      EDIFICIO: "ED2",
      SITUACION: "Existente",
      ID_CAJITA: 700 + n,
      CODIGO_CAJITA: `CJ-${n}`,
      CAJA_DE_DISTRIBUCION: "CD-1",
    },
    overrides,
    geometry,
  );

export const tfoFeature = (spid: number, tfoId: string, overrides: Overrides = {}, geometry: unknown = polygonOf(spid)): WfsFeature =>
  feature(
    {
      SPID: spid,
      TFOID: tfoId,
      TFOEDIFICIO: "TED",
      TFOCABLE: "009",
      TFOZONA: "04",
      TFOCODIGO: "T-009-04",
      TFOSTATUS: "Instalado",
      TFOOBS: "sin observaciones",
      DIVISOR: "DIV-1",
      DIVISORSTATUS: "Activo",
    },
    overrides,
    geometry,
  );

export const centralFtthFeature = (n: number, overrides: Overrides = {}, geometry: unknown = polygonOf(n)): WfsFeature =>
  feature(
    { ID: n, EDIFICIO: "EDIF-C", NOMBRE: "CENTRO FTTH", ROTATION: 12.5, TIPO_DE_CENTRAL: "CENTRAL FTTH" },
    overrides,
    geometry,
  );

export const posteFeature = (n: number, overrides: Overrides = {}, geometry: unknown = polygonOf(n)): WfsFeature =>
  feature(
    {
      ID: n,
      TIPO: "Hormigon",
      CODIGO_SGA: `P-${n}`,
      ALTURA: 9.5,
      MATERIAL: "Hormigon",
      SITUACION: "Existente",
      PERFORADA: "SI",
      BASE_HORMIGONADA: true,
      ROTATION: 45,
    },
    overrides,
    geometry,
  );

/** `count` features with consecutive keys starting at `firstKey`. */
export function manyFeatures(count: number, build: (key: number) => WfsFeature, firstKey = 1): WfsFeature[] {
  return Array.from({ length: count }, (_unused, index) => build(firstKey + index));
}

export type ScriptedPage = ReadonlyArray<WfsFeature> | Error;

/** Page i is the answer to `startIndex = i * pageSize`; an Error entry makes that request fail; anything else is a test bug. */
export class ScriptedFetcher implements WfsPageFetcher {
  public readonly urls: string[] = [];

  constructor(
    private readonly pages: ReadonlyArray<ScriptedPage>,
    private readonly pageSize: number,
  ) {}

  get startIndexes(): number[] {
    return this.urls.map((url) => Number(new URL(url).searchParams.get("startIndex")));
  }

  async fetchPage(url: string): Promise<WfsPage> {
    this.urls.push(url);
    const startIndex = Number(new URL(url).searchParams.get("startIndex"));
    const page = this.pages[startIndex / this.pageSize];
    if (page === undefined) throw new Error(`Unscripted WFS page requested: startIndex=${startIndex}`);
    if (page instanceof Error) throw page;
    return { features: page, numberMatched: null };
  }
}

export const fetcherFor = (layerId: TestLayerId, ...pages: ScriptedPage[]): ScriptedFetcher =>
  new ScriptedFetcher(pages, getSigraLayer(layerId).pageSize);

// ---------------------------------------------------------------------------------------------
// Recording clients and the repository rig

export interface LogEntry {
  readonly client: number;
  readonly sql: string;
  readonly values: unknown[];
}

export interface FailureRule {
  readonly pattern: RegExp;
  /** The nth statement matching `pattern` (across all clients of the rig) fails. Default 1. */
  readonly occurrence?: number;
  readonly error?: Error;
}

interface SharedState {
  readonly log: LogEntry[];
  readonly fail: FailureRule | undefined;
  readonly connectError: Error | undefined;
  matches: number;
}

class SigraClient extends RecordingPgliteClient {
  constructor(
    database: PGlite,
    private readonly index: number,
    private readonly shared: SharedState,
  ) {
    super(database);
  }

  override async connect(): Promise<void> {
    if (this.shared.connectError) throw this.shared.connectError;
    await super.connect();
  }

  override async query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }> {
    this.shared.log.push({ client: this.index, sql: text.trim(), values });
    const rule = this.shared.fail;
    if (rule?.pattern.test(text.trim())) {
      this.shared.matches += 1;
      if (this.shared.matches === (rule.occurrence ?? 1)) throw rule.error ?? new Error("boom");
    }
    return super.query(text, values);
  }
}

export interface RigOptions {
  readonly fail?: FailureRule;
  /** Every client's `connect` rejects with this. */
  readonly connectError?: Error;
  /** The client factory itself throws. */
  readonly factoryError?: Error;
  readonly clock?: () => number;
}

export interface LoadTransaction {
  readonly client: number;
  readonly begin: number;
  readonly end: number;
  readonly statements: string[];
}

export interface Rig {
  readonly repository: PgSigraLayersRepository;
  readonly fetcher: WfsPageFetcher;
  readonly log: LogEntry[];
  readonly clients: RecordingPgliteClient[];
  statements(): string[];
  /** The BEGIN ... COMMIT|ROLLBACK block of the client that created the TEMP staging table, or null when none was created. */
  loadTransaction(): LoadTransaction | null;
}

const SQL_BEGIN = /^BEGIN/i;
const SQL_END = /^(COMMIT|ROLLBACK)\b/i;
const CREATE_TEMP_TABLE = /^CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE/i;

/** 750 ms between the first and every later reading. */
export const steadyClock = (): (() => number) => {
  let readings = 0;
  return () => (readings++ === 0 ? 1000 : 1750);
};

export function createRig(database: PGlite, fetcher: WfsPageFetcher, options: RigOptions = {}): Rig {
  const shared: SharedState = { log: [], fail: options.fail, connectError: options.connectError, matches: 0 };
  const clients: RecordingPgliteClient[] = [];
  const createClient: PgClientFactory = () => {
    if (options.factoryError) throw options.factoryError;
    const client = new SigraClient(database, clients.length, shared);
    clients.push(client);
    return client;
  };
  const repository = new PgSigraLayersRepository({ createClient, fetcher, now: options.clock ?? steadyClock() });

  return {
    repository,
    fetcher,
    log: shared.log,
    clients,
    statements: () => shared.log.map((entry) => entry.sql),
    loadTransaction: () => {
      const created = shared.log.findIndex((entry) => CREATE_TEMP_TABLE.test(entry.sql));
      if (created === -1) return null;
      const client = shared.log[created].client;
      const ownEntries = shared.log.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.client === client);
      const begin = ownEntries.filter(({ entry, index }) => index < created && SQL_BEGIN.test(entry.sql)).at(-1);
      const end = ownEntries.find(({ entry, index }) => index > created && SQL_END.test(entry.sql));
      if (!begin) throw new Error("The TEMP staging table was created outside a transaction.");
      const last = end?.index ?? shared.log.length - 1;
      return {
        client,
        begin: begin.index,
        end: last,
        statements: ownEntries.filter(({ index }) => index >= begin.index && index <= last).map(({ entry }) => entry.sql),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Statement matchers (quotes around identifiers are tolerated; nothing else about the formatting is)

const identifierPattern = (qualified: string): string =>
  qualified
    .split(".")
    .map((part) => `"?${part}"?`)
    .join("\\.");

export const lockStatement = (table: string): RegExp =>
  new RegExp(`^LOCK TABLE\\s+(ONLY\\s+)?${identifierPattern(table)}\\s+IN SHARE ROW EXCLUSIVE MODE\\s*;?$`, "i");

export const deleteStatement = (table: string): RegExp => new RegExp(`^DELETE FROM\\s+(ONLY\\s+)?${identifierPattern(table)}\\s*;?$`, "i");

export const swapInsertStatement = (table: string): RegExp => new RegExp(`INSERT INTO\\s+${identifierPattern(table)}\\s*\\((?![\\s\\S]*ON CONFLICT)`, "i");

/** An INSERT into the staging table: any target outside `public.` with an ON CONFLICT clause. */
export const PAGE_INSERT = /INSERT INTO\s+(?!"?public"?\.)[\s\S]*ON CONFLICT/i;
export const AUDIT_INSERT = /INSERT INTO\s+"?public"?\."?etl_auditoria"?/i;
export const AUDIT_UPDATE = /^UPDATE\s+"?public"?\."?etl_auditoria"?/i;
export const ANY_LOCK = /^LOCK TABLE/i;
export const ANY_SHARE_ROW_EXCLUSIVE = /SHARE ROW EXCLUSIVE/i;

export function indexOfMatch(statements: ReadonlyArray<string>, pattern: RegExp, from = 0): number {
  for (let index = from; index < statements.length; index += 1) if (pattern.test(statements[index])) return index;
  return -1;
}

export function lastIndexOfMatch(statements: ReadonlyArray<string>, pattern: RegExp): number {
  for (let index = statements.length - 1; index >= 0; index -= 1) if (pattern.test(statements[index])) return index;
  return -1;
}

/** True when the statement at `logIndex` ran outside any open transaction of its client, or is closed by an immediate COMMIT. */
export function isAutocommitted(log: ReadonlyArray<LogEntry>, logIndex: number): boolean {
  const own = log.filter((entry) => entry.client === log[logIndex].client);
  const position = own.indexOf(log[logIndex]);
  let open = false;
  for (const entry of own.slice(0, position)) {
    if (SQL_BEGIN.test(entry.sql)) open = true;
    else if (SQL_END.test(entry.sql)) open = false;
  }
  return !open || /^COMMIT/i.test(own[position + 1]?.sql ?? "");
}
