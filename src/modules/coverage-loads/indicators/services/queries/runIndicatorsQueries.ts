import type { Queryable } from "../../../shared/pgClient";
import { findPrivilegeShortfalls, type PrivilegeRequirement } from "../../../shared/tablePrivileges";
import { FUENTE, HISTORY_TABLE, HistoryPrivilege, STAGING_TABLE } from "../../constants";
import type { ReportKind } from "../../constants";
import { describeIncompleteCut, type HistoryState } from "../../domain/plan";
import type { LoadedCut, ParsedCut, ReportRow } from "../../types";
import {
  EXISTING_ROWS_SQL,
  INSERT_STAGING_SQL,
  LOCK_STAGING_SQL,
  REPLACE_HISTORY_SQL,
  STORED_ROWS_SQL,
  TRUNCATE_STAGING_SQL,
} from "./historyQueries";
import { mapExistingRow, mapReportRow } from "./mapRows";
import { REPORT_SQL } from "./reportQueries";

const PRIVILEGE_REQUIREMENTS: ReadonlyArray<PrivilegeRequirement> = [
  {
    table: HISTORY_TABLE,
    privileges: [HistoryPrivilege.SELECT, HistoryPrivilege.INSERT, HistoryPrivilege.DELETE],
  },
  {
    table: STAGING_TABLE,
    privileges: [HistoryPrivilege.SELECT, HistoryPrivilege.TRUNCATE, HistoryPrivilege.INSERT],
  },
];

/**
 * Both the `pg` repository and the PGlite tests call these functions, so they execute identical
 * SQL. None of them opens or closes a transaction; the caller owns that.
 */

async function readExistingRows(queryable: Queryable, fechaacts: ReadonlyArray<string>): Promise<Record<string, number>> {
  if (fechaacts.length === 0) return {};
  const result = await queryable.query(EXISTING_ROWS_SQL, [[...fechaacts]]);
  const existing: Record<string, number> = {};
  for (const row of result.rows) {
    const mapped = mapExistingRow(row as Record<string, unknown>);
    existing[mapped.fechaact] = mapped.total;
  }
  return existing;
}

export function findShortfalls(queryable: Queryable): Promise<HistoryState["shortfalls"]> {
  return findPrivilegeShortfalls(queryable, PRIVILEGE_REQUIREMENTS);
}

/** Privileges first; the counts are only read when the history is there to be read. */
export async function readHistoryStateFor(
  queryable: Queryable,
  fechaacts: ReadonlyArray<string>,
  shortfalls: HistoryState["shortfalls"]
): Promise<HistoryState> {
  const historyUnreadable = shortfalls.some(
    (shortfall) =>
      shortfall.table === HISTORY_TABLE &&
      (!shortfall.tableExists || shortfall.missing.includes(HistoryPrivilege.SELECT))
  );
  const existingRowsByDate = historyUnreadable ? {} : await readExistingRows(queryable, fechaacts);
  return { existingRowsByDate, shortfalls };
}

export async function readHistoryState(
  queryable: Queryable,
  fechaacts: ReadonlyArray<string>
): Promise<HistoryState> {
  return readHistoryStateFor(queryable, fechaacts, await findShortfalls(queryable));
}

/** Serialises concurrent loads: whoever holds this lock is the only one reading and replacing the history. */
export async function lockStaging(queryable: Queryable): Promise<void> {
  await queryable.query(LOCK_STAGING_SQL, []);
}

async function refillStaging(queryable: Queryable, cuts: ReadonlyArray<ParsedCut>): Promise<void> {
  await queryable.query(TRUNCATE_STAGING_SQL, []);
  const rows = cuts.flatMap((cut) => cut.rows.map((row) => ({ fechaact: cut.fechaact, row })));
  await queryable.query(INSERT_STAGING_SQL, [
    rows.map((entry) => entry.fechaact),
    FUENTE,
    rows.map((entry) => entry.row.localidad),
    rows.map((entry) => entry.row.departamento),
    rows.map((entry) => entry.row.cobertura),
    rows.map((entry) => entry.row.porcentaje),
  ]);
}

async function countStoredRows(queryable: Queryable, fechaact: string): Promise<number> {
  const result = await queryable.query(STORED_ROWS_SQL, [fechaact]);
  return Number((result.rows[0] as Record<string, unknown>).total);
}

async function describeLoadedCut(queryable: Queryable, cut: ParsedCut, replacedRows: number): Promise<LoadedCut> {
  const incompleteMessage = describeIncompleteCut(cut);
  return {
    fileName: cut.fileName,
    fechaact: cut.fechaact,
    replacedRows,
    insertedRows: cut.rows.length,
    storedRows: await countStoredRows(queryable, cut.fechaact),
    rejectedRows: cut.rejected.length,
    incomplete: incompleteMessage !== null,
    incompleteMessage,
  };
}

/**
 * The legacy sequence for the whole run: TRUNCATE `public.indicadores_lte` once, fill it with the rows
 * of every cut (oldest date first), run the replace statement once (it replaces every date present
 * in staging), then count the stored rows of each cut. Staging keeps the rows of all cuts.
 */
export async function writeCuts(
  queryable: Queryable,
  cuts: ReadonlyArray<ParsedCut>,
  existingRowsByDate: Readonly<Record<string, number>>
): Promise<LoadedCut[]> {
  const oldestFirst = [...cuts].sort((left, right) => left.fechaact.localeCompare(right.fechaact));
  await refillStaging(queryable, oldestFirst);
  await queryable.query(REPLACE_HISTORY_SQL, []);
  const loaded: LoadedCut[] = [];
  for (const cut of oldestFirst) {
    loaded.push(await describeLoadedCut(queryable, cut, existingRowsByDate[cut.fechaact] ?? 0));
  }
  return loaded;
}

export async function readReport(queryable: Queryable, kind: ReportKind): Promise<ReportRow[]> {
  const result = await queryable.query(REPORT_SQL[kind], []);
  return result.rows.map((row) => mapReportRow(row as Record<string, unknown>));
}
