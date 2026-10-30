import { createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import type { RunSession } from "../../cargar-padrones/types";
import { buildRevertIndexSql } from "../domain/revertCapture";
import type { ActualizarPadronBackup } from "../types";
import {
  addToRevertTally,
  assertRevertTally,
  emptyRevertCounts,
  readRevertCounts,
  revertScriptLines,
  type RevertAddressMaster,
  type RevertCounts,
  type RevertExpected,
  type RevertLine,
  type RevertScriptPlan,
} from "./revertScript";
import { ensureRevertBackupDirectory, registerRevertBackup, revertBackupDirectory } from "./revertBackupStore";

export interface RevertBackupRequest {
  target: WritableTargetLayout;
  addressMaster?: RevertAddressMaster;
  expected: RevertExpected;
}

interface RevertFile {
  fileName: string;
  filePath: string;
  generatedAt: string;
}

const SAFE_IDENTIFIER_CHARACTERS = /[^A-Za-z0-9_-]/g;
const EMPTY_FILE_MESSAGE = "el archivo de respaldo está vacío";
const BACKUP_FILE_MODE = 0o600;
/* Read by psql before the script: stop at the first error, and read the script as UTF-8. */
const PSQL_PREAMBLE: readonly string[] = ["\\set ON_ERROR_STOP on", "SET client_encoding = 'UTF8';"];

const pad = (value: number): string => String(value).padStart(2, "0");

const stampOf = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

const safeIdentifier = (identifier: string): string => identifier.replace(SAFE_IDENTIFIER_CHARACTERS, "_");

function revertFileName(target: WritableTargetLayout, now: Date): string {
  return `padron-revert-${safeIdentifier(target.schema)}-${safeIdentifier(target.table)}-${stampOf(now)}.sql.gz`;
}

function revertBackupError(error: unknown): Error {
  const detail = (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, "");
  return new Error(`No se pudo generar el respaldo para revertir: ${detail}.`);
}

/** Runs one step of the backup's capture inside the transaction; any failure becomes the backup error, so the run rolls back. */
export async function guardRevertStep<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    throw revertBackupError(error);
  }
}

const isExistingFileError = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "EEXIST";

/** Writes the revert script of the run, verifies it and registers it. Any failure leaves no file behind. */
export async function writeRevertBackup(
  session: RunSession,
  request: RevertBackupRequest,
  now: Date = new Date()
): Promise<ActualizarPadronBackup> {
  const fileName = revertFileName(request.target, now);
  const filePath = path.join(revertBackupDirectory(), fileName);
  try {
    return await writeAndRegister(session, request, { fileName, filePath, generatedAt: now.toISOString() });
  } catch (error: unknown) {
    if (!isExistingFileError(error)) await rm(filePath, { force: true }).catch(() => undefined);
    throw revertBackupError(error);
  }
}

async function writeAndRegister(
  session: RunSession,
  request: RevertBackupRequest,
  file: RevertFile
): Promise<ActualizarPadronBackup> {
  await ensureRevertBackupDirectory();
  await session.query(buildRevertIndexSql());
  const counts = await readRevertCounts(session);
  const plan: RevertScriptPlan = {
    target: request.target,
    addressMaster: request.addressMaster,
    counts,
    generatedAt: file.generatedAt,
  };
  const tally = emptyRevertCounts();
  await writeGzipFile(revertScriptLines(session, plan), tally, file.filePath);
  const bytes = await syncedSize(file.filePath);
  assertRevertTally(tally, counts, request.expected);
  const token = await registerRevertBackup({ filePath: file.filePath, fileName: file.fileName, bytes });
  return { token, fileName: file.fileName, bytes, counts: summaryOf(counts) };
}

const summaryOf = (counts: RevertCounts): ActualizarPadronBackup["counts"] => ({
  updated: counts.U,
  paired: counts.P,
  inserted: counts.I,
  addressMasterRows: counts.A,
});

async function* textOfLines(lines: AsyncIterable<RevertLine>, tally: RevertCounts): AsyncGenerator<string> {
  for (const preambleLine of PSQL_PREAMBLE) yield `${preambleLine}\n`;
  for await (const line of lines) {
    addToRevertTally(tally, line);
    yield `${line.text}\n`;
  }
}

async function writeGzipFile(lines: AsyncIterable<RevertLine>, tally: RevertCounts, filePath: string): Promise<void> {
  await pipeline(
    Readable.from(textOfLines(lines, tally)),
    createGzip(),
    createWriteStream(filePath, { flags: "wx", mode: BACKUP_FILE_MODE })
  );
}

async function syncedSize(filePath: string): Promise<number> {
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const { size } = await stat(filePath);
  if (size === 0) throw new Error(EMPTY_FILE_MESSAGE);
  return size;
}
