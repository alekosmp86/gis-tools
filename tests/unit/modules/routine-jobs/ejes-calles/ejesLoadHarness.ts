import type { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { EJES_DEFAULT_TABLES, EJES_LOAD_ROLES, EJES_REQUIRED_COLUMNS_BY_ROLE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesLoadContextOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadContext";
import { summaryOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import type { EjesLoadContext, EjesParams, EjesSummary } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { ejesLayouts, ejesTables } from "./ejesFixtures";

export type Row = Record<string, unknown>;

export const PASSWORD = "Ejes-Load-pw!7";

/**
 * No PostGIS: a geometry is the text "a:b" of one street line (or "a:b|c:d" for several parts). The length is b - a, two lines are
 * within d when the gap between them is at most d, and the Hausdorff distance of two lines is the larger difference of their ends.
 */
const POSTGIS_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION iv_a(geometry) RETURNS float8 AS $$ SELECT split_part(split_part($1::text, '|', 1), ':', 1)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION iv_b(geometry) RETURNS float8 AS $$ SELECT split_part(split_part($1::text, '|', 1), ':', 2)::float8 $$ LANGUAGE sql;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS $$ SELECT $1::text = '' $$ LANGUAGE sql;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS $$ SELECT $1::text NOT LIKE 'BAD%' $$ LANGUAGE sql;
  CREATE FUNCTION ST_XMin(geometry) RETURNS float8 AS $$ SELECT iv_a($1) $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_SetSRID(geometry, integer) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_LineMerge(geometry) RETURNS geometry AS $$
    SELECT CASE
      WHEN array_length(string_to_array($1::text, '|'), 1) = 2
        AND split_part((string_to_array($1::text, '|'))[1], ':', 2) = split_part((string_to_array($1::text, '|'))[2], ':', 1)
      THEN (split_part((string_to_array($1::text, '|'))[1], ':', 1) || ':' || split_part((string_to_array($1::text, '|'))[2], ':', 2))::geometry
      ELSE $1 END
  $$ LANGUAGE sql;
  CREATE FUNCTION GeometryType(geometry) RETURNS text AS $$ SELECT CASE WHEN position('|' in $1::text) > 0 THEN 'MULTILINESTRING' ELSE 'LINESTRING' END $$ LANGUAGE sql;
  CREATE FUNCTION ST_Length(geometry) RETURNS float8 AS $$
    SELECT CASE WHEN $1::text ~ '^[0-9.:|-]+$' THEN (SELECT sum(split_part(p, ':', 2)::float8 - split_part(p, ':', 1)::float8) FROM unnest(string_to_array($1::text, '|')) AS p) END
  $$ LANGUAGE sql;
  CREATE FUNCTION ST_AsEWKB(geometry) RETURNS bytea AS $$ SELECT convert_to($1::text, 'UTF8') $$ LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS integer AS $$ SELECT 32721 $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_Distance(geometry, geometry) RETURNS float8
    AS $$ SELECT greatest(0, greatest(iv_a($1), iv_a($2)) - least(iv_b($1), iv_b($2))) $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_Normalize(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_MakeValid(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_SnapToGrid(geometry, float8) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql;
  CREATE FUNCTION ST_OrderingEquals(geometry, geometry) RETURNS boolean AS $$ SELECT $1::text = $2::text $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8
    AS $$ SELECT greatest(abs(iv_a($1) - iv_a($2)), abs(iv_b($1) - iv_b($2))) $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_DWithin(geometry, geometry, float8) RETURNS boolean
    AS $$ SELECT greatest(iv_a($1), iv_a($2)) - least(iv_b($1), iv_b($2)) <= $3 $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_Intersects(geometry, geometry) RETURNS boolean
    AS $$ SELECT greatest(iv_a($1), iv_a($2)) <= least(iv_b($1), iv_b($2)) $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS $$
    SELECT CASE WHEN greatest(iv_a($1), iv_a($2)) <= least(iv_b($1), iv_b($2))
      THEN (greatest(iv_a($1), iv_a($2))::text || ':' || least(iv_b($1), iv_b($2))::text)::geometry ELSE '0:0'::geometry END
  $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_Buffer(geometry, float8) RETURNS geometry AS $$ SELECT ((iv_a($1) - $2)::text || ':' || (iv_b($1) + $2)::text)::geometry $$ LANGUAGE sql STRICT;
  CREATE FUNCTION ST_Expand(geometry, float8) RETURNS geometry AS $$ SELECT ((iv_a($1) - $2)::text || ':' || (iv_b($1) + $2)::text)::geometry $$ LANGUAGE sql STRICT;
  CREATE FUNCTION geometry_overlaps(geometry, geometry) RETURNS boolean AS $$ SELECT ST_Intersects($1, $2) $$ LANGUAGE sql STRICT;
  CREATE OPERATOR && (LEFTARG = geometry, RIGHTARG = geometry, PROCEDURE = geometry_overlaps);
  CREATE FUNCTION ST_Difference(geometry, geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql STRICT;
  CREATE FUNCTION hull_step(geometry, geometry) RETURNS geometry AS $$
    SELECT CASE WHEN $1 IS NULL THEN $2 WHEN $2 IS NULL THEN $1
      ELSE (least(iv_a($1), iv_a($2))::text || ':' || greatest(iv_b($1), iv_b($2))::text)::geometry END
  $$ LANGUAGE sql;
  CREATE AGGREGATE ST_Collect(geometry) (SFUNC = hull_step, STYPE = geometry);
  CREATE AGGREGATE ST_Union(geometry) (SFUNC = hull_step, STYPE = geometry);
`;

/**
 * PGlite has no pgRouting. The stub has pgRouting's signature and does what the load relies on: every row of `rows_where` gets a
 * `source` and a `target` vertex, found by the exact text of its start and end point or inserted when missing. The session variable
 * `ejes.pgr_stub` picks the mode: `on` (default) assigns and returns OK; `off` returns OK without touching the rows; `fail` returns
 * FAIL without touching the rows, as pgRouting does after a caught error; `partial` assigns only the first row and returns FAIL.
 */
const PGROUTING_STUBS_SQL = `
  CREATE FUNCTION pgr_version() RETURNS text AS $$ SELECT '3.3.0-stub'::text $$ LANGUAGE sql;
  CREATE FUNCTION pgr_createTopology(table_name text, tolerance float8, geom text, id text, source text, target text,
    rows_where text DEFAULT 'true', clean boolean DEFAULT false) RETURNS text AS $$
  DECLARE
    vertices text := table_name || '_vertices_pgr';
    mode text := coalesce(current_setting('ejes.pgr_stub', true), 'on');
    row_id bigint;
    start_point text;
    end_point text;
    start_id bigint;
    end_id bigint;
  BEGIN
    IF mode = 'off' OR mode = 'fail' THEN
      RETURN CASE WHEN mode = 'off' THEN 'OK' ELSE 'FAIL' END;
    END IF;
    FOR row_id, start_point, end_point IN EXECUTE format(
      'SELECT %I, iv_a(%I)::float8::text, iv_b(%I)::float8::text FROM %s WHERE %s ORDER BY %I', id, geom, geom, table_name, rows_where, id
    ) LOOP
      EXECUTE format('SELECT id FROM %s WHERE the_geom::text = $1 ORDER BY id LIMIT 1', vertices) INTO start_id USING start_point;
      IF start_id IS NULL THEN
        EXECUTE format('INSERT INTO %s (the_geom) VALUES ($1) RETURNING id', vertices) INTO start_id USING start_point;
      END IF;
      EXECUTE format('SELECT id FROM %s WHERE the_geom::text = $1 ORDER BY id LIMIT 1', vertices) INTO end_id USING end_point;
      IF end_id IS NULL THEN
        EXECUTE format('INSERT INTO %s (the_geom) VALUES ($1) RETURNING id', vertices) INTO end_id USING end_point;
      END IF;
      EXECUTE format('UPDATE %s SET %I = $1, %I = $2 WHERE %I = $3', table_name, source, target, id) USING start_id, end_id, row_id;
      IF mode = 'partial' THEN EXIT; END IF;
    END LOOP;
    RETURN CASE WHEN mode = 'partial' THEN 'FAIL' ELSE 'OK' END;
  END;
  $$ LANGUAGE plpgsql;
`;

/**
 * The indexes of the tables pgRouting reads (EJ-20): the btree on the section id, source and target, and the GiST on the section and
 * vertex geometries. The GiST indexes use btree_gist, the PGlite extension that gives GiST an operator class for text.
 */
const TOPOLOGY_INDEXES_SQL = `
  CREATE INDEX road_section_source_idx ON carto.road_section USING btree (source);
  CREATE INDEX road_section_target_idx ON carto.road_section USING btree (target);
  CREATE INDEX road_section_geometry_idx ON carto.road_section USING gist (geometry);
  CREATE INDEX road_section_vertices_geom_idx ON carto.road_section_vertices_pgr USING gist (the_geom);
`;

/** The type of `access_point.id_road_section`: the production table stores the reference as text; `integer` is the typed variant. */
export type AccessPointRefType = "varchar" | "integer";

const schemaSqlOf = (accessPointRefType: AccessPointRefType): string => `
  CREATE SCHEMA bdj_carto;
  CREATE SCHEMA carto;
  CREATE TABLE bdj_carto.ide_ejesviacirculacion (
    reftramo text, idcalle text, nombre text, tipo_vialidad text, fuente text, localidad text, departamento text, geom geometry
  );
  CREATE TABLE carto.road_section (
    id serial PRIMARY KEY, reftramo_ideuy integer, id_circulation_way integer, id_road_section_type integer, id_font integer,
    id_address_master integer, source integer, target integer, distance varchar, geometry geometry
  );
  CREATE TABLE carto.circulation_way (
    id serial PRIMARY KEY, name text, short_name text, id_road_type integer, id_font integer, id_calle integer
  );
  CREATE TABLE carto.addresses_master (addresses_master_id serial PRIMARY KEY, urn text, latitud double precision, longitud double precision);
  CREATE TABLE carto.road_section_vertices_pgr (id bigserial PRIMARY KEY, cnt integer, chk integer, ein integer, eout integer, the_geom geometry);
  CREATE TABLE carto.access_point (id serial PRIMARY KEY, id_road_section ${accessPointRefType});
  CREATE TABLE bdj_carto.ine_localidades_pg (cloc_iso text, nomloc text, geom geometry);
  CREATE TABLE carto.mv_country_province (iso_code_dpto text, name_dpto text, geometry geometry);
  CREATE TABLE carto.padron (type_padron text, geometry geometry, id_address_master integer);
  CREATE TABLE carto.address (id serial PRIMARY KEY, id_address_master integer, geometry geometry);
`;

const SNAPSHOT_TABLES = [
  "carto.road_section",
  "carto.circulation_way",
  "carto.addresses_master",
  "carto.road_section_vertices_pgr",
  "carto.access_point",
] as const;

export type SqlLog = string[];

export type FailRule = string | ((sql: string) => boolean);

export const sessionOn = (database: PGlite, log: SqlLog = [], failOn?: FailRule): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    log.push(sql);
    const fails = failOn !== undefined && (typeof failOn === "string" ? sql === failOn : failOn(sql));
    if (fails) throw new Error(`fallo simulado con ${PASSWORD}`);
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

export async function createEjesDatabase(PGliteClass: typeof PGlite, accessPointRefType: AccessPointRefType = "varchar"): Promise<PGlite> {
  const database = new PGliteClass({ extensions: { btree_gist } });
  await database.exec("CREATE EXTENSION btree_gist");
  await database.exec(POSTGIS_STUBS_SQL);
  await database.exec(PGROUTING_STUBS_SQL);
  await database.exec(schemaSqlOf(accessPointRefType));
  await database.exec(TOPOLOGY_INDEXES_SQL);
  return database;
}

/**
 * `off` makes the pgRouting stub leave every section without a source and a target, as a topology that assigned nothing would.
 * `fail` makes it return FAIL with nothing assigned; `partial` assigns the first row, then returns FAIL.
 */
export async function setPgrStub(database: PGlite, mode: "on" | "off" | "fail" | "partial"): Promise<void> {
  await database.exec(`SET ejes.pgr_stub = '${mode}'`);
}

/** The vertex id the stub gave to a point, by its text: the points of the harness geometries are the numbers at the ends of a line. */
export async function vertexIdAt(database: PGlite, point: string): Promise<number> {
  const result = await database.query<{ id: number | string }>("SELECT id FROM carto.road_section_vertices_pgr WHERE the_geom::text = $1 ORDER BY id", [point]);
  return Number(result.rows[0].id);
}

const targetOf = async (database: PGlite, role: (typeof EJES_LOAD_ROLES)[number]): Promise<WritableTargetLayout> => {
  const { schema, table } = EJES_DEFAULT_TABLES[role];
  const layout = ejesLayouts()[role];
  const catalog = await database.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
    [schema, table]
  );
  const idColumn = layout.columns.id ?? layout.columns[EJES_REQUIRED_COLUMNS_BY_ROLE[role][0]];
  const sequence = await database.query<{ sequence: string | null }>("SELECT pg_get_serial_sequence($1, $2) AS sequence", [
    `${schema}.${table}`,
    idColumn,
  ]);
  return {
    ...layout,
    srid: 32721,
    idColumn,
    idSequence: sequence.rows[0].sequence,
    identityColumns: [],
    catalog: catalog.rows.map((row) => ({
      column_name: row.column_name,
      data_type: row.data_type,
      is_nullable: row.is_nullable === "YES",
      column_default: row.column_default,
    })),
  };
};

export async function loadContextOn(database: PGlite): Promise<EjesLoadContext> {
  const targets = [];
  for (const role of EJES_LOAD_ROLES) {
    targets.push(await targetOf(database, role));
  }
  return ejesLoadContextOf(ejesLayouts(), ejesTables(), targets);
}

export const paramsWith = (summary: EjesSummary | undefined): EjesParams => ({
  config: { host: "h", port: "5432", db_name: "d", user: "u", password: PASSWORD, schema_name: "", table_name: "" },
  tables: ejesTables(),
  dryRun: false,
  summary,
});

export async function summaryOn(database: PGlite): Promise<EjesSummary> {
  return summaryOf(await readAnalysis(sessionOn(database), ejesLayouts()));
}

export async function snapshotOf(database: PGlite): Promise<Record<string, Row[]>> {
  const entries: Array<[string, Row[]]> = [];
  for (const table of SNAPSHOT_TABLES) {
    const result = await database.query(`SELECT * FROM ${table} ORDER BY 1`);
    entries.push([table, result.rows as Row[]]);
  }
  return Object.fromEntries(entries);
}

export interface StagingRow {
  ref: string | null;
  calle?: string | null;
  nombre?: string | null;
  tipo?: string | null;
  fuente?: string | null;
  localidad?: string | null;
  departamento?: string | null;
  geom: string | null;
}

export async function insertStaging(database: PGlite, rows: readonly StagingRow[]): Promise<void> {
  for (const row of rows) {
    await database.query(
      "INSERT INTO bdj_carto.ide_ejesviacirculacion (reftramo, idcalle, nombre, tipo_vialidad, fuente, localidad, departamento, geom) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        row.ref,
        row.calle === undefined ? "10" : row.calle,
        row.nombre === undefined ? "CALLE UNO" : row.nombre,
        row.tipo === undefined ? "CALLE" : row.tipo,
        row.fuente === undefined ? "IDE" : row.fuente,
        row.localidad === undefined ? "TRINIDAD" : row.localidad,
        row.departamento === undefined ? "FLORES" : row.departamento,
        row.geom,
      ]
    );
  }
}

export interface SectionSeed {
  id?: number;
  ref: number | null;
  calle: number;
  geom: string;
  type?: number;
  font?: number;
  source?: number | null;
  target?: number | null;
  distance?: string | null;
  master?: number | null;
}

export async function insertSection(database: PGlite, seed: SectionSeed): Promise<number> {
  const result = await database.query<{ id: number }>(
    "INSERT INTO carto.road_section (id, reftramo_ideuy, id_circulation_way, id_road_section_type, id_font, id_address_master, source, target, distance, geometry) VALUES (COALESCE($1::int, nextval('carto.road_section_id_seq')::int), $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
    [
      seed.id ?? null,
      seed.ref,
      seed.calle,
      seed.type ?? 4,
      seed.font ?? 1,
      seed.master ?? null,
      seed.source ?? null,
      seed.target ?? null,
      seed.distance === undefined ? "seed" : seed.distance,
      seed.geom,
    ]
  );
  return result.rows[0].id;
}

export async function insertVertex(database: PGlite, point: string): Promise<number> {
  const result = await database.query<{ id: number | string }>("INSERT INTO carto.road_section_vertices_pgr (the_geom) VALUES ($1) RETURNING id", [point]);
  return Number(result.rows[0].id);
}

export async function insertWay(database: PGlite, calle: number, name: string, type = 4, font = 1, id?: number): Promise<number> {
  const result = await database.query<{ id: number }>(
    "INSERT INTO carto.circulation_way (id, name, short_name, id_road_type, id_font, id_calle) VALUES (COALESCE($1::int, nextval('carto.circulation_way_id_seq')::int), $2, $3, $4, $5, $6) RETURNING id",
    [id ?? null, name, `${name} (seed)`, type, font, calle]
  );
  return result.rows[0].id;
}

export async function insertPoints(database: PGlite, ref: string | null, count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await database.query<{ id: number }>("INSERT INTO carto.access_point (id_road_section) VALUES ($1) RETURNING id", [ref]);
    ids.push(result.rows[0].id);
  }
  return ids;
}

/** The point geometry of an access point: `carto.address` row with the point's id (its text interval, e.g. "43:43"). */
export async function insertAddress(database: PGlite, id: number, geometry: string | null): Promise<void> {
  await database.query("INSERT INTO carto.address (id, geometry) VALUES ($1, $2)", [id, geometry]);
}

/** A department polygon of the national table (`carto.mv_country_province`): the interval it covers, as the other geometries of the harness. */
export async function insertDepartment(database: PGlite, name: string, geometry: string, iso = "00"): Promise<void> {
  await database.query("INSERT INTO carto.mv_country_province (iso_code_dpto, name_dpto, geometry) VALUES ($1, $2, $3)", [iso, name, geometry]);
}

export async function insertPadron(database: PGlite, type: string, geometry: string): Promise<void> {
  await database.query("INSERT INTO carto.padron (type_padron, geometry) VALUES ($1, $2)", [type, geometry]);
}

export async function rowsOf<T extends Row = Row>(database: PGlite, sql: string): Promise<T[]> {
  return (await database.query<T>(sql)).rows;
}

/** The load counts of a run that wrote nothing; `overrides` sets the counts the run did write. */
export const zeroLoadCounts = (overrides: Partial<Record<string, number>> = {}): Record<string, number> => ({
  inserted: 0,
  updated: 0,
  renumbered: 0,
  renumberSkipped: 0,
  removed: 0,
  merged: 0,
  deleted: 0,
  waysCreated: 0,
  pointsMoved: 0,
  topologyAssigned: 0,
  verticesCreated: 0,
  verticesDeleted: 0,
  splitsApplied: 0,
  twinsRemoved: 0,
  ...overrides,
});
