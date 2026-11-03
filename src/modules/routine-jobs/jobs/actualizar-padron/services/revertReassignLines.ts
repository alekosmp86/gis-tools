import type { RunSession } from "../../cargar-padrones/types";
import { literal, q } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { REPLACEMENT_REFERENCE_COLUMN } from "../constants";
import { qualifiedName } from "../domain/layouts";
import { REVERT_COLUMN, REVERT_EXTRA_COLUMN, REVERT_KIND, type RevertKind } from "../domain/revertCapture";
import { formatCall, pagedRows } from "./revertPaging";

/* The restores of AP-113 (kind R) and AP-114 (kind M). Their id repeats, so they page by `seq`. */

const PAGE_SIZE = 5000;

export interface RestoreLine {
  kind: RevertKind;
  rows: number;
  text: string;
}

const SEQ = q(REVERT_EXTRA_COLUMN.SEQ);

/* The old id_padron goes back to the row identified by the table's primary key; the table name is stored already quoted. */
function reassignedRestoreSelect(): string {
  const restore = formatCall("UPDATE %s SET %s = %L WHERE %I = %L;", [
    q(REVERT_EXTRA_COLUMN.REF_TABLE),
    literal(q(REPLACEMENT_REFERENCE_COLUMN)),
    q(REVERT_COLUMN.ID),
    q(REVERT_EXTRA_COLUMN.REF_KEY_COLUMN),
    q(REVERT_EXTRA_COLUMN.REF_KEY),
  ]);
  return `${SEQ}, ${restore} AS "line"`;
}

/* The whole master row comes back from its jsonb copy, with its original id. */
function masterRestoreSelect(addressMaster: WritableTargetLayout): string {
  const table = literal(qualifiedName(addressMaster));
  const restore = formatCall("INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, %L);", [
    table,
    table,
    q(REVERT_EXTRA_COLUMN.PAYLOAD),
  ]);
  return `${SEQ}, ${restore} AS "line"`;
}

async function* restoreLines(session: RunSession, kind: RevertKind, select: string): AsyncGenerator<RestoreLine> {
  for await (const page of pagedRows(session, kind, select, PAGE_SIZE, REVERT_EXTRA_COLUMN.SEQ)) {
    for (const row of page) yield { kind, rows: 1, text: String(row.line) };
  }
}

export const masterRestoreLines = (session: RunSession, addressMaster: WritableTargetLayout): AsyncGenerator<RestoreLine> =>
  restoreLines(session, REVERT_KIND.MASTER_DELETED, masterRestoreSelect(addressMaster));

export const reassignedRestoreLines = (session: RunSession): AsyncGenerator<RestoreLine> =>
  restoreLines(session, REVERT_KIND.REASSIGNED, reassignedRestoreSelect());
