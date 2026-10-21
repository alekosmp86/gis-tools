import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  AvanceFileKind,
  FILE_PREFIX,
  type AvanceColumnKey,
  type AvanceFileKind as AvanceFileKindType,
} from "@/modules/coverage-loads/avance-ftth/constants";
import type { AvanceRow, ParsedAvanceFile } from "@/modules/coverage-loads/avance-ftth/types";
import { RecordingPgliteClient } from "../pgliteHarness";

/**
 * PGlite has no PostGIS. Geometry columns are `text` and the few ST_* functions the statements call
 * are stubs, so the statements under test run unchanged. The stubs are only meaningful for the
 * crafted values used here: `st_intersects` is substring overlap, the "intersection" is the shorter
 * text and the "area" is the text length, so overlap percentages are length ratios.
 */
const stagingTable = (name: string): string => `
  CREATE TABLE IF NOT EXISTS ${name} (
    gid serial PRIMARY KEY,
    central varchar(100), cable varchar(50), zona varchar(50), empresa varchar(50),
    plano_al_com varchar(50), ejecutor varchar(50), director varchar(50), etiqueta varchar(50),
    conca varchar(100), edificio varchar(20), fechaact text, fuente text,
    fechacarga date DEFAULT now()
  );`;

const SCHEMA_SQL = `
  CREATE SCHEMA IF NOT EXISTS historico;

  CREATE OR REPLACE FUNCTION st_multi(anyelement) RETURNS anyelement LANGUAGE sql AS 'select $1';
  CREATE OR REPLACE FUNCTION st_intersects(text, text) RETURNS boolean LANGUAGE sql AS
    'select $1 is not null and $2 is not null and (position($2 in $1) > 0 or position($1 in $2) > 0)';
  CREATE OR REPLACE FUNCTION st_intersection(text, text) RETURNS text LANGUAGE sql AS
    'select case when length($1) <= length($2) then $1 else $2 end';
  CREATE OR REPLACE FUNCTION st_area(text) RETURNS double precision LANGUAGE sql AS
    'select length($1)::double precision';

  ${stagingTable("public.avance_planilla_int")}
  ${stagingTable("public.avance_planilla_mvd")}

  CREATE TABLE IF NOT EXISTS public.avance_uruguay_planilla (
    gid serial PRIMARY KEY,
    central varchar(100), cable varchar(50), zona varchar(50), conca varchar(100), edificio varchar(20),
    empresa varchar(50), fecha varchar(50), director varchar(50), ejecutor varchar(50), estado varchar(50),
    geom text, fuente text, fechacarga date DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS historico.h_avance_uruguay (
    id serial PRIMARY KEY,
    central varchar(100), cable varchar(50), zona varchar(50), conca varchar(100), edificio varchar(20),
    empresa varchar(50), fecha varchar(50), director varchar(50), ejecutor varchar(50), estado varchar(50),
    fechacarga date, fecha_historico date DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.area_zonas_ftth_f (
    id_distrito integer, edificio varchar(10), identificacion_de_la_central text, codigo_distrito varchar(30),
    nombre_central text, cable text, zona text, conca text, situacion_distrito text,
    id_terminalfibraoptica text, codigo_terminalfibraoptica text, geom text
  );
  CREATE TABLE IF NOT EXISTS public.limite_central_ftth (geom text);
`;

const RESET_SQL = `
  TRUNCATE public.avance_planilla_int, public.avance_planilla_mvd, public.avance_uruguay_planilla,
           historico.h_avance_uruguay, public.area_zonas_ftth_f, public.limite_central_ftth RESTART IDENTITY;
`;

export async function createAvanceDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(SCHEMA_SQL);
  return database;
}

/** Idempotent: recreates anything a test dropped or renamed, so the next test starts from the full schema. */
export async function ensureAvanceSchema(database: PGlite): Promise<void> {
  await database.exec(SCHEMA_SQL);
}

export async function resetAvanceDatabase(database: PGlite): Promise<void> {
  await database.exec("RESET ROLE;");
  await database.exec(SCHEMA_SQL);
  await database.exec(RESET_SQL);
}

export const OLD_LOAD_DATE = "2020-01-15";

export interface ZoneSeed {
  readonly edificio: string;
  /** `C009Z04` style: `C`, three digits of cable, `Z`, two digits of zone. */
  readonly codigoDistrito: string;
  readonly status: string | null;
  readonly geom?: string;
  readonly idDistrito?: number;
}

export async function seedZones(database: PGlite, zones: ReadonlyArray<ZoneSeed>): Promise<void> {
  for (const zone of zones) {
    await database.query(
      `INSERT INTO public.area_zonas_ftth_f
         (id_distrito, edificio, identificacion_de_la_central, codigo_distrito, nombre_central, cable, zona, conca,
          situacion_distrito, id_terminalfibraoptica, codigo_terminalfibraoptica, geom)
       VALUES ($1, $2, 'IDC', $3::text, 'CENTRAL', substr($3::text, 2, 3), substr($3::text, 6, 2), $3::text, $4, 'T1', 'CT1', $5)`,
      [zone.idDistrito ?? 1, zone.edificio, zone.codigoDistrito, zone.status, zone.geom ?? `GEOM-${zone.codigoDistrito}`]
    );
  }
}

