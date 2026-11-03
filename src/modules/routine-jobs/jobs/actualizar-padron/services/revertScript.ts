import { physicalColumn, qualifiedName } from "../domain/layouts";
import {
  optionalAddressMasterColumn,
  REVERT_COLUMN,
  REVERT_KIND,
  REVERT_KINDS,
  REVERT_TABLE_SQL,
  type RevertKind,
} from "../domain/revertCapture";
import { DESTINATION_COLUMN } from "../constants";
import type { RunSession } from "../../cargar-padrones/types";
import { ADDRESS_MASTER_COLUMN, PADRON_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import { numberOf, type Row } from "../../shared/rowMapping";
import { literal, q } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { formatCall, INT4_MIN, pagedRows } from "./revertPaging";
import { masterRestoreLines, reassignedRestoreLines } from "./revertReassignLines";

/* The revert file is a manual artifact: the tool never executes these statements. The stage's own SQL stays free of them. */

export type RevertCounts = Record<RevertKind, number>;

export interface RevertExpected {
  inserted: number;
  updated: number;
  paired: number;
  /** Absent means zero: a run with no delete step (an analysis never reaches this check) or no marks still never captures a D row. */
  removed?: number;
  /** The referencing rows moved to a part (kind R) and the address master rows deleted with their padrón (kind M); absent means zero. */
  reassigned?: number;
  masterDeleted?: number;
}

export interface RevertAddressMaster {
  layout: WritableTargetLayout;
  maxIdBefore: number;
}
export interface RevertScriptPlan {
  target: WritableTargetLayout;
  addressMaster?: RevertAddressMaster;
  counts: RevertCounts;
  generatedAt: string;
}

export interface RevertLine {
  kind: RevertKind | null;
  rows: number;
  text: string;
}

interface InsertedIsland {
  first: number;
  last: number;
  rows: number;
}

const PAGE_SIZE = 5000;
const ADDRESS_MASTER_PAGE_SIZE = 1000;
const REVERT_KIND_LABEL: Record<RevertKind, string> = {
  [REVERT_KIND.UPDATED]: "geometrías actualizadas",
  [REVERT_KIND.PAIRED]: "padrones reclasificados",
  [REVERT_KIND.INSERTED]: "padrones insertados",
  [REVERT_KIND.ADDRESS_MASTER_LINK]: "padrones sin dirección maestra",
  [REVERT_KIND.DELETED]: "padrones eliminados",
  [REVERT_KIND.REASSIGNED]: "direcciones reasignadas",
  [REVERT_KIND.MASTER_DELETED]: "direcciones maestras eliminadas",
};

export const emptyRevertCounts = (): RevertCounts => ({
  [REVERT_KIND.UPDATED]: 0,
  [REVERT_KIND.PAIRED]: 0,
  [REVERT_KIND.INSERTED]: 0,
  [REVERT_KIND.ADDRESS_MASTER_LINK]: 0,
  [REVERT_KIND.DELETED]: 0,
  [REVERT_KIND.REASSIGNED]: 0,
  [REVERT_KIND.MASTER_DELETED]: 0,
});

const isRevertKind = (value: string): value is RevertKind => (REVERT_KINDS as readonly string[]).includes(value);

export async function readRevertCounts(session: RunSession): Promise<RevertCounts> {
  const kind = q(REVERT_COLUMN.KIND);
  const result = await session.query(
    `SELECT ${kind} AS "kind", count(*) AS "n" FROM ${REVERT_TABLE_SQL} GROUP BY ${kind}`
  );
  const counts = emptyRevertCounts();
  for (const row of result.rows) {
    const kindText = String(row.kind).trim();
    if (isRevertKind(kindText)) counts[kindText] = numberOf(row.n);
  }
  return counts;
}

export function addToRevertTally(tally: RevertCounts, line: RevertLine): void {
  if (line.kind !== null) tally[line.kind] += line.rows;
}

const assertSameCount = (actual: number, expected: number, message: string): void => {
  if (actual !== expected) throw new Error(message);
};

/** The lines written must carry the rows the revert table holds, and those must be the rows the apply changed. */
export function assertRevertTally(tally: RevertCounts, counts: RevertCounts, expected: RevertExpected): void {
  for (const kind of REVERT_KINDS) {
    assertSameCount(
      tally[kind],
      counts[kind],
      `El respaldo tiene ${tally[kind]} filas de ${REVERT_KIND_LABEL[kind]}, se esperaban ${counts[kind]}.`
    );
  }
  assertSameCount(
    counts[REVERT_KIND.UPDATED],
    expected.updated,
    `Las geometrías guardadas (${counts[REVERT_KIND.UPDATED]}) no coinciden con las actualizadas (${expected.updated}).`
  );
  assertSameCount(
    counts[REVERT_KIND.PAIRED],
    expected.paired,
    `Los padrones reclasificados guardados (${counts[REVERT_KIND.PAIRED]}) no coinciden con los aplicados (${expected.paired}).`
  );
  assertSameCount(
    counts[REVERT_KIND.INSERTED],
    expected.inserted,
    `Los padrones insertados guardados (${counts[REVERT_KIND.INSERTED]}) no coinciden con los insertados (${expected.inserted}).`
  );
  const expectedRemoved = expected.removed ?? 0;
  assertSameCount(
    counts[REVERT_KIND.DELETED],
    expectedRemoved,
    `Los padrones eliminados guardados (${counts[REVERT_KIND.DELETED]}) no coinciden con los eliminados (${expectedRemoved}).`
  );
  const expectedReassigned = expected.reassigned ?? 0;
  assertSameCount(
    counts[REVERT_KIND.REASSIGNED],
    expectedReassigned,
    `Las direcciones reasignadas guardadas (${counts[REVERT_KIND.REASSIGNED]}) no coinciden con las reasignadas (${expectedReassigned}).`
  );
  const expectedMasterDeleted = expected.masterDeleted ?? 0;
  assertSameCount(
    counts[REVERT_KIND.MASTER_DELETED],
    expectedMasterDeleted,
    `Las direcciones maestras guardadas (${counts[REVERT_KIND.MASTER_DELETED]}) no coinciden con las eliminadas (${expectedMasterDeleted}).`
  );
}

const structural = (text: string): RevertLine => ({ kind: null, rows: 0, text });

const ADDRESS_MASTER_HEADER = "-- Direcciones maestras: se borran solo las creadas por el enlace de esta ejecución (urn de los padrones sin dirección maestra antes del enlace, con id mayor al máximo anterior).";

function headerLines(plan: RevertScriptPlan): RevertLine[] {
  const { counts } = plan;
  return [
    "-- Respaldo para revertir una actualización de padrones (ejecución real).",
    `-- Generado: ${plan.generatedAt}`,
    `-- Tabla de destino: ${plan.target.schema}.${plan.target.table}`,
    `-- Filas que cambió la ejecución: geometrías ${counts.U}, padrones reclasificados ${counts.P}, insertados ${counts.I}, sin dirección maestra antes del enlace ${counts.A}, eliminados ${counts.D}, direcciones reasignadas ${counts.R}, direcciones maestras eliminadas ${counts.M}.`,
    "-- ADVERTENCIA: revierte SOLO las filas que cambió esta ejecución. Supone que nadie cambió esas filas después de la ejecución.",
    ...(plan.addressMaster !== undefined ? [ADDRESS_MASTER_HEADER] : []),
    "-- Las secuencias de id no se revierten.",
    "-- Para revertir: descomprima el archivo (gunzip) y ejecute el .sql completo en psql (psql -v ON_ERROR_STOP=1 -f) o en pgAdmin / cualquier cliente SQL, de una sola vez. Todo corre en una sola transacción.",
  ].map(structural);
}

function pairedRestoreSelect(target: WritableTargetLayout): string {
  const restore = formatCall("UPDATE %s SET %s = %L, %s = %L, %s = %L, %s = %L::geometry WHERE %s = %s;", [
    literal(qualifiedName(target)),
    literal(physicalColumn(target, DESTINATION_COLUMN.TYPE_PADRON)),
    q(REVERT_COLUMN.TYPE_PADRON),
    literal(physicalColumn(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)),
    q(REVERT_COLUMN.LOCALITY),
    literal(physicalColumn(target, DESTINATION_COLUMN.NUMBER)),
    q(REVERT_COLUMN.NUMBER),
    literal(physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)),
    `encode(ST_AsEWKB(${q(REVERT_COLUMN.GEOMETRY)}), 'hex')`,
    literal(physicalColumn(target, DESTINATION_COLUMN.ID)),
    q(REVERT_COLUMN.ID),
  ]);
  return `${q(REVERT_COLUMN.ID)}, ${restore} AS "line"`;
}

