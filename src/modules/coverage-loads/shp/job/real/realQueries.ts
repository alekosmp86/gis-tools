import {
  ADVISORY_LOCK_ID_BY_TABLE,
  ADVISORY_LOCK_NAMESPACE,
  SHP_TABLES,
  TARGET_SCHEMA,
  stageTableName,
  workTableName,
} from "../constants.ts";
import type { ShpTable } from "../types.ts";

/**
 * Every statement of the real pipeline lives here. Values always travel as bound parameters; the
 * only text spliced into SQL are table identifiers, and those come from a closed whitelist built
 * from `SHP_TABLES` (never from a request, a file name or any other input).
 */
export interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface TableIdentifiers {
  readonly target: string;
  readonly stage: string;
  readonly work: string;
}

function qualify(name: string): string {
  return `${TARGET_SCHEMA}.${name}`;
}

const IDENTIFIERS: Readonly<Record<ShpTable, TableIdentifiers>> = Object.fromEntries(
  SHP_TABLES.map((table) => [
    table,
    { target: qualify(table), stage: qualify(stageTableName(table)), work: qualify(workTableName(table)) },
  ])
) as Record<ShpTable, TableIdentifiers>;

export function tableIdentifiers(table: ShpTable): TableIdentifiers {
  if (!Object.hasOwn(IDENTIFIERS, table)) throw new Error("Tabla destino fuera de la lista permitida.");
  return IDENTIFIERS[table];
}

function statement(text: string, values: readonly unknown[] = []): Statement {
  return { text, values };
}

export const BEGIN_STATEMENT = statement("BEGIN");
export const COMMIT_STATEMENT = statement("COMMIT");
export const ROLLBACK_STATEMENT = statement("ROLLBACK");
export const BACKEND_PID_STATEMENT = statement("SELECT pg_backend_pid() AS pid");

/** `local` = for the current transaction only. */
export function setConfigStatement(name: string, value: string, local: boolean): Statement {
  return statement("SELECT set_config($1::text, $2::text, $3::boolean) AS value", [name, value, local]);
}

export function tryAdvisoryLockStatement(table: ShpTable): Statement {
  return statement("SELECT pg_try_advisory_lock($1::int, $2::int) AS locked", [
    ADVISORY_LOCK_NAMESPACE,
    ADVISORY_LOCK_ID_BY_TABLE[table],
  ]);
}

export function advisoryUnlockStatement(table: ShpTable): Statement {
  return statement("SELECT pg_advisory_unlock($1::int, $2::int) AS unlocked", [
    ADVISORY_LOCK_NAMESPACE,
    ADVISORY_LOCK_ID_BY_TABLE[table],
  ]);
}

export function dropWorkTablesStatement(table: ShpTable): Statement {
  const { stage, work } = tableIdentifiers(table);
  return statement(`DROP TABLE IF EXISTS ${stage}, ${work}`);
}

/** Raw geometry as read from the file (EWKB carries the SRID), one row per record. */
export function createStageTableStatement(table: ShpTable): Statement {
  const { stage } = tableIdentifiers(table);
  return statement(`CREATE UNLOGGED TABLE ${stage} (rec integer NOT NULL, npoints integer NOT NULL, geom geometry NOT NULL)`);
}

export function copyStageStatement(table: ShpTable): string {
  const { stage } = tableIdentifiers(table);
  return `COPY ${stage} (rec, npoints, geom) FROM STDIN WITH (FORMAT binary)`;
}

export function createWorkTableStatement(table: ShpTable, srid: number): Statement {
  const { work } = tableIdentifiers(table);
  if (!Number.isInteger(srid) || srid <= 0) throw new Error("SRID inválido.");
  return statement(
    `CREATE UNLOGGED TABLE ${work} (piece_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, rec integer NOT NULL, geom geometry(Geometry, ${srid}))`
  );
}

export function stageRecordsStatement(table: ShpTable): Statement {
  const { stage } = tableIdentifiers(table);
  return statement(`SELECT rec, npoints FROM ${stage} ORDER BY rec`);
}