export interface AvanceSeed {
  readonly central?: string;
  readonly cable: string;
  readonly zona: string;
  readonly edificio: string;
  readonly estado?: string;
  readonly empresa?: string;
  readonly geom?: string;
  /** `YYYY-MM-DD`; `null` means "today by the database clock" (the column default). */
  readonly fechacarga: string | null;
}

export async function seedAvance(database: PGlite, rows: ReadonlyArray<AvanceSeed>): Promise<void> {
  for (const row of rows) {
    await database.query(
      `INSERT INTO public.avance_uruguay_planilla
         (central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, geom, fuente, fechacarga)
       VALUES ($1, $2, $3, 'CONCA', $4, $5, '01/01/2020', 'DIR', 'EJE', $6, $7, 'OLD-FUENTE', COALESCE($8::text::date, current_date))`,
      [
        row.central ?? "CENTRAL",
        row.cable,
        row.zona,
        row.edificio,
        row.empresa ?? "EMP",
        row.estado ?? "EJECUTADA",
        row.geom ?? "OLDGEOM",
        row.fechacarga,
      ]
    );
  }
}

export interface AvanceHistorySeed {
  readonly edificio: string;
  readonly cable: string;
  readonly zona: string;
  readonly estado: string;
  readonly fechacarga: string;
}

export async function seedHistoryRows(database: PGlite, rows: ReadonlyArray<AvanceHistorySeed>): Promise<void> {
  for (const row of rows) {
    await database.query(
      `INSERT INTO historico.h_avance_uruguay
         (central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, fechacarga)
       VALUES ('CENTRAL', $2, $3, 'CONCA', $1, 'EMP', '01/01/2019', 'DIR', 'EJE', $4, $5::text::date)`,
      [row.edificio, row.cable, row.zona, row.estado, row.fechacarga]
    );
  }
}

export interface PlanillaSeed {
  readonly edificio: string | null;
  readonly cable: string | null;
  readonly zona: string | null;
  readonly conca?: string | null;
  readonly etiqueta?: string | null;
}

export async function seedPlanillaRows(
  database: PGlite,
  kind: AvanceFileKindType,
  rows: ReadonlyArray<PlanillaSeed>
): Promise<void> {
  const table = kind === AvanceFileKind.INT ? "public.avance_planilla_int" : "public.avance_planilla_mvd";
  for (const row of rows) {
    await database.query(
      `INSERT INTO ${table} (central, cable, zona, empresa, plano_al_com, ejecutor, director, etiqueta, conca, edificio, fechaact, fuente)
       VALUES ('CENTRAL', $2, $3, 'EMP', '01/01/2020', 'EJE', 'DIR', $5, $4, $1, '01012020', 'OLD')`,
      [row.edificio, row.cable, row.zona, row.conca ?? "CONCA", row.etiqueta ?? "EJECUTADA"]
    );
  }
}

export async function installPrivileges(database: PGlite, grants: string, run: () => Promise<void>): Promise<void> {
  await database.exec(`
    CREATE ROLE avance_limited;
    GRANT USAGE ON SCHEMA historico, public TO avance_limited;
    ${grants}
    SET ROLE avance_limited;
  `);
  try {
    await run();
  } finally {
    await database.exec(`
      RESET ROLE;
      DROP OWNED BY avance_limited;
      DROP ROLE avance_limited;
    `);
  }
}

export async function selectRows<TRow extends object>(
  database: PGlite,
  sql: string,
  values: unknown[] = []
): Promise<TRow[]> {
  return (await database.query<TRow>(sql, values)).rows;
}

