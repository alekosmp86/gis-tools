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
import { numberOf } from "../../shared/rowMapping";
import { REVERT_PAGE_SIZE } from "../constants";
import {
  buildRevertCountSql,
  buildRevertPageSql,
  REVERT_COLUMNS,
  REVERT_HEAD_SQL,
  REVERT_ORDER,
  REVERT_TAIL_SQL,
} from "../domain/revertSql";
import type { EjesBackup, EjesLoadCounts, EjesTableRef } from "../types";

type LineTally = Record<string, number>;

const revertFileName = (target: EjesTableRef, now: Date): string =>
  `ejes-revert-${safeIdentifier(target.schema)}-${safeIdentifier(target.table)}-${stampOf(now)}.sql.gz`;

async function* pagesOf(session: RunSession, name: string, tally: LineTally): AsyncGenerator<string> {
  let cursor: string | undefined;
  for (;;) {
    // Keyset pages: each one is read after the previous was written, so the rows are never all in memory.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const page = await session.query(buildRevertPageSql(name, REVERT_PAGE_SIZE, cursor !== undefined), cursor === undefined ? [] : [cursor]);
    if (page.rows.length === 0) break;
    yield `${page.rows.map((row) => String(row[REVERT_COLUMNS.LINE])).join("\n")}\n`;
    tally[name] = (tally[name] ?? 0) + page.rows.length;
    cursor = String(page.rows[page.rows.length - 1][REVERT_COLUMNS.CURSOR]);
  }
}

async function* revertChunks(session: RunSession, tally: LineTally): AsyncGenerator<string> {
  for (const line of [...SQL_PREAMBLE, ...REVERT_HEAD_SQL]) yield `${line}\n`;
  for (const name of REVERT_ORDER) {
    yield* pagesOf(session, name, tally);
  }
  for (const line of REVERT_TAIL_SQL) yield `${line}\n`;
}

async function expectedLines(session: RunSession): Promise<LineTally> {
  const expected: LineTally = {};
  for (const name of REVERT_ORDER) {
    // One pg client: counts are read in turn.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    expected[name] = numberOf((await session.query(buildRevertCountSql(name))).rows[0]?.total);
  }
  return expected;
}

function assertTally(tally: LineTally, expected: LineTally): void {
  for (const name of REVERT_ORDER) {
    if ((tally[name] ?? 0) !== expected[name]) {
      throw new Error(`el respaldo tiene ${tally[name] ?? 0} líneas de ${name} y se esperaban ${expected[name]}`);
    }
  }
}

async function writeAndRegister(
  session: RunSession,
  counts: EjesLoadCounts,
  file: { fileName: string; filePath: string }
): Promise<EjesBackup> {
  await ensureRevertBackupDirectory();
  const expected = await expectedLines(session);
  const tally: LineTally = {};
  await writeGzipText(revertChunks(session, tally), file.filePath);
  const bytes = await syncedSize(file.filePath);
  assertTally(tally, expected);
  const token = await registerRevertBackup({ filePath: file.filePath, fileName: file.fileName, bytes });
  return {
    token,
    fileName: file.fileName,
    bytes,
    counts: {
      updated: counts.updated,
      inserted: counts.inserted,
      ways: counts.waysCreated,
      masters: counts.mastersCreated,
      pointsMoved: counts.pointsMoved,
    },
  };
}

/** Writes the gzip SQL that restores the touched rows and deletes the inserted ids, before the first write. Any failure leaves no file behind. */
export async function writeEjesRevertBackup(
  session: RunSession,
  roadSection: EjesTableRef,
  counts: EjesLoadCounts,
  now: Date = new Date()
): Promise<EjesBackup> {
  const fileName = revertFileName(roadSection, now);
  const filePath = path.join(revertBackupDirectory(), fileName);
  try {
    return await writeAndRegister(session, counts, { fileName, filePath });
  } catch (error: unknown) {
    if (!isExistingFileError(error)) await rm(filePath, { force: true }).catch(() => undefined);
    throw revertBackupError(error);
  }
}
