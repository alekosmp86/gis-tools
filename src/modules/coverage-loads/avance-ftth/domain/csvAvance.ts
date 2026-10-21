import {
  AVANCE_COLUMNS,
  AvanceColumnKey,
  AvanceFileKind,
  EXCLUDED_ZONE_NAMES,
  EXPECTED_COLUMN_COUNT,
  JUNK_CONCA_PREFIX,
  NOT_AVAILABLE_EDIFICIO,
  NULL_MARKER,
  REJECTED_LIST_CAP,
  REJECTED_TEXT_MAX_LENGTH,
} from "../constants";
import { ParseKind } from "../types";
import type { AvanceRow, FileError, ParseOutcome, ParsedAvanceFile, RejectedRow } from "../types";
import { tokenizeRecords, type RawRecord } from "./csvTokenizer";
import { parseAvanceFileName } from "./fileName";
import { decodeLatin1 } from "../../shared/domain/latin1";

const HEADER_RECORD_COUNT = 1;
const NUL_CHARACTER = "\u0000";
const KEY_JOINER = "\u0000";
const TRUNCATION_MARKER = "…";

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + TRUNCATION_MARKER : text;
}

const RejectionReason = {
  columnCount: (found: number) => `Se esperaban ${EXPECTED_COLUMN_COUNT} columnas y hay ${found}.`,
  fieldTooLong: (column: string, length: number, maxLength: number) =>
    `El campo ${column} tiene ${length} caracteres y el máximo es ${maxLength}.`,
  containsNul: () => "contiene un carácter nulo (NUL).",
  unterminatedQuote: () => "comilla sin cerrar.",
} as const;

export const FileRejection = {
  unreadable: (fileName: string) => `No se pudo leer el archivo "${fileName}".`,
  tooLarge: (fileName: string, maxBytes: number) =>
    `El archivo "${fileName}" supera el tamaño máximo de ${maxBytes} bytes.`,
} as const;

type RowValidation =
  | { readonly row: AvanceRow; readonly reason?: undefined }
  | { readonly row?: undefined; readonly reason: string };

/** Trims (U+00A0 included, which the legacy trim left in the data) and maps empty to `null`. */
function normalizeField(value: string, kind: AvanceFileKind, key: AvanceColumnKey): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return isNullMarker(trimmed, kind, key) ? null : trimmed;
}

/** Legacy `nullif -` exists for the Interior file only, and not on the `plano_al_com` date field. */
function isNullMarker(trimmed: string, kind: AvanceFileKind, key: AvanceColumnKey): boolean {
  return kind === AvanceFileKind.INT && key !== AvanceColumnKey.PLANO_AL_COM && trimmed === NULL_MARKER;
}

function findOverlongField(row: AvanceRow): string | null {
  for (const column of AVANCE_COLUMNS) {
    const value = row[column.key];
    if (value !== null && value.length > column.maxLength) {
      return RejectionReason.fieldTooLong(column.key, value.length, column.maxLength);
    }
  }
  return null;
}

function buildRow(rawFields: ReadonlyArray<string>, kind: AvanceFileKind): AvanceRow {
  const entries = AVANCE_COLUMNS.map((column, index) => [column.key, normalizeField(rawFields[index], kind, column.key)] as const);
  return Object.fromEntries(entries) as AvanceRow;
}

/** A trailing separator adds an empty 11th column, which the legacy files carry and ignore. */
function dropEmptyTrailingColumn(rawFields: ReadonlyArray<string>): ReadonlyArray<string> {
  const extraColumn = rawFields.length === EXPECTED_COLUMN_COUNT + 1 && rawFields[EXPECTED_COLUMN_COUNT].trim() === "";
  return extraColumn ? rawFields.slice(0, EXPECTED_COLUMN_COUNT) : rawFields;
}

