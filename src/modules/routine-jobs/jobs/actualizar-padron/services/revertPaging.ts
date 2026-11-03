import type { RunSession } from "../../cargar-padrones/types";
import { numberOf, type Row } from "../../shared/rowMapping";
import { literal, q } from "../../shared/sqlFragments";
import { REVERT_COLUMN, REVERT_TABLE_SQL, type RevertKind } from "../domain/revertCapture";

export const INT4_MIN = -2147483648;

async function readPage(
  session: RunSession,
  kind: RevertKind,
  select: string,
  pageSize: number,
  key: { column: string; after: number }
): Promise<Row[]> {
  const result = await session.query(
    `SELECT ${select} FROM ${REVERT_TABLE_SQL} WHERE ${q(REVERT_COLUMN.KIND)} = ${literal(kind)} AND ${q(key.column)} > $1 ORDER BY ${q(key.column)} LIMIT ${pageSize}`,
    [key.after]
  );
  return result.rows;
}

/* Keyset pages: a page is read only after the previous one was written, so no list of all rows is held in memory. The key column
   is the id by default; kinds whose id repeats (R, M) page by their own unique column, which the select must return under that name. */
export async function* pagedRows(
  session: RunSession,
  kind: RevertKind,
  select: string,
  pageSize: number,
  keyColumn: string = REVERT_COLUMN.ID
): AsyncGenerator<Row[]> {
  let page = await readPage(session, kind, select, pageSize, { column: keyColumn, after: INT4_MIN });
  while (page.length > 0) {
    yield page;
    page = await readPage(session, kind, select, pageSize, { column: keyColumn, after: numberOf(page[page.length - 1][keyColumn]) });
  }
}

export const formatCall = (template: string, args: readonly string[]): string => `format(${literal(template)}, ${args.join(", ")})`;
