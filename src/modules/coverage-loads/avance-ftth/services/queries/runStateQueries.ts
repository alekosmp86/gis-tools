import type { Queryable } from "../../../shared/pgClient";
import { findPrivilegeShortfalls, type PrivilegeRequirement } from "../../../shared/tablePrivileges";
import {
  AVANCE,
  AvanceFileKind,
  FILE_KINDS,
  HISTORY,
  SEQUENCE_OWNERS,
  SEQUENCE_USAGE_PRIVILEGE,
  STAGING_INT,
  STAGING_UDPEM,
  TablePrivilege,
  ZONES,
  CENTRAL_LIMITS,
} from "../../constants";
import type { AvanceDbState, AvanceState, PrivilegeShortfallInput, StagingState } from "../../types";
import { asNullableText, mapStatusCount } from "./mapRows";
import {
  AVANCE_BY_STATUS_SQL,
  AVANCE_STATE_SQL,
  HISTORY_COUNT_SQL,
  SEQUENCE_USAGE_SQL,
  STAGING_STATE_SQL,
  ZONE_STATUS_SQL,
  ZONES_COUNT_SQL,
} from "./stateQueries";

const STAGING_PRIVILEGES = [
  TablePrivilege.SELECT,
  TablePrivilege.INSERT,
  TablePrivilege.DELETE,
  TablePrivilege.TRUNCATE,
];

const PRIVILEGE_REQUIREMENTS: ReadonlyArray<PrivilegeRequirement> = [
  { table: STAGING_INT, privileges: STAGING_PRIVILEGES },
  { table: STAGING_UDPEM, privileges: STAGING_PRIVILEGES },
  {
    table: AVANCE,
    privileges: [TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE, TablePrivilege.TRUNCATE],
  },
  { table: HISTORY, privileges: [TablePrivilege.SELECT, TablePrivilege.INSERT] },
  { table: ZONES, privileges: [TablePrivilege.SELECT] },
  { table: CENTRAL_LIMITS, privileges: [TablePrivilege.SELECT] },
];

type DatabaseRow = Record<string, unknown>;

async function readFirstRow(queryable: Queryable, sql: string, values: unknown[] = []): Promise<DatabaseRow> {
  const result = await queryable.query(sql, values);
  return (result.rows[0] ?? {}) as DatabaseRow;
}

export async function readTotal(queryable: Queryable, sql: string, values: unknown[] = []): Promise<number> {
  return Number((await readFirstRow(queryable, sql, values)).total);
}

async function readStatusCounts(queryable: Queryable, sql: string) {
  const result = await queryable.query(sql, []);
  return result.rows.map((row) => mapStatusCount(row as DatabaseRow));
}

function sequenceMissingLabel(column: string): string {
  return `${SEQUENCE_USAGE_PRIVILEGE} (secuencia de ${column})`;
}

function isMissingTable(shortfalls: ReadonlyArray<PrivilegeShortfallInput>, table: string): boolean {
  return shortfalls.some((shortfall) => shortfall.table === table && !shortfall.tableExists);
}

/** `null` when the database cannot say (no serial sequence behind the column): the HGDesa dry run will catch it. */
async function hasSequenceUsage(queryable: Queryable, table: string, column: string): Promise<boolean | null> {
  const row = await readFirstRow(queryable, SEQUENCE_USAGE_SQL, [table, column, SEQUENCE_USAGE_PRIVILEGE]);
  return row.granted === null || row.granted === undefined ? null : row.granted === true;
}

function withMissing(
  shortfalls: ReadonlyArray<PrivilegeShortfallInput>,
  table: string,
  missing: string
): PrivilegeShortfallInput[] {
  const existing = shortfalls.find((shortfall) => shortfall.table === table);
  if (!existing) return [...shortfalls, { table, tableExists: true, missing: [missing] }];
  return shortfalls.map((shortfall) =>
    shortfall === existing ? { ...shortfall, missing: [...shortfall.missing, missing] } : shortfall
  );
}

/** Table grants (shared helper) plus USAGE on the serial sequences, which that helper does not check. */
async function findShortfalls(queryable: Queryable): Promise<PrivilegeShortfallInput[]> {
  let shortfalls: PrivilegeShortfallInput[] = await findPrivilegeShortfalls(queryable, PRIVILEGE_REQUIREMENTS);
  for (const owner of SEQUENCE_OWNERS) {
    if (isMissingTable(shortfalls, owner.table)) continue;
    const granted = await hasSequenceUsage(queryable, owner.table, owner.column);
    if (granted === false) shortfalls = withMissing(shortfalls, owner.table, sequenceMissingLabel(owner.column));
  }
  return shortfalls;
}

function isUnreadable(shortfalls: ReadonlyArray<PrivilegeShortfallInput>, table: string): boolean {
  return shortfalls.some(
    (shortfall) => shortfall.table === table && (!shortfall.tableExists || shortfall.missing.includes(TablePrivilege.SELECT))
  );
}

const EMPTY_STAGING: StagingState = { rows: 0, fechaact: null };
const EMPTY_AVANCE: AvanceState = { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false };

async function readStagingState(queryable: Queryable, kind: AvanceFileKind): Promise<StagingState> {
  const row = await readFirstRow(queryable, STAGING_STATE_SQL[kind]);
  return { rows: Number(row.total), fechaact: asNullableText(row.fechaact) };
}

export async function readAvanceState(queryable: Queryable): Promise<AvanceState> {
  const row = await readFirstRow(queryable, AVANCE_STATE_SQL);
  return {
    rows: Number(row.total),
    oldestLoad: asNullableText(row.oldest_load),
    newestLoad: asNullableText(row.newest_load),
    loadedToday: row.loaded_today === true,
  };
}

async function readStagingStates(
  queryable: Queryable,
  shortfalls: ReadonlyArray<PrivilegeShortfallInput>
): Promise<AvanceDbState["staging"]> {
  const tables = { [AvanceFileKind.INT]: STAGING_INT, [AvanceFileKind.UDPEM]: STAGING_UDPEM };
  const entries: Array<readonly [AvanceFileKind, StagingState]> = [];
  for (const kind of FILE_KINDS) {
    entries.push([kind, isUnreadable(shortfalls, tables[kind]) ? EMPTY_STAGING : await readStagingState(queryable, kind)]);
  }
  return Object.fromEntries(entries) as AvanceDbState["staging"];
}

/** Privileges first; each count is only read when its table is there to be read. */
export async function readDbState(queryable: Queryable): Promise<AvanceDbState> {
  const shortfalls = await findShortfalls(queryable);
  const canReadAvance = !isUnreadable(shortfalls, AVANCE);
  const canReadZones = !isUnreadable(shortfalls, ZONES);

  return {
    staging: await readStagingStates(queryable, shortfalls),
    avance: canReadAvance ? await readAvanceState(queryable) : EMPTY_AVANCE,
    historyRows: isUnreadable(shortfalls, HISTORY) ? 0 : await readTotal(queryable, HISTORY_COUNT_SQL),
    zoneRows: canReadZones ? await readTotal(queryable, ZONES_COUNT_SQL) : 0,
    zoneStatuses: canReadZones ? await readStatusCounts(queryable, ZONE_STATUS_SQL) : [],
    avanceByStatus: canReadAvance && canReadZones ? await readStatusCounts(queryable, AVANCE_BY_STATUS_SQL) : [],
    shortfalls,
  };
}