function validateFields(recordFields: ReadonlyArray<string>, kind: AvanceFileKind): RowValidation {
  const rawFields = dropEmptyTrailingColumn(recordFields);
  if (rawFields.length !== EXPECTED_COLUMN_COUNT) return { reason: RejectionReason.columnCount(rawFields.length) };
  if (rawFields.some((field) => field.includes(NUL_CHARACTER))) return { reason: RejectionReason.containsNul() };

  const row = buildRow(rawFields, kind);
  const problem = findOverlongField(row);
  return problem === null ? { row } : { reason: problem };
}

function isBlankRecord(record: RawRecord): boolean {
  return record.raw.trim() === "";
}

function isJunkRow(row: AvanceRow): boolean {
  return row[AvanceColumnKey.CONCA]?.startsWith(JUNK_CONCA_PREFIX) === true;
}

function hasEmptyEdificio(row: AvanceRow): boolean {
  const edificio = row[AvanceColumnKey.EDIFICIO];
  return edificio === null || edificio === NOT_AVAILABLE_EDIFICIO;
}

/** Distinct (edificio, cable, zona) keys that repeat, leaving out the zones the legacy report skipped. */
function countDuplicateKeys(rows: ReadonlyArray<AvanceRow>): number {
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const edificio = row[AvanceColumnKey.EDIFICIO];
    const cable = row[AvanceColumnKey.CABLE];
    const zona = row[AvanceColumnKey.ZONA];
    if (edificio === null || cable === null || zona === null || EXCLUDED_ZONE_NAMES.includes(zona)) continue;
    const key = [edificio, cable, zona].join(KEY_JOINER);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  return [...occurrences.values()].filter((count) => count > 1).length;
}

interface ValidatedRows {
  readonly rows: AvanceRow[];
  readonly rejected: RejectedRow[];
  readonly rejectedTotal: number;
}

function validateRecords(fileName: string, kind: AvanceFileKind, records: ReadonlyArray<RawRecord>): ValidatedRows {
  const rows: AvanceRow[] = [];
  const rejected: RejectedRow[] = [];
  let rejectedTotal = 0;

  for (const record of records) {
    const validation = record.unterminatedQuote
      ? { reason: RejectionReason.unterminatedQuote() }
      : validateFields(record.fields, kind);
    if (validation.row !== undefined) {
      rows.push(validation.row);
      continue;
    }
    rejectedTotal += 1;
    if (rejected.length < REJECTED_LIST_CAP) {
      rejected.push({
        file: fileName,
        line: record.line,
        text: truncate(record.raw, REJECTED_TEXT_MAX_LENGTH),
        reason: validation.reason,
      });
    }
  }
  return { rows, rejected, rejectedTotal };
}

export function buildFileError(fileName: string, message: string): ParseOutcome {
  const error: FileError = { fileName, message };
  return { kind: ParseKind.ERROR, error };
}

/**
 * Parses one uploaded file: name rule, ISO-8859-1 decoding, header skipped, rows validated. Bad
 * rows are listed, not fatal; only a bad name rejects the file here (a file without a single
 * valid row is a blocker of the plan).
 */
export function parseAvanceFile(fileName: string, content: Uint8Array): ParseOutcome {
  const name = parseAvanceFileName(fileName);
  if (!name.ok) return buildFileError(fileName, name.message);

  const dataRecords = tokenizeRecords(decodeLatin1(content))
    .slice(HEADER_RECORD_COUNT)
    .filter((record) => !isBlankRecord(record));
  const { rows, rejected, rejectedTotal } = validateRecords(fileName, name.kind, dataRecords);

  const file: ParsedAvanceFile = {
    kind: name.kind,
    fileName,
    fechaact: name.fechaact,
    rows,
    rowsRead: dataRecords.length,
    rejected,
    rejectedTotal,
    junkRows: rows.filter(isJunkRow).length,
    emptyEdificioRows: rows.filter(hasEmptyEdificio).length,
    duplicateKeys: countDuplicateKeys(rows),
  };
  return { kind: ParseKind.FILE, file };
}
