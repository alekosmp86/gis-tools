import type { Queryable } from "../../../shared/pgClient";
import {
  AVANCE_COLUMNS,
  AVANCE_FUENTE,
  EXCLUDED_DISTRICT_STATUSES,
  EXCLUDED_ZONE_NAMES,
  FILE_KINDS,
  INSERT_BATCH_SIZE,
  JUNK_CONCA_LIKE_PATTERN,
  STAGING_FUENTE,
  type AvanceFileKind,
} from "../../constants";
import { HISTORY_SKIPPED_REASON } from "../../domain/plan";
import { assertConsistentCounts, mergeStatusCounts } from "../../domain/loadResult";
import type { HistoryOutcome, LoadedFile, ParsedAvanceFile, StatusCount } from "../../types";
import { mapStatusCount } from "./mapRows";
import {
  BREAKDOWN_BY_STATUS_SQL,
  COPY_TO_HISTORY_SQL,
  COUNT_AVANCE_SQL,
  COUNT_STAGING_SQL,
  COUNT_UNMATCHED_SQL,
  DELETE_JUNK_SQL,
  INSERT_AVANCE_SQL,
  INSERT_STAGING_SQL,
  DELETE_AVANCE_SQL,
  DELETE_STAGING_SQL,
  LOCK_AVANCE_SQL,
  LOCK_STAGING_SQL,
  UPDATE_AVANCE_FUENTE_SQL,
} from "./rebuildQueries";
import { mapSequentially } from "../../../shared/sequentially";
import { readAvanceState, readTotal } from "./runStateQueries";

export interface RebuildOutcome {
  readonly files: ReadonlyArray<LoadedFile>;
  readonly history: HistoryOutcome;
  readonly byStatus: ReadonlyArray<StatusCount>;
}

interface IncomingPreview {
  readonly byStatus: ReadonlyArray<StatusCount>;
  readonly unmatchedKeys: number;
}

function orderedFiles(files: ReadonlyArray<ParsedAvanceFile>): ParsedAvanceFile[] {
  return FILE_KINDS.flatMap((kind) => files.filter((file) => file.kind === kind));
}

/** Serialises concurrent loads (SHARE ROW EXCLUSIVE, readers keep reading): whoever holds these locks is the only one replacing the staging tables and the Avance. */
export async function lockStaging(queryable: Queryable): Promise<void> {
  for (const kind of FILE_KINDS) await queryable.query(LOCK_STAGING_SQL[kind], []);
  await queryable.query(LOCK_AVANCE_SQL, []);
}

async function insertStagingRows(queryable: Queryable, file: ParsedAvanceFile): Promise<void> {
  for (let start = 0; start < file.rows.length; start += INSERT_BATCH_SIZE) {
    const batch = file.rows.slice(start, start + INSERT_BATCH_SIZE);
    const columns = AVANCE_COLUMNS.map((column) => batch.map((row) => row[column.key]));
    await queryable.query(INSERT_STAGING_SQL[file.kind], [...columns, file.fechaact, STAGING_FUENTE]);
  }
}

async function refillStaging(queryable: Queryable, files: ReadonlyArray<ParsedAvanceFile>): Promise<void> {
  for (const file of files) {
    await queryable.query(DELETE_STAGING_SQL[file.kind], []);
    await insertStagingRows(queryable, file);
  }
}

async function deleteJunk(queryable: Queryable, kind: AvanceFileKind): Promise<number> {
  return readTotal(queryable, DELETE_JUNK_SQL[kind], [JUNK_CONCA_LIKE_PATTERN]);
}

/** Steps 1 and 2: both staging tables replaced, then the junk `conca` rows deleted; returns the junk deleted per file. */
async function replaceStagingAndDeleteJunk(
  queryable: Queryable,
  files: ReadonlyArray<ParsedAvanceFile>
): Promise<number[]> {
  await refillStaging(queryable, files);
  return mapSequentially(files, (file) => deleteJunk(queryable, file.kind));
}

/** Decision O2: skip the copy iff the Avance has rows and every one was loaded today (database clock). */
async function copyHistory(queryable: Queryable): Promise<HistoryOutcome> {
  const avance = await readAvanceState(queryable);
  if (avance.loadedToday) return { copied: 0, skipped: true, reason: HISTORY_SKIPPED_REASON };
  return { copied: await readTotal(queryable, COPY_TO_HISTORY_SQL), skipped: false, reason: null };
}