function geometryRestoreSelect(target: WritableTargetLayout): string {
  const restore = formatCall("UPDATE %s SET %s = %L::geometry WHERE %s = %s;", [
    literal(qualifiedName(target)),
    literal(physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)),
    `encode(ST_AsEWKB(${q(REVERT_COLUMN.GEOMETRY)}), 'hex')`,
    literal(physicalColumn(target, DESTINATION_COLUMN.ID)),
    q(REVERT_COLUMN.ID),
  ]);
  return `${q(REVERT_COLUMN.ID)}, ${restore} AS "line"`;
}

interface DeletedColumn {
  logical: string;
  value: string;
  geometry?: boolean;
}

const DELETED_COLUMNS: readonly DeletedColumn[] = [
  { logical: DESTINATION_COLUMN.ID, value: q(REVERT_COLUMN.ID) },
  { logical: DESTINATION_COLUMN.TYPE_PADRON, value: q(REVERT_COLUMN.TYPE_PADRON) },
  { logical: DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, value: q(REVERT_COLUMN.LOCALITY) },
  { logical: DESTINATION_COLUMN.ID_PROVINCE, value: q(REVERT_COLUMN.ID_PROVINCE) },
  { logical: DESTINATION_COLUMN.NUMBER, value: q(REVERT_COLUMN.NUMBER) },
  { logical: DESTINATION_COLUMN.GEOMETRY, value: `encode(ST_AsEWKB(${q(REVERT_COLUMN.GEOMETRY)}), 'hex')`, geometry: true },
];

