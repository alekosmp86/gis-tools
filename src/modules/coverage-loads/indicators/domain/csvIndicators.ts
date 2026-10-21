import {
  Cobertura,
  CsvColumn,
  EXPECTED_COLUMN_COUNT,
  NOMBDEPTO_MAX_LENGTH,
  NOMBLOC_MAX_LENGTH,
  NULL_MARKER,
  PORCENTAJE_MAX,
} from "../constants";
import { CSV_ENCLOSURE, CSV_SEPARATOR } from "../../constants";
import { ParseKind } from "../types";
import type { FileError, IndicatorRow, ParseOutcome, RejectedRow } from "../types";
import { parseIndicatorsFileName } from "./fileName";
import { decodeLatin1 } from "../../shared/domain/latin1";

const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";
const NUMBER_PATTERN = /^\d+(\.\d+)?$/;
const HEADER_RECORD_COUNT = 1;
const KEY_JOINER = "\u0000";
const NUL_CHARACTER = "\u0000";
const REJECTED_TEXT_MAX_LENGTH = 500;
const REJECTED_VALUE_ECHO_MAX_LENGTH = 50;
const TRUNCATION_MARKER = "…";

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + TRUNCATION_MARKER : text;
}

const echo = (value: string) => truncate(value, REJECTED_VALUE_ECHO_MAX_LENGTH);

export const RejectionReason = {
  columnCount: (found: number) => `Se esperaban ${EXPECTED_COLUMN_COUNT} columnas y hay ${found}.`,
  emptyDepartamento: () => "El departamento está vacío.",
  emptyLocalidad: () => "La localidad está vacía.",
  departamentoTooLong: (length: number) =>
    `El departamento tiene ${length} caracteres y el máximo es ${NOMBDEPTO_MAX_LENGTH}.`,
  localidadTooLong: (length: number) =>
    `La localidad tiene ${length} caracteres y el máximo es ${NOMBLOC_MAX_LENGTH}.`,
  porcentajeNotNumber: (value: string) => `El porcentaje "${echo(value)}" no es un número.`,
  porcentajeOutOfRange: (value: string) => `El porcentaje ${echo(value)} supera el máximo de ${PORCENTAJE_MAX}.`,
  coberturaInvalid: (value: string) => `La cobertura "${echo(value)}" no es SI ni NO.`,
  containsNul: () => "contiene un carácter nulo (NUL).",
  unterminatedQuote: () => "comilla sin cerrar.",
  duplicateKey: (firstLine: number) =>
    `El departamento y la localidad ya figuran en la línea ${firstLine}; se conserva la primera.`,
} as const;

export const FileRejection = {
  empty: (fileName: string) => `El archivo "${fileName}" no tiene filas de datos.`,
  noValidRows: (fileName: string, rejected: number) =>
    `El archivo "${fileName}" no tiene ninguna fila válida (${rejected} rechazadas).`,
  unreadable: (fileName: string) => `No se pudo leer el archivo "${fileName}".`,
  tooLarge: (fileName: string, maxBytes: number) =>
    `El archivo "${fileName}" supera el tamaño máximo de ${maxBytes} bytes.`,
} as const;

interface RawRecord {
  readonly line: number;
  readonly raw: string;
  readonly fields: ReadonlyArray<string>;
  readonly unterminatedQuote: boolean;
}

/**
 * Splits text into records: `;` separated, `"` enclosure (with `""` as an escaped quote and line
 * breaks allowed inside), LF, CRLF or a lone CR ending a record. Each record keeps its raw source
 * text and the 1-based physical line it starts on.
 */
export function tokenizeRecords(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let current = "";
  let inEnclosure = false;
  let atFieldStart = true;
  let recordStart = 0;
  let recordLine = 1;
  let line = 1;

  const finishRecord = (endIndex: number) => {
    fields.push(current);
    records.push({
      line: recordLine,
      raw: text.slice(recordStart, endIndex),
      fields,
      unterminatedQuote: inEnclosure,
    });
    fields = [];
    current = "";
    atFieldStart = true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inEnclosure) {
      if (char === CSV_ENCLOSURE && text[index + 1] === CSV_ENCLOSURE) {
        current += CSV_ENCLOSURE;
        index += 1;
      } else if (char === CSV_ENCLOSURE) {
        inEnclosure = false;
      } else {
        current += char;
        if (char === LINE_FEED) line += 1;
      }
    } else if (char === CSV_ENCLOSURE && atFieldStart) {
      inEnclosure = true;
      atFieldStart = false;
    } else if (char === CSV_SEPARATOR) {
      fields.push(current);
      current = "";
      atFieldStart = true;
    } else if (char === LINE_FEED || char === CARRIAGE_RETURN) {
      finishRecord(index);
      if (char === CARRIAGE_RETURN && text[index + 1] === LINE_FEED) index += 1;
      line += 1;
      recordStart = index + 1;
      recordLine = line;
    } else {
      current += char;
      atFieldStart = false;
    }
  }
  if (recordStart < text.length) finishRecord(text.length);
  return records;
}

function normalizeField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === NULL_MARKER ? null : trimmed;
}

