import type { Geometry } from "geojson";
import { assemblePolygons } from "@/core/spatial/PolygonRingAssembler";

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

type CoordinateTransform = (coordinate: [number, number]) => [number, number];

function applyTransform(
  coordinates: number[][],
  transformCoordinate?: CoordinateTransform | null
): number[][] {
  return transformCoordinate
    ? coordinates.map(([rawX, rawY]) => transformCoordinate([rawX, rawY]))
    : coordinates;
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

    const fileCode = this.dataView.getInt32(0, false);
    const fileLengthWords = this.dataView.getInt32(24, false);
    const version = this.dataView.getInt32(28, true);
    const shapeType = this.dataView.getInt32(32, true);

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
      const contentLengthWords = this.dataView.getInt32(currentByteOffset + 4, false);
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

  private readPoint(
    offset: number,
    transformCoordinate?: CoordinateTransform | null
  ): [number, number] {
    const rawX = this.dataView.getFloat64(offset, true);
    const rawY = this.dataView.getFloat64(offset + 8, true);
    return transformCoordinate ? transformCoordinate([rawX, rawY]) : [rawX, rawY];
  }

  private readRawParts(
    recordOffset: number,
    numParts: number,
    numPoints: number
  ): number[][][] {
    const partsOffset = recordOffset + 44;
    const pointsOffset = partsOffset + numParts * 4;

    const partIndices: number[] = [];
    for (let partIndex = 0; partIndex < numParts; partIndex++) {
      partIndices.push(this.dataView.getInt32(partsOffset + partIndex * 4, true));
    }

    const parts: number[][][] = [];
    for (let partIndex = 0; partIndex < numParts; partIndex++) {
      const startIndex = partIndices[partIndex];
      const endIndex = partIndex + 1 < numParts ? partIndices[partIndex + 1] : numPoints;
      const coordinates: number[][] = [];

      for (let pointIndex = startIndex; pointIndex < endIndex; pointIndex++) {
        const [x, y] = this.readPoint(pointsOffset + pointIndex * 16);
        coordinates.push([x, y]);
      }
      parts.push(coordinates);
    }
    return parts;
  }

  private readPointGeometry(
    recordOffset: number,
    transformCoordinate?: CoordinateTransform | null
  ): Geometry {
    const [pointX, pointY] = this.readPoint(recordOffset + 4, transformCoordinate);
    return { type: "Point", coordinates: [pointX, pointY] };
  }

  private readMultiPointGeometry(
    recordOffset: number,
    transformCoordinate?: CoordinateTransform | null
  ): Geometry {
    const numPoints = this.dataView.getInt32(recordOffset + 36, true);
    const pointsOffset = recordOffset + 40;
    const coordinates: number[][] = [];

    for (let pointIndex = 0; pointIndex < numPoints; pointIndex++) {
      const [pointX, pointY] = this.readPoint(pointsOffset + pointIndex * 16, transformCoordinate);
      coordinates.push([pointX, pointY]);
    }

    return { type: "MultiPoint", coordinates };
  }

  private readPolyLineGeometry(
    recordOffset: number,
    transformCoordinate?: CoordinateTransform | null
  ): Geometry {
    const numParts = this.dataView.getInt32(recordOffset + 36, true);
    const numPoints = this.dataView.getInt32(recordOffset + 40, true);
    const lines = this.readRawParts(recordOffset, numParts, numPoints).map((line) =>
      applyTransform(line, transformCoordinate)
    );

    if (numParts === 1) {
      return { type: "LineString", coordinates: lines[0] };
    }
    return { type: "MultiLineString", coordinates: lines };
  }

  private readPolygonGeometry(
    recordOffset: number,
    transformCoordinate?: CoordinateTransform | null
  ): Geometry | null {
    const numParts = this.dataView.getInt32(recordOffset + 36, true);
    const numPoints = this.dataView.getInt32(recordOffset + 40, true);
    if (numParts === 0) return null;

    const rings = this.readRawParts(recordOffset, numParts, numPoints);
    const transformRing = (ring: number[][]): number[][] =>
      applyTransform(ring, transformCoordinate);

    if (numParts === 1) {
      return { type: "Polygon", coordinates: rings.map(transformRing) };
    }
    // Ring orientation is read on raw coordinates, so assembly runs before the transform.
    return {
      type: "MultiPolygon",
      coordinates: assemblePolygons(rings).map((polygon) => polygon.map(transformRing)),
    };
  }

  public readGeometry(
    recordIndex: number,
    transformCoordinate?: CoordinateTransform | null
  ): Geometry | null {
    if (recordIndex < 0 || recordIndex >= this.recordCount) {
      return null;
    }

    const recordOffset = this.recordOffsets[recordIndex] + 8;
    const recordShapeType = this.dataView.getInt32(recordOffset, true);

    switch (recordShapeType) {
      case ShapeType.NULL:
        return null;

      case ShapeType.POINT:
      case ShapeType.POINTZ:
      case ShapeType.POINTM:
        return this.readPointGeometry(recordOffset, transformCoordinate);

      case ShapeType.MULTIPOINT:
      case ShapeType.MULTIPOINTZ:
      case ShapeType.MULTIPOINTM:
        return this.readMultiPointGeometry(recordOffset, transformCoordinate);

      case ShapeType.POLYLINE:
      case ShapeType.POLYLINEZ:
      case ShapeType.POLYLINEM:
        return this.readPolyLineGeometry(recordOffset, transformCoordinate);

      case ShapeType.POLYGON:
      case ShapeType.POLYGONZ:
      case ShapeType.POLYGONM:
        return this.readPolygonGeometry(recordOffset, transformCoordinate);

      default:
        return null;
    }
  }
}