/** A deleted row's revert is a full INSERT, not a partial restore like U/P (AP-106): every column the destination writes,
    the id explicit (ids are not reverted), plus id_address_master when the destination has it resolved. No WHERE: the row
    is assumed gone since the run deleted it. */
function deletedRestoreSelect(target: WritableTargetLayout): string {
  const addressMasterColumn = optionalAddressMasterColumn(target);
  const columnNameArgs = DELETED_COLUMNS.map((column) => literal(physicalColumn(target, column.logical)));
  const valuePlaceholders = DELETED_COLUMNS.map((column) => (column.geometry ? "%L::geometry" : "%L"));
  const valueArgs = DELETED_COLUMNS.map((column) => column.value);
  if (addressMasterColumn !== null) {
    columnNameArgs.push(literal(addressMasterColumn));
    valuePlaceholders.push("%L");
    valueArgs.push(q(REVERT_COLUMN.ID_ADDRESS_MASTER));
  }
  const columnPlaceholders = columnNameArgs.map(() => "%s").join(", ");
  const template = `INSERT INTO %s (${columnPlaceholders}) VALUES (${valuePlaceholders.join(", ")});`;
  const restore = formatCall(template, [literal(qualifiedName(target)), ...columnNameArgs, ...valueArgs]);
  return `${q(REVERT_COLUMN.ID)}, ${restore} AS "line"`;
}

async function* restoreLines(
  session: RunSession,
  kind: RevertKind,
  select: string
): AsyncGenerator<RevertLine> {
  for await (const page of pagedRows(session, kind, select, PAGE_SIZE)) {
    for (const row of page) yield { kind, rows: 1, text: String(row.line) };
  }
}

async function* addressMasterLinkIdPages(session: RunSession): AsyncGenerator<number[]> {
  for await (const page of pagedRows(session, REVERT_KIND.ADDRESS_MASTER_LINK, q(REVERT_COLUMN.ID), ADDRESS_MASTER_PAGE_SIZE)) {
    yield page.map((row) => numberOf(row.id));
  }
}

