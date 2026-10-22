const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const END_RECORD_ENTRY_COUNT_OFFSET = 10;
const END_RECORD_CENTRAL_OFFSET_OFFSET = 16;
const ZIP64_OFFSET_MARKER = 0xffffffff;
const CENTRAL_HEADER_BYTES = 46;
const CENTRAL_TIME_OFFSET = 12;
const CENTRAL_DATE_OFFSET = 14;
const CENTRAL_NAME_LENGTH_OFFSET = 28;
const CENTRAL_EXTRA_LENGTH_OFFSET = 30;
const CENTRAL_COMMENT_LENGTH_OFFSET = 32;
const DOS_YEAR_EPOCH = 1980;
const MAX_DOS_MONTH = 12;
const MAX_DOS_HOUR = 23;
const MAX_DOS_MINUTE = 59;
const MAX_DOS_SECOND = 59;
const DOS_SECOND_STEP = 2;

interface CentralEntry {
  readonly name: string;
  readonly modified: Date | null;
  readonly nextOffset: number;
}

const decoder = new TextDecoder("utf-8");

function dosDateTimeToDate(dosDate: number, dosTime: number): Date | null {
  const year = DOS_YEAR_EPOCH + (dosDate >> 9);
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hours = dosTime >> 11;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * DOS_SECOND_STEP;
  if (month < 1 || month > MAX_DOS_MONTH || day < 1) return null;
  if (hours > MAX_DOS_HOUR || minutes > MAX_DOS_MINUTE || seconds > MAX_DOS_SECOND) return null;
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function findEndOfCentralDirectory(view: DataView, byteLength: number): number {
  const lowest = Math.max(0, byteLength - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  for (let offset = byteLength - END_RECORD_BYTES; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  return -1;
}

function readCentralEntry(view: DataView, offset: number, limit: number): CentralEntry | null {
  if (offset + CENTRAL_HEADER_BYTES > limit) return null;
  if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) return null;
  const nameLength = view.getUint16(offset + CENTRAL_NAME_LENGTH_OFFSET, true);
  const extraLength = view.getUint16(offset + CENTRAL_EXTRA_LENGTH_OFFSET, true);
  const commentLength = view.getUint16(offset + CENTRAL_COMMENT_LENGTH_OFFSET, true);
  const nextOffset = offset + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  if (nextOffset > limit) return null;
  const nameStart = offset + CENTRAL_HEADER_BYTES;
  const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength));
  const modified = dosDateTimeToDate(
    view.getUint16(offset + CENTRAL_DATE_OFFSET, true),
    view.getUint16(offset + CENTRAL_TIME_OFFSET, true)
  );
  return { name, modified, nextOffset };
}

export function readZipEntryDates(zipBytes: Uint8Array): Map<string, Date> {
  const dates = new Map<string, Date>();
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view, zipBytes.byteLength);
  if (endOffset === -1) return dates;

  const entryCount = view.getUint16(endOffset + END_RECORD_ENTRY_COUNT_OFFSET, true);
  const centralOffset = view.getUint32(endOffset + END_RECORD_CENTRAL_OFFSET_OFFSET, true);
  if (centralOffset === ZIP64_OFFSET_MARKER || centralOffset > endOffset) return dates;

  let cursor = centralOffset;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
    const entry = readCentralEntry(view, cursor, endOffset);
    if (!entry) return new Map();
    if (entry.modified) dates.set(entry.name.toLowerCase(), entry.modified);
    cursor = entry.nextOffset;
  }
  return dates;
}
