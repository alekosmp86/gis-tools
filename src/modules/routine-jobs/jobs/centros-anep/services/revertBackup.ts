import { rm } from "node:fs/promises";
import path from "node:path";
import {
  isExistingFileError,
  revertBackupError,
  safeIdentifier,
  SQL_PREAMBLE,
  stampOf,
  syncedSize,
  writeGzipText,
} from "../../actualizar-padron/services/revertBackup";
import {
  ensureRevertBackupDirectory,
  registerRevertBackup,
  revertBackupDirectory,
} from "../../actualizar-padron/services/revertBackupStore";
import type { RunSession } from "../../cargar-padrones/types";
import {
  buildRevertHeadSql,
  buildRevertInsertHead,
  buildRevertPageSql,
  REVERT_ROW_COLUMNS,
  REVERT_TAIL_SQL,
} from "../domain/replaceSql";
import type { CentrosBackup, CentrosFinalLayout } from "../types";

const REVERT_PAGE_SIZE = 500;

interface RowTally {
  rows: number;
}

const revertFileName = (final: CentrosFinalLayout, now: Date): string =>
  `centros-anep-revert-${safeIdentifier(final.schema)}-${safeIdentifier(final.table)}-${stampOf(now)}.sql.gz`;

async function* revertChunks(session: RunSession, final: CentrosFinalLayout, tally: RowTally): AsyncGenerator<string> {
  for (const line of [...SQL_PREAMBLE, ...buildRevertHeadSql(final)]) yield `${line}\n`;
  let cursor: string | undefined;
  for (;;) {
    // Keyset pages: each one is read after the previous was written, so the table is never held in memory.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const page = await session.query(
      buildRevertPageSql(final, REVERT_PAGE_SIZE, cursor !== undefined),
      cursor === undefined ? [] : [cursor]
    );
    if (page.rows.length === 0) break;
    const lines = page.rows.map((row) => String(row[REVERT_ROW_COLUMNS.LINE]));
    yield `${buildRevertInsertHead(final)}\n${lines.join(",\n")};\n`;
    tally.rows += page.rows.length;
    cursor = String(page.rows[page.rows.length - 1][REVERT_ROW_COLUMNS.CURSOR]);
  }
  yield `${REVERT_TAIL_SQL}\n`;
}

async function writeAndRegister(
  session: RunSession,
  final: CentrosFinalLayout,
  expectedRows: number,
  file: { fileName: string; filePath: string }
): Promise<CentrosBackup> {
  await ensureRevertBackupDirectory();
  const tally: RowTally = { rows: 0 };
  await writeGzipText(revertChunks(session, final, tally), file.filePath);
  const bytes = await syncedSize(file.filePath);
  if (tally.rows !== expectedRows) {
    throw new Error(`el respaldo tiene ${tally.rows} filas y la tabla final ${expectedRows}`);
  }
  const token = await registerRevertBackup({ filePath: file.filePath, fileName: file.fileName, bytes });
  return { token, fileName: file.fileName, bytes, rows: tally.rows };
}

/** Writes the gzip SQL that restores the previous rows of the final table. Any failure leaves no file behind. */
export async function writeCentrosRevertBackup(
  session: RunSession,
  final: CentrosFinalLayout,
  expectedRows: number,
  now: Date = new Date()
): Promise<CentrosBackup> {
  const fileName = revertFileName(final, now);
  const filePath = path.join(revertBackupDirectory(), fileName);
  try {
    return await writeAndRegister(session, final, expectedRows, { fileName, filePath });
  } catch (error: unknown) {
    if (!isExistingFileError(error)) await rm(filePath, { force: true }).catch(() => undefined);
    throw revertBackupError(error);
  }
}