async function* addressMasterUnlinkLines(session: RunSession, target: WritableTargetLayout): AsyncGenerator<RevertLine> {
  const table = qualifiedName(target);
  const column = physicalColumn(target, PADRON_SUBJECT_SPEC.addressMasterColumn);
  const idColumn = physicalColumn(target, DESTINATION_COLUMN.ID);
  for await (const ids of addressMasterLinkIdPages(session)) {
    yield {
      kind: REVERT_KIND.ADDRESS_MASTER_LINK,
      rows: ids.length,
      text: `UPDATE ${table} SET ${column} = NULL WHERE ${idColumn} IN (${ids.join(", ")});`,
    };
  }
}

/* Only the urns this run's link pass could have created: the padrones that had no address master before it. */
async function* addressMasterDeleteLines(session: RunSession, { layout, maxIdBefore }: RevertAddressMaster): AsyncGenerator<RevertLine> {
  const idColumn = physicalColumn(layout, ADDRESS_MASTER_COLUMN.ID);
  const urnColumn = physicalColumn(layout, ADDRESS_MASTER_COLUMN.URN);
  for await (const ids of addressMasterLinkIdPages(session)) {
    const urns = ids.map((id) => literal(`${PADRON_SUBJECT_SPEC.urnPrefix}${id}`));
    yield structural(
      `DELETE FROM ${qualifiedName(layout)} WHERE ${idColumn} > ${maxIdBefore} AND ${urnColumn} IN (${urns.join(", ")});`
    );
  }
}

const islandOf = (row: Row): InsertedIsland => ({
  first: numberOf(row.first),
  last: numberOf(row.last),
  rows: numberOf(row.n),
});

async function readInsertedIslands(session: RunSession, afterFirst: number): Promise<InsertedIsland[]> {
  const id = q(REVERT_COLUMN.ID);
  const kind = q(REVERT_COLUMN.KIND);
  const result = await session.query(
    [
      `SELECT min(${id}) AS "first", max(${id}) AS "last", count(*) AS "n"`,
      `FROM (SELECT ${id}, ${id} - row_number() OVER (ORDER BY ${id}) AS "grp" FROM ${REVERT_TABLE_SQL} WHERE ${kind} = ${literal(REVERT_KIND.INSERTED)}) AS "s"`,
      `GROUP BY "grp" HAVING min(${id}) > $1 ORDER BY min(${id}) LIMIT ${PAGE_SIZE}`,
    ].join(" "),
    [afterFirst]
  );
  return result.rows.map(islandOf);
}

/* Consecutive ids inserted by the run collapse into one DELETE range, so a first run with a million inserts stays small. */
async function* insertedDeleteLines(session: RunSession, target: WritableTargetLayout): AsyncGenerator<RevertLine> {
  const table = qualifiedName(target);
  const idColumn = physicalColumn(target, DESTINATION_COLUMN.ID);
  let afterFirst = INT4_MIN;
  let islands = await readInsertedIslands(session, afterFirst);
  while (islands.length > 0) {
    for (const island of islands) {
      yield {
        kind: REVERT_KIND.INSERTED,
        rows: island.rows,
        text: `DELETE FROM ${table} WHERE ${idColumn} BETWEEN ${island.first} AND ${island.last};`,
      };
    }
    afterFirst = islands[islands.length - 1].first;
    islands = await readInsertedIslands(session, afterFirst);
  }
}

/** The lines of the revert script, in the order it must run: address master links, inserted rows, then the restores (the master rows before the padrones, the moved references after them). */
export async function* revertScriptLines(session: RunSession, plan: RevertScriptPlan): AsyncGenerator<RevertLine> {
  yield* headerLines(plan);
  yield structural("BEGIN;");
  if (plan.addressMaster !== undefined) {
    yield* addressMasterUnlinkLines(session, plan.target);
    yield* addressMasterDeleteLines(session, plan.addressMaster);
  }
  yield* insertedDeleteLines(session, plan.target);
  yield* restoreLines(session, REVERT_KIND.PAIRED, pairedRestoreSelect(plan.target));
  yield* restoreLines(session, REVERT_KIND.UPDATED, geometryRestoreSelect(plan.target));
  if (plan.addressMaster !== undefined) yield* masterRestoreLines(session, plan.addressMaster.layout);
  yield* restoreLines(session, REVERT_KIND.DELETED, deletedRestoreSelect(plan.target));
  yield* reassignedRestoreLines(session);
  yield structural("COMMIT;");
}
