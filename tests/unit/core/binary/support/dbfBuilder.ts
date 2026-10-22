/**
 * Builds valid in-memory .dbf buffers (dBase III layout) for BinaryDbfReader based tests.
 * Layout: 32-byte header, one 32-byte descriptor per field, 0x0D terminator, then fixed-length
 * records prefixed by a deletion flag (0x20 live, 0x2A deleted).
 */

export type DbfFieldType = "C" | "N" | "D" | "L" | "F";

export type DbfTextEncoding = "windows-1252" | "utf-8";

export interface DbfFieldSpec {
  readonly name: string;
  readonly type: DbfFieldType;
  readonly length: number;
  readonly decimalCount?: number;
}

export interface DbfRecordSpec {
  readonly values: Readonly<Record<string, string>>;
  readonly deleted?: boolean;
}

export interface DbfBuildOptions {
  readonly fields: ReadonlyArray<DbfFieldSpec>;
  readonly records: ReadonlyArray<DbfRecordSpec>;
  readonly encoding?: DbfTextEncoding;
}

const HEADER_BYTES = 32;
const FIELD_DESCRIPTOR_BYTES = 32;
const SPACE_BYTE = 0x20;
const DELETED_FLAG = 0x2a;
const LIVE_FLAG = 0x20;
const TERMINATOR = 0x0d;

function encodeText(text: string, encoding: DbfTextEncoding): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

function encodeCell(field: DbfFieldSpec, text: string, encoding: DbfTextEncoding): Uint8Array {
  const bytes = encodeText(text, encoding);
  if (bytes.length > field.length) {
    throw new Error(`DBF test value "${text}" exceeds field ${field.name} length ${field.length}`);
  }
  const cell = new Uint8Array(field.length).fill(SPACE_BYTE);
  const isRightAligned = field.type === "N" || field.type === "F";
  cell.set(bytes, isRightAligned ? field.length - bytes.length : 0);
  return cell;
}

export function buildDbfBuffer(options: DbfBuildOptions): Uint8Array {
  const { fields, records } = options;
  const encoding = options.encoding ?? "windows-1252";
  const headerLength = HEADER_BYTES + fields.length * FIELD_DESCRIPTOR_BYTES + 1;
  const recordLength = 1 + fields.reduce((total, field) => total + field.length, 0);
  const buffer = new Uint8Array(headerLength + records.length * recordLength);
  const view = new DataView(buffer.buffer);

  buffer[0] = 0x03;
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  fields.forEach((field, fieldIndex) => {
    const descriptorOffset = HEADER_BYTES + fieldIndex * FIELD_DESCRIPTOR_BYTES;
    buffer.set(encodeText(field.name, "windows-1252").subarray(0, 11), descriptorOffset);
    buffer[descriptorOffset + 11] = field.type.charCodeAt(0);
    buffer[descriptorOffset + 16] = field.length;
    buffer[descriptorOffset + 17] = field.decimalCount ?? 0;
  });
  buffer[headerLength - 1] = TERMINATOR;

  records.forEach((record, recordIndex) => {
    const recordOffset = headerLength + recordIndex * recordLength;
    buffer[recordOffset] = record.deleted ? DELETED_FLAG : LIVE_FLAG;
    let cursor = recordOffset + 1;
    for (const field of fields) {
      buffer.set(encodeCell(field, record.values[field.name] ?? "", encoding), cursor);
      cursor += field.length;
    }
  });

  return buffer;
}