export function stageStatsStatement(table: ShpTable): Statement {
  const { stage } = tableIdentifiers(table);
  return statement(`SELECT count(*)::text AS rows, COALESCE(sum(ST_Area(geom)), 0)::float8 AS area FROM ${stage}`);
}

/** Splits the raw geometries of records `[$1, $2]` and answers how many pieces were added. */
export function subdivideBatchStatement(table: ShpTable, firstRecord: number, lastRecord: number, maxVertices: number, srid: number): Statement {
  const { stage, work } = tableIdentifiers(table);
  return statement(
    `WITH inserted AS (
       INSERT INTO ${work} (rec, geom)
       SELECT s.rec, ST_Subdivide(ST_SetSRID(s.geom, $4::int), $3::int)
       FROM ${stage} s
       WHERE s.rec BETWEEN $1::int AND $2::int
       RETURNING 1)
     SELECT count(*)::text AS pieces FROM inserted`,
    [firstRecord, lastRecord, maxVertices, srid]
  );
}

export function pieceRangeStatement(table: ShpTable): Statement {
  const { work } = tableIdentifiers(table);
  return statement(
    `SELECT COALESCE(min(piece_id), 0)::text AS first_id, COALESCE(max(piece_id), 0)::text AS last_id, count(*)::text AS pieces FROM ${work}`
  );
}

/** Repairs pieces `[$1, $2]` in place and answers how many were touched. */
export function repairBatchStatement(table: ShpTable, firstPieceId: number, lastPieceId: number): Statement {
  const { work } = tableIdentifiers(table);
  return statement(
    `WITH repaired AS (
       UPDATE ${work}
       SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom, 'method=structure'), 3))
       WHERE piece_id BETWEEN $1::bigint AND $2::bigint
       RETURNING 1)
     SELECT count(*)::text AS repaired FROM repaired`,
    [firstPieceId, lastPieceId]
  );
}

/** A repaired piece that came out empty has no area; it is removed instead of loaded. */
export function deleteEmptyPiecesStatement(table: ShpTable): Statement {
  const { work } = tableIdentifiers(table);
  return statement(
    `WITH removed AS (DELETE FROM ${work} WHERE geom IS NULL OR ST_IsEmpty(geom) RETURNING 1)
     SELECT count(*)::text AS removed FROM removed`
  );
}

export function workStatsStatement(table: ShpTable): Statement {
  const { work } = tableIdentifiers(table);
  return statement(
    `SELECT count(*)::text AS pieces,
            COALESCE(max(ST_NPoints(geom)), 0)::text AS max_vertices,
            (count(*) FILTER (WHERE NOT ST_IsValid(geom)))::text AS invalid_pieces,
            COALESCE(sum(ST_NPoints(geom)), 0)::text AS vertices,
            COALESCE(sum(ST_Area(geom)), 0)::float8 AS area
     FROM ${work}`
  );
}

export function targetStatsStatement(table: ShpTable): Statement {
  const { target } = tableIdentifiers(table);
  return statement(
    `SELECT count(*)::text AS pieces,
            COALESCE(sum(ST_NPoints(geom)), 0)::text AS vertices,
            COALESCE(sum(ST_Area(geom)), 0)::float8 AS area
     FROM ${target}`
  );
}

export function truncateTargetStatement(table: ShpTable): Statement {
  const { target } = tableIdentifiers(table);
  return statement(`TRUNCATE ${target}`);
}

export function insertTargetStatement(table: ShpTable, fechaact: string, source: string): Statement {
  const { target, work } = tableIdentifiers(table);
  return statement(
    `INSERT INTO ${target} (geom, fechaact, fuente, fechacarga)
     SELECT w.geom, $1::text, $2::text, to_char(current_date, 'YYYY-MM-DD')
     FROM ${work} w
     ORDER BY w.piece_id`,
    [fechaact, source]
  );
}

export function countTargetStatement(table: ShpTable): Statement {
  const { target } = tableIdentifiers(table);
  return statement(`SELECT count(*)::text AS rows FROM ${target}`);
}

export function analyzeTargetStatement(table: ShpTable): Statement {
  const { target } = tableIdentifiers(table);
  return statement(`ANALYZE ${target}`);
}