export async function countRows(database: PGlite, table: string): Promise<number> {
  const result = await database.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${table}`);
  return result.rows[0].total;
}

export interface TableSnapshot {
  readonly staging: unknown[];
  readonly stagingUdpem: unknown[];
  readonly avance: unknown[];
  readonly history: unknown[];
}

/** Everything the load writes, in a stable order, with dates as text. */
export async function snapshotAvanceTables(database: PGlite): Promise<TableSnapshot> {
  const dump = async (table: string, order: string) =>
    selectRows(database, `SELECT t.*, to_char(t.fechacarga, 'YYYY-MM-DD') AS fechacarga_text FROM ${table} t ORDER BY ${order}`);
  return {
    staging: await dump("public.avance_planilla_int", "gid"),
    stagingUdpem: await dump("public.avance_planilla_mvd", "gid"),
    avance: await dump("public.avance_uruguay_planilla", "gid"),
    history: await dump("historico.h_avance_uruguay", "id"),
  };
}

/** Records every statement and fails the nth one that matches `failOn`, as a dropped connection or a constraint would. */
export class FailingPgliteClient extends RecordingPgliteClient {
  private matches = 0;

  constructor(
    database: PGlite,
    private readonly failOn: RegExp,
    private readonly occurrence: number = 1,
    private readonly failure: Error = new Error("boom")
  ) {
    super(database);
  }

  override async query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }> {
    if (this.failOn.test(text.trim())) {
      this.matches += 1;
      if (this.matches === this.occurrence) {
        this.calls.push({ text, values });
        throw this.failure;
      }
    }
    return super.query(text, values);
  }
}

/**
 * PGlite is one session, so two concurrent transactions would interleave. A real server gives each
 * client its own connection; clients of one factory wait for the previous client to end.
 */
export function createSerializedClientFactory(database: PGlite): () => RecordingPgliteClient {
  let queue: Promise<void> = Promise.resolve();

  class SerializedClient extends RecordingPgliteClient {
    private release: () => void = () => undefined;

    override async connect(): Promise<void> {
      const previous = queue;
      const gate = new Promise<void>((resolve) => {
        this.release = resolve;
      });
      queue = previous.then(() => gate);
      await previous;
      await super.connect();
    }

    override async end(): Promise<void> {
      await super.end();
      this.release();
    }
  }

  return () => new SerializedClient(database);
}

export function makeRow(overrides: Partial<Record<AvanceColumnKey, string | null>> = {}): AvanceRow {
  return {
    central: "CENTRAL",
    cable: "01",
    zona: "01",
    empresa: "EMP",
    plano_al_com: "01/01/2020",
    ejecutor: "EJE",
    director: "DIR",
    etiqueta: "EJECUTADA",
    conca: "CONCA 01",
    edificio: "EDIF000001",
    ...overrides,
  };
}

export function makeParsedFile(
  kind: AvanceFileKindType,
  rows: ReadonlyArray<AvanceRow>,
  overrides: Partial<ParsedAvanceFile> = {}
): ParsedAvanceFile {
  const fechaact = overrides.fechaact ?? "21092026";
  return {
    kind,
    fileName: `${FILE_PREFIX[kind]}${fechaact}.csv`,
    fechaact,
    rows,
    rowsRead: rows.length,
    rejected: [],
    rejectedTotal: 0,
    junkRows: rows.filter((row) => row.conca?.startsWith("CZONA") === true).length,
    emptyEdificioRows: 0,
    duplicateKeys: 0,
    ...overrides,
  };
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

export function latin1(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "latin1"));
}

export const EDIF_ONE = "EDIF000001";
export const EDIF_TWO = "EDIF000002";
export const EDIF_MISSING = "EDIF000009";

export const STANDARD_ZONES: ReadonlyArray<ZoneSeed> = [
  { edificio: EDIF_ONE, codigoDistrito: "C001Z01", status: "Existente", geom: "GEOM-A" },
  { edificio: EDIF_ONE, codigoDistrito: "C001Z02", status: "Proyectado/Instalacion", geom: "GEOM-B" },
  { edificio: EDIF_TWO, codigoDistrito: "C001Z01", status: "Proyectado/Eliminacion", geom: "GEOM-C" },
];

export function rowFor(edificio: string, zona: string, overrides: Partial<Record<AvanceColumnKey, string | null>> = {}): AvanceRow {
  return makeRow({ edificio, cable: "01", zona, conca: `${edificio} ${zona}`, ...overrides });
}

/** Five INT rows (3 match a zone, 1 has none, 1 is DO) and two UDPEM rows (1 matches, 1 is Primario). */
export function standardFiles(): ParsedAvanceFile[] {
  return [
    makeParsedFile(AvanceFileKind.INT, [
      rowFor(EDIF_ONE, "01"),
      rowFor(EDIF_ONE, "02"),
      rowFor(EDIF_TWO, "01"),
      rowFor(EDIF_MISSING, "01"),
      rowFor(EDIF_ONE, "DO"),
    ]),
    makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "01"), rowFor(EDIF_ONE, "Primario")]),
  ];
}

/** A database that already holds an older load in all four tables, so a failed load has something to preserve. */
export async function seedPreviousLoad(database: PGlite): Promise<void> {
  await seedZones(database, STANDARD_ZONES);
  await seedPlanillaRows(database, AvanceFileKind.INT, [
    { edificio: "OLDINT1", cable: "01", zona: "01" },
    { edificio: "OLDINT2", cable: "01", zona: "02" },
  ]);
  await seedPlanillaRows(database, AvanceFileKind.UDPEM, [{ edificio: "OLDMVD1", cable: "01", zona: "01" }]);
  await seedAvance(database, [
    { cable: "001", zona: "01", edificio: EDIF_ONE, estado: "EN TRABAJO", fechacarga: OLD_LOAD_DATE },
    { cable: "001", zona: "02", edificio: EDIF_ONE, estado: "EJECUTADA", fechacarga: OLD_LOAD_DATE },
  ]);
  await seedHistoryRows(database, [{ edificio: "PREVIO", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2019-01-01" }]);
}
