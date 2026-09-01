/**
 * binaryDbfReader.ts
 * High-performance, zero-allocation binary parser for dBase III / IV (.dbf) files.
 * Designed to process 1,000,000+ records in RAM with minimal GC overhead by:
 * 1. Avoiding ArrayBuffer slices (using Uint8Array.subarray views).
 * 2. Utilizing string interning for categorical & repetitive values.
 * 3. Supporting lazy record decoding on demand.
 */

import { StringInternPool } from "./stringInternPool";

export interface DbfFieldDescriptor {
  readonly name: string;
  readonly dataType: string;
  readonly length: number;
  readonly decimalCount: number;
  readonly byteOffsetInRecord: number;
}

export interface DbfHeader {
  readonly recordCount: number;
  readonly headerLength: number;
  readonly recordLength: number;
  readonly fields: DbfFieldDescriptor[];
}

export class BinaryDbfReader {
  private readonly uint8View: Uint8Array;
  private readonly dataView: DataView;
  private readonly decoder: TextDecoder;
  private readonly internPool: StringInternPool;
  public readonly header: DbfHeader;

  constructor(
    buffer: ArrayBuffer | Uint8Array | DataView,
    encoding: string = "windows-1252",
    internPool?: StringInternPool
  ) {
    if (buffer instanceof DataView) {
      this.dataView = buffer;
      this.uint8View = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (buffer instanceof Uint8Array) {
      this.uint8View = buffer;
      this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.uint8View = new Uint8Array(buffer);
      this.dataView = new DataView(buffer);
    }

    try {
      this.decoder = new TextDecoder(encoding);
    } catch {
      this.decoder = new TextDecoder("utf-8");
    }

    this.internPool = internPool ?? new StringInternPool(100_000);
    this.header = this.parseHeader();
  }

  /**
   * Parses the 32-byte main header and field descriptor table.
   */
  private parseHeader(): DbfHeader {
    if (this.uint8View.byteLength < 32) {
      throw new Error("El archivo DBF es demasiado pequeño para contener una cabecera válida.");
    }

    const recordCount = this.dataView.getUint32(4, true);
    const headerLength = this.dataView.getUint16(8, true);
    const recordLength = this.dataView.getUint16(10, true);

    const fields: DbfFieldDescriptor[] = [];
    let currentFieldOffset = 32;
    let accumulatedRecordOffset = 1; // 1 byte deletion flag at the beginning of each record

    while (currentFieldOffset < headerLength - 1) {
      const terminatorCheck = this.uint8View[currentFieldOffset];
      if (terminatorCheck === 0x0d || terminatorCheck === 0x00) {
        break;
      }

      // Read field name (up to 11 bytes, null-terminated)
      let nameLength = 0;
      while (
        nameLength < 11 &&
        this.uint8View[currentFieldOffset + nameLength] !== 0x00
      ) {
        nameLength++;
      }

      const nameBytes = this.uint8View.subarray(
        currentFieldOffset,
        currentFieldOffset + nameLength
      );
      const rawFieldName = this.decoder.decode(nameBytes).trim();
      const fieldType = String.fromCharCode(this.uint8View[currentFieldOffset + 11]);
      const fieldLength = this.uint8View[currentFieldOffset + 16];
      const decimalCount = this.uint8View[currentFieldOffset + 17];

      fields.push({
        name: rawFieldName,
        dataType: fieldType,
        length: fieldLength,
        decimalCount: decimalCount,
        byteOffsetInRecord: accumulatedRecordOffset,
      });

      accumulatedRecordOffset += fieldLength;
      currentFieldOffset += 32;
    }

    return {
      recordCount,
      headerLength,
      recordLength,
      fields,
    };
  }

  /**
   * Reads a single field value from a given record index with type conversion and string interning.
   */
  public readFieldValue(recordIndex: number, field: DbfFieldDescriptor): unknown {
    if (recordIndex < 0 || recordIndex >= this.header.recordCount) {
      return null;
    }

    const recordStart = this.header.headerLength + recordIndex * this.header.recordLength;
    const isDeleted = this.uint8View[recordStart] === 0x2a; // '*' indicates deleted record
    if (isDeleted) {
      return null;
    }

    const fieldStart = recordStart + field.byteOffsetInRecord;
    const fieldBytes = this.uint8View.subarray(fieldStart, fieldStart + field.length);
    const rawText = this.decoder.decode(fieldBytes).trim();

    if (rawText === "") {
      return null;
    }

    switch (field.dataType) {
      case "N":
      case "F":
      case "O": {
        const parsedNumber = Number(rawText);
        return isNaN(parsedNumber) ? null : parsedNumber;
      }
      case "L": {
        const lowerChar = rawText.toLowerCase();
        return lowerChar === "y" || lowerChar === "t" || lowerChar === "1";
      }
      case "D": {
        // Date format: YYYYMMDD
        if (rawText.length === 8) {
          const year = rawText.substring(0, 4);
          const month = rawText.substring(4, 6);
          const day = rawText.substring(6, 8);
          return `${year}-${month}-${day}`;
        }
        return rawText;
      }
      case "C":
      default:
        return this.internPool.intern(rawText);
    }
  }

  /**
   * Reads an entire record at the specified index as a key-value object.
   */
  public readRecord(recordIndex: number): Record<string, unknown> | null {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < this.header.fields.length; index++) {
      const fieldDescriptor = this.header.fields[index];
      record[fieldDescriptor.name] = this.readFieldValue(recordIndex, fieldDescriptor);
    }
    return record;
  }
}
