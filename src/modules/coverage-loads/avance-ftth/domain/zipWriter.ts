import { crc32 } from "node:zlib";

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
const FLAG_UTF8_NAME = 0x0800;
const METHOD_STORED = 0;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_DIRECTORY_SIZE = 22;
const DOS_YEAR_BASE = 1980;
const DOS_YEAR_SHIFT = 9;
const DOS_MONTH_SHIFT = 5;
const DOS_HOUR_SHIFT = 11;
const DOS_MINUTE_SHIFT = 5;
const DOS_SECOND_DIVISOR = 2;

interface DosTimestamp {
  readonly time: number;
  readonly date: number;
}

function toDosTimestamp(moment: Date): DosTimestamp {
  const year = Math.max(moment.getFullYear(), DOS_YEAR_BASE) - DOS_YEAR_BASE;
  return {
    date: (year << DOS_YEAR_SHIFT) | ((moment.getMonth() + 1) << DOS_MONTH_SHIFT) | moment.getDate(),
    time:
      (moment.getHours() << DOS_HOUR_SHIFT) |
      (moment.getMinutes() << DOS_MINUTE_SHIFT) |
      Math.floor(moment.getSeconds() / DOS_SECOND_DIVISOR),
  };
}

interface PlacedEntry {
  readonly nameBytes: Uint8Array;
  readonly bytes: Uint8Array;
  readonly checksum: number;
  readonly offset: number;
}

function writeLocalHeader(view: DataView, entry: PlacedEntry, stamp: DosTimestamp): void {
  view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, FLAG_UTF8_NAME, true);
  view.setUint16(8, METHOD_STORED, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  view.setUint32(14, entry.checksum, true);
  view.setUint32(18, entry.bytes.length, true);
  view.setUint32(22, entry.bytes.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
}

function writeCentralHeader(view: DataView, entry: PlacedEntry, stamp: DosTimestamp): void {
  view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, VERSION_NEEDED, true);
  view.setUint16(8, FLAG_UTF8_NAME, true);
  view.setUint16(10, METHOD_STORED, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  view.setUint32(16, entry.checksum, true);
  view.setUint32(20, entry.bytes.length, true);
  view.setUint32(24, entry.bytes.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint32(42, entry.offset, true);
}

function placeEntries(entries: ReadonlyArray<ZipEntry>): { placed: PlacedEntry[]; localSize: number } {
  const encoder = new TextEncoder();
  const placed: PlacedEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    placed.push({ nameBytes, bytes: entry.bytes, checksum: crc32(entry.bytes), offset });
    offset += LOCAL_HEADER_SIZE + nameBytes.length + entry.bytes.length;
  }
  return { placed, localSize: offset };
}

/**
 * A zip with stored (uncompressed) entries and the minimal central directory. Enough for a handful
 * of small text files; no zip64, so each entry and the archive stay under 4 GiB.
 */
export function buildZip(entries: ReadonlyArray<ZipEntry>, modifiedAt: Date): Uint8Array {
  const stamp = toDosTimestamp(modifiedAt);
  const { placed, localSize } = placeEntries(entries);
  const directorySize = placed.reduce((total, entry) => total + CENTRAL_HEADER_SIZE + entry.nameBytes.length, 0);
  const output = new Uint8Array(localSize + directorySize + END_OF_DIRECTORY_SIZE);

  for (const entry of placed) {
    const nameStart = entry.offset + LOCAL_HEADER_SIZE;
    writeLocalHeader(new DataView(output.buffer, entry.offset, LOCAL_HEADER_SIZE), entry, stamp);
    output.set(entry.nameBytes, nameStart);
    output.set(entry.bytes, nameStart + entry.nameBytes.length);
  }

  let directoryOffset = localSize;
  for (const entry of placed) {
    writeCentralHeader(new DataView(output.buffer, directoryOffset, CENTRAL_HEADER_SIZE), entry, stamp);
    output.set(entry.nameBytes, directoryOffset + CENTRAL_HEADER_SIZE);
    directoryOffset += CENTRAL_HEADER_SIZE + entry.nameBytes.length;
  }

  const end = new DataView(output.buffer, directoryOffset, END_OF_DIRECTORY_SIZE);
  end.setUint32(0, END_OF_DIRECTORY_SIGNATURE, true);
  end.setUint16(8, placed.length, true);
  end.setUint16(10, placed.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, localSize, true);
  return output;
}
