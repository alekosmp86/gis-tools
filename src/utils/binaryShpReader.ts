/**
 * binaryShpReader.ts
 * High-speed binary reader and lazy geometry decoder for ESRI Shapefiles (.shp).
 * Enables processing 1M records with minimal RAM by:
 * 1. Fast scanning record byte offsets and content lengths.
 * 2. Lazy-decoding geometries on demand when requested for comparison or map rendering.
 */

import type { Geometry } from "geojson";

export enum ShapeType {
  NULL = 0,
  POINT = 1,
  POLYLINE = 3,
  POLYGON = 5,
  MULTIPOINT = 8,
  POINTZ = 11,
  POLYLINEZ = 13,
  POLYGONZ = 15,
  MULTIPOINTZ = 18,
  POINTM = 21,
  POLYLINEM = 23,
  POLYGONM = 25,
  MULTIPOINTM = 28,
}

export interface ShpHeader {
  readonly fileCode: number;
  readonly fileLengthWords: number;
  readonly version: number;
  readonly shapeType: number;
  readonly bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

export class BinaryShpReader {
  private readonly uint8View: Uint8Array;
  private readonly dataView: DataView;
  public readonly header: ShpHeader;
  public readonly recordOffsets: Uint32Array;
  public readonly recordLengths: Uint32Array;
  public readonly recordCount: number;

  constructor(buffer: ArrayBuffer | Uint8Array | DataView) {
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

    this.header = this.parseHeader();
    const indexResult = this.buildRecordIndex();
    this.recordOffsets = indexResult.offsets;
    this.recordLengths = indexResult.lengths;
    this.recordCount = indexResult.count;
  }

  private parseHeader(): ShpHeader {
    if (this.uint8View.byteLength < 100) {
      throw new Error("El archivo SHP es demasiado pequeño para contener una cabecera válida.");
    }

    const fileCode = this.dataView.getInt32(0, false); // Big endian
    const fileLengthWords = this.dataView.getInt32(24, false); // Big endian
    const version = this.dataView.getInt32(28, true); // Little endian
    const shapeType = this.dataView.getInt32(32, true); // Little endian

    const minX = this.dataView.getFloat64(36, true);
    const minY = this.dataView.getFloat64(44, true);
    const maxX = this.dataView.getFloat64(52, true);
    const maxY = this.dataView.getFloat64(60, true);

    return {
      fileCode,
      fileLengthWords,
      version,
      shapeType,
      bbox: [minX, minY, maxX, maxY],
    };
  }

  /**
   * Fast scan to index record byte offsets without allocating GeoJSON objects.
   */
  private buildRecordIndex(): {
    offsets: Uint32Array;
    lengths: Uint32Array;
    count: number;
  } {
    const offsetsList: number[] = [];
    const lengthsList: number[] = [];
    let currentByteOffset = 100;
    const totalBytes = this.uint8View.byteLength;

    while (currentByteOffset + 8 <= totalBytes) {
      const contentLengthWords = this.dataView.getInt32(currentByteOffset + 4, false); // Big endian
      const contentLengthBytes = contentLengthWords * 2;

      offsetsList.push(currentByteOffset);
      lengthsList.push(contentLengthBytes);

      currentByteOffset += 8 + contentLengthBytes;
    }

    const count = offsetsList.length;
    const offsets = new Uint32Array(count);
    const lengths = new Uint32Array(count);

    for (let recordIndex = 0; recordIndex < count; recordIndex++) {
      offsets[recordIndex] = offsetsList[recordIndex];
      lengths[recordIndex] = lengthsList[recordIndex];
    }

    return { offsets, lengths, count };
  }

  /**
   * Lazily decodes a single geometry at the given record index into a standard GeoJSON Geometry object.
   */
  public readGeometry(recordIndex: number): Geometry | null {
    if (recordIndex < 0 || recordIndex >= this.recordCount) {
      return null;
    }

    const recordOffset = this.recordOffsets[recordIndex] + 8; // Skip 8-byte record header
    const recordShapeType = this.dataView.getInt32(recordOffset, true);

    switch (recordShapeType) {
      case ShapeType.NULL:
        return null;

      case ShapeType.POINT:
      case ShapeType.POINTZ:
      case ShapeType.POINTM: {
        const pointX = this.dataView.getFloat64(recordOffset + 4, true);
        const pointY = this.dataView.getFloat64(recordOffset + 12, true);
        return {
          type: "Point",
          coordinates: [pointX, pointY],
        };
      }

      case ShapeType.POLYLINE:
      case ShapeType.POLYLINEZ:
      case ShapeType.POLYLINEM: {
        const numParts = this.dataView.getInt32(recordOffset + 36, true);
        const numPoints = this.dataView.getInt32(recordOffset + 40, true);
        const partsOffset = recordOffset + 44;
        const pointsOffset = partsOffset + numParts * 4;

        const partIndices: number[] = [];
        for (let partIndex = 0; partIndex < numParts; partIndex++) {
          partIndices.push(this.dataView.getInt32(partsOffset + partIndex * 4, true));
        }

        const lines: number[][][] = [];
        for (let partIndex = 0; partIndex < numParts; partIndex++) {
          const startIndex = partIndices[partIndex];
          const endIndex = partIndex + 1 < numParts ? partIndices[partIndex + 1] : numPoints;
          const lineCoordinates: number[][] = [];

          for (let pointIndex = startIndex; pointIndex < endIndex; pointIndex++) {
            const coordinateX = this.dataView.getFloat64(pointsOffset + pointIndex * 16, true);
            const coordinateY = this.dataView.getFloat64(pointsOffset + pointIndex * 16 + 8, true);
            lineCoordinates.push([coordinateX, coordinateY]);
          }
          lines.push(lineCoordinates);
        }

        if (numParts === 1) {
          return {
            type: "LineString",
            coordinates: lines[0],
          };
        }
        return {
          type: "MultiLineString",
          coordinates: lines,
        };
      }

      case ShapeType.POLYGON:
      case ShapeType.POLYGONZ:
      case ShapeType.POLYGONM: {
        const numParts = this.dataView.getInt32(recordOffset + 36, true);
        const numPoints = this.dataView.getInt32(recordOffset + 40, true);
        const partsOffset = recordOffset + 44;
        const pointsOffset = partsOffset + numParts * 4;

        const partIndices: number[] = [];
        for (let partIndex = 0; partIndex < numParts; partIndex++) {
          partIndices.push(this.dataView.getInt32(partsOffset + partIndex * 4, true));
        }

        const rings: number[][][] = [];
        for (let partIndex = 0; partIndex < numParts; partIndex++) {
          const startIndex = partIndices[partIndex];
          const endIndex = partIndex + 1 < numParts ? partIndices[partIndex + 1] : numPoints;
          const ringCoordinates: number[][] = [];

          for (let pointIndex = startIndex; pointIndex < endIndex; pointIndex++) {
            const coordinateX = this.dataView.getFloat64(pointsOffset + pointIndex * 16, true);
            const coordinateY = this.dataView.getFloat64(pointsOffset + pointIndex * 16 + 8, true);
            ringCoordinates.push([coordinateX, coordinateY]);
          }
          rings.push(ringCoordinates);
        }

        if (numParts === 1) {
          return {
            type: "Polygon",
            coordinates: rings,
          };
        }
        return {
          type: "MultiPolygon",
          coordinates: [rings],
        };
      }

      default:
        return null;
    }
  }
}
