/**
 * Builds in-memory ZIP archives with STORED (method 0) entries, for ZIP reading tests.
 * Only the subset of the PKWARE format needed by unzip readers is written.
 */

export interface StoredZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly modified?: Date;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const VERSION_NEEDED = 20;
const DOS_DATE_1980_01_01 = 0x0021;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): number {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function dosDate(date: Date): number {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

export function buildStoredZip(entries: ReadonlyArray<StoredZipEntry>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const size = entry.data.length;
    const checksum = crc32(entry.data);
    const time = entry.modified ? dosTime(entry.modified) : 0;
    const date = entry.modified ? dosDate(entry.modified) : DOS_DATE_1980_01_01;

    const localHeader = new Uint8Array(LOCAL_HEADER_BYTES + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(4, VERSION_NEEDED, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, LOCAL_HEADER_BYTES);
    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(CENTRAL_HEADER_BYTES + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    centralView.setUint16(4, VERSION_NEEDED, true);
    centralView.setUint16(6, VERSION_NEEDED, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, CENTRAL_HEADER_BYTES);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + size;
  }

  const centralDirectory = concatBytes(centralParts);
  const endRecord = new Uint8Array(END_OF_CENTRAL_DIRECTORY_BYTES);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);

  return concatBytes([...localParts, centralDirectory, endRecord]);
}