/** Steps 3 and 4: the old Avance goes to the history (unless O2 skips it) and the table is emptied. */
async function archiveAndClearAvance(queryable: Queryable): Promise<HistoryOutcome> {
  const history = await copyHistory(queryable);
  await queryable.query(DELETE_AVANCE_SQL, []);
  return history;
}

async function previewIncoming(queryable: Queryable, kind: AvanceFileKind): Promise<IncomingPreview> {
  const statuses = [...EXCLUDED_DISTRICT_STATUSES];
  const breakdown = await queryable.query(BREAKDOWN_BY_STATUS_SQL[kind], [statuses]);
  const unmatchedKeys = await readTotal(queryable, COUNT_UNMATCHED_SQL[kind], [statuses, [...EXCLUDED_ZONE_NAMES]]);
  return {
    byStatus: breakdown.rows.map((row) => mapStatusCount(row as Record<string, unknown>)),
    unmatchedKeys,
  };
}

async function insertAvance(queryable: Queryable, kind: AvanceFileKind): Promise<number> {
  return readTotal(queryable, INSERT_AVANCE_SQL[kind], [[...EXCLUDED_DISTRICT_STATUSES]]);
}

async function countStaging(queryable: Queryable): Promise<Record<AvanceFileKind, number>> {
  const totals = await mapSequentially(FILE_KINDS, (kind) => readTotal(queryable, COUNT_STAGING_SQL[kind]));
  return Object.fromEntries(FILE_KINDS.map((kind, index) => [kind, totals[index]])) as Record<AvanceFileKind, number>;
}

interface RebuiltFile {
  readonly loaded: LoadedFile;
  readonly byStatus: ReadonlyArray<StatusCount>;
}

async function rebuildFromFile(
  queryable: Queryable,
  file: ParsedAvanceFile,
  junkDeleted: number
): Promise<RebuiltFile> {
  const preview = await previewIncoming(queryable, file.kind);
  const loaded: LoadedFile = {
    kind: file.kind,
    fileName: file.fileName,
    rowsLoaded: file.rows.length,
    junkDeleted,
    avanceInserted: await insertAvance(queryable, file.kind),
    unmatchedKeys: preview.unmatchedKeys,
  };
  return { loaded, byStatus: preview.byStatus };
}

/** Steps 3 to 5: archive the old Avance, empty it, and insert each file joined to the zones layer. */
async function archiveAndRebuild(
  queryable: Queryable,
  files: ReadonlyArray<ParsedAvanceFile>,
  junkCounts: ReadonlyArray<number>
): Promise<{ history: HistoryOutcome; rebuilt: RebuiltFile[] }> {
  const history = await archiveAndClearAvance(queryable);
  return { history, rebuilt: await mapSequentially(files, (file, index) => rebuildFromFile(queryable, file, junkCounts[index])) };
}

/**
 * Steps 1 to 7 of the write transaction, in the order of AC-13: staging replaced, junk deleted,
 * Avance copied to the history (or not, O2), Avance emptied (DELETE) and rebuilt from the zones layer, new
 * `fuente`, then the consistency check. The caller owns BEGIN/COMMIT/ROLLBACK.
 */
export async function rebuildAvance(
  queryable: Queryable,
  parsedFiles: ReadonlyArray<ParsedAvanceFile>
): Promise<RebuildOutcome> {
  const files = orderedFiles(parsedFiles);
  const junkCounts = await replaceStagingAndDeleteJunk(queryable, files);
  const { history, rebuilt } = await archiveAndRebuild(queryable, files, junkCounts);
  await queryable.query(UPDATE_AVANCE_FUENTE_SQL, [AVANCE_FUENTE]);

  const loaded = rebuilt.map((entry) => entry.loaded);
  assertConsistentCounts({
    files: loaded,
    stagingCounts: await countStaging(queryable),
    avanceCount: await readTotal(queryable, COUNT_AVANCE_SQL),
  });
  return { files: loaded, history, byStatus: mergeStatusCounts(rebuilt.map((entry) => entry.byStatus)) };
}
