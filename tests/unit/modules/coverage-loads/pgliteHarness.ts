import { PGlite } from "@electric-sql/pglite";
import type { PgClientLike } from "@/modules/coverage-loads/shared/pgClient";

/** The documented shape of the two tables the tool writes (PLAN section 3.2), created by the harness. */
const TABLES_SQL = `
  CREATE TABLE historico.h_cobertura_lte_localidad (
    id serial PRIMARY KEY,
    nombdepto varchar(15),
    nombloc varchar(40),
    arealoclte double precision,
    porcentajecobertura numeric,
    cobertura_lte varchar(2),
    fechaact date,
    fecha_historico date,
    usuario varchar(40)
  );
  CREATE TABLE public.indicadores_lte (
    id serial PRIMARY KEY,
    nombdepto text,
    nombloc text,
    cobertura_lte text,
    fechacarga date,
    fechaact text,
    fuente text,
    porcentaje text
  );
`;

const DROP_TABLES_SQL = `
  DROP TABLE IF EXISTS historico.h_cobertura_lte_localidad;
  DROP TABLE IF EXISTS public.indicadores_lte;
`;

export async function createCoverageDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec("CREATE SCHEMA historico;");
  await database.exec(TABLES_SQL);
  return database;
}

export async function resetCoverageDatabase(database: PGlite): Promise<void> {
  await database.exec("RESET ROLE;");
  await database.exec(DROP_TABLES_SQL);
  await database.exec(TABLES_SQL);
}

export interface HistorySeed {
  readonly departamento: string;
  readonly localidad: string;
  readonly porcentaje: string;
  readonly cobertura: string;
  readonly fechaact: string;
}

export async function seedHistory(database: PGlite, rows: ReadonlyArray<HistorySeed>): Promise<void> {
  for (const row of rows) {
    await database.query(
      `INSERT INTO historico.h_cobertura_lte_localidad
         (nombdepto, nombloc, porcentajecobertura, cobertura_lte, fechaact, fecha_historico, usuario)
       VALUES ($1, $2, $3::text::numeric, $4, $5::text::date, '2000-01-01'::date, 'SEED')`,
      [row.departamento, row.localidad, row.porcentaje, row.cobertura, row.fechaact]
    );
  }
}

export interface StoredHistoryRow {
  readonly id: number;
  readonly nombdepto: string;
  readonly nombloc: string;
  readonly porcentajecobertura: string;
  readonly cobertura_lte: string;
  readonly fechaact: string;
  readonly fecha_historico: string;
  readonly usuario: string;
}

/** Dates are read as text, exactly as the production code does. */
export async function readHistory(database: PGlite, fechaact?: string): Promise<StoredHistoryRow[]> {
  const result = await database.query<StoredHistoryRow>(
    `SELECT id, nombdepto, nombloc, porcentajecobertura::text AS porcentajecobertura, cobertura_lte,
            to_char(fechaact, 'YYYY-MM-DD') AS fechaact,
            to_char(fecha_historico, 'YYYY-MM-DD') AS fecha_historico, usuario
     FROM historico.h_cobertura_lte_localidad
     WHERE $1::text IS NULL OR fechaact = $1::text::date
     ORDER BY id`,
    [fechaact ?? null]
  );
  return result.rows;
}

export interface StagingRow {
  readonly nombdepto: string;
  readonly nombloc: string;
  readonly cobertura_lte: string;
  readonly fechaact: string;
  readonly fuente: string;
  readonly porcentaje: string;
}

export async function readStaging(database: PGlite): Promise<StagingRow[]> {
  const result = await database.query<StagingRow>(
    `SELECT nombdepto, nombloc, cobertura_lte, fechaact, fuente, porcentaje
     FROM public.indicadores_lte ORDER BY id`
  );
  return result.rows;
}

export async function seedStaging(database: PGlite, rows: ReadonlyArray<StagingRow>): Promise<void> {
  for (const row of rows) {
    await database.query(
      `INSERT INTO public.indicadores_lte (nombdepto, nombloc, cobertura_lte, fechaact, fuente, porcentaje)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.nombdepto, row.nombloc, row.cobertura_lte, row.fechaact, row.fuente, row.porcentaje]
    );
  }
}

export async function countHistory(database: PGlite, fechaact?: string): Promise<number> {
  return (await readHistory(database, fechaact)).length;
}

/** Everything the tool can write, so a test can compare the world before and after a failed load. */
export async function snapshotTables(database: PGlite): Promise<{
  readonly history: StoredHistoryRow[];
  readonly staging: StagingRow[];
}> {
  return { history: await readHistory(database), staging: await readStaging(database) };
}

/** True when every history row of the date carries today's date as `fecha_historico`. */
export async function allStampedToday(database: PGlite, fechaact: string): Promise<boolean> {
  const result = await database.query<{ ok: boolean }>(
    `SELECT bool_and(fecha_historico = CURRENT_DATE) AS ok
     FROM historico.h_cobertura_lte_localidad WHERE fechaact = $1::text::date`,
    [fechaact]
  );
  return result.rows[0].ok;
}

/** Runs `run` as a role that holds only `grants`; always restores the superuser afterwards. */
export async function withLimitedRole(database: PGlite, grants: string, run: () => Promise<void>): Promise<void> {
  await database.exec(`
    CREATE ROLE app_limited;
    GRANT USAGE ON SCHEMA historico, public TO app_limited;
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
    return this.calls.map((call) => call.text.trim());
  }

  statementsMatching(pattern: RegExp): string[] {
    return this.statements.filter((statement) => pattern.test(statement));
  }
}