type RowValidation =
  | { readonly row: IndicatorRow; readonly reason?: undefined }
  | { readonly row?: undefined; readonly reason: string };

function validateNames(departamento: string | null, localidad: string | null): string | null {
  if (!departamento) return RejectionReason.emptyDepartamento();
  if (!localidad) return RejectionReason.emptyLocalidad();
  if (departamento.length > NOMBDEPTO_MAX_LENGTH) return RejectionReason.departamentoTooLong(departamento.length);
  if (localidad.length > NOMBLOC_MAX_LENGTH) return RejectionReason.localidadTooLong(localidad.length);
  return null;
}

function validatePorcentaje(porcentaje: string | null): string | null {
  if (porcentaje === null || !NUMBER_PATTERN.test(porcentaje)) {
    return RejectionReason.porcentajeNotNumber(porcentaje ?? NULL_MARKER);
  }
  return Number(porcentaje) > PORCENTAJE_MAX ? RejectionReason.porcentajeOutOfRange(porcentaje) : null;
}

function validateCobertura(cobertura: string | null): string | null {
  const knownValues: ReadonlyArray<string> = [Cobertura.YES, Cobertura.NO];
  const isKnown = cobertura !== null && knownValues.includes(cobertura.toUpperCase());
  return isKnown ? null : RejectionReason.coberturaInvalid(cobertura ?? NULL_MARKER);
}

function validateFields(rawFields: ReadonlyArray<string>): RowValidation {
  if (rawFields.length !== EXPECTED_COLUMN_COUNT) {
    return { reason: RejectionReason.columnCount(rawFields.length) };
  }
  if (rawFields.some((field) => field.includes(NUL_CHARACTER))) {
    return { reason: RejectionReason.containsNul() };
  }

  const departamento = normalizeField(rawFields[CsvColumn.DEPARTAMENTO]);
  const localidad = normalizeField(rawFields[CsvColumn.LOCALIDAD]);
  const porcentaje = normalizeField(rawFields[CsvColumn.PORCENTAJE]);
  const cobertura = normalizeField(rawFields[CsvColumn.COBERTURA]);

  const problem =
    validateNames(departamento, localidad) ?? validatePorcentaje(porcentaje) ?? validateCobertura(cobertura);
  if (problem !== null) return { reason: problem };

  return {
    row: {
      departamento: departamento as string,
      localidad: localidad as string,
      porcentaje: porcentaje as string,
      cobertura: cobertura as string,
    },
  };
}

function truncateText(text: string): string {
  return truncate(text, REJECTED_TEXT_MAX_LENGTH);
}

function isBlankRecord(record: RawRecord): boolean {
  return record.raw.trim() === "";
}

interface ValidatedRows {
  readonly rows: IndicatorRow[];
  readonly rejected: RejectedRow[];
}

/** Validates every record; a repeated (departamento, localidad) keeps its first occurrence. */
function validateRecords(fileName: string, records: ReadonlyArray<RawRecord>): ValidatedRows {
  const rows: IndicatorRow[] = [];
  const rejected: RejectedRow[] = [];
  const firstLineByKey = new Map<string, number>();

  for (const record of records) {
    const validation = record.unterminatedQuote
      ? { reason: RejectionReason.unterminatedQuote() }
      : validateFields(record.fields);
    const rejection = (reason: string): RejectedRow => ({
      file: fileName,
      line: record.line,
      text: truncateText(record.raw),
      reason,
    });

    if (validation.row === undefined) {
      rejected.push(rejection(validation.reason));
      continue;
    }
    const key = validation.row.departamento + KEY_JOINER + validation.row.localidad;
    const firstLine = firstLineByKey.get(key);
    if (firstLine !== undefined) {
      rejected.push(rejection(RejectionReason.duplicateKey(firstLine)));
      continue;
    }
    firstLineByKey.set(key, record.line);
    rows.push(validation.row);
  }
  return { rows, rejected };
}

export function buildFileError(fileName: string, message: string): ParseOutcome {
  const error: FileError = { fileName, message };
  return { kind: ParseKind.ERROR, error };
}

/**
 * Parses one uploaded file: name rule, ISO-8859-1 decoding, header skipped, rows validated. Bad
 * rows are listed, not fatal; only a bad name, no data rows, or no valid row rejects the file.
 */
export function parseIndicatorsFile(fileName: string, content: Uint8Array): ParseOutcome {
  const name = parseIndicatorsFileName(fileName);
  if (!name.ok) return buildFileError(fileName, name.message);

  const dataRecords = tokenizeRecords(decodeLatin1(content))
    .slice(HEADER_RECORD_COUNT)
    .filter((record) => !isBlankRecord(record));
  if (dataRecords.length === 0) return buildFileError(fileName, FileRejection.empty(fileName));

  const { rows, rejected } = validateRecords(fileName, dataRecords);
  if (rows.length === 0) return buildFileError(fileName, FileRejection.noValidRows(fileName, rejected.length));

  return { kind: ParseKind.CUT, cut: { fileName, fechaact: name.fechaact, rows, rejected } };
}
