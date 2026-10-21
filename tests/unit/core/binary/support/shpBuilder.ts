/**
 * Builds valid in-memory .shp buffers for BinaryShpReader tests.
 * Layout follows the ESRI shapefile specification (100-byte header, then records
 * with an 8-byte big-endian record header and a little-endian content body).
 */

export type ShpRing = number[][];

export type ShpRecord =
  | { readonly kind: "null" }
  | { readonly kind: "point"; readonly shapeType: 1 | 11 | 21; readonly point: [number, number] }
  | { readonly kind: "polygon"; readonly shapeType: 5 | 15 | 25; readonly rings: ShpRing[] };

const HEADER_BYTES = 100;
const RECORD_HEADER_BYTES = 8;
const BYTES_PER_POINT = 16;

export function polygonRecord(rings: ShpRing[], shapeType: 5 | 15 | 25 = 5): ShpRecord {
  return { kind: "polygon", shapeType, rings };
}

export function pointRecord(point: [number, number], shapeType: 1 | 11 | 21 = 1): ShpRecord {
  return { kind: "point", shapeType, point };
}

export function nullRecord(): ShpRecord {
  return { kind: "null" };
}

function computePointContentBytes(shapeType: 1 | 11 | 21): number {
  // shape type + X + Y, plus an 8-byte Z (PointZ) and 8-byte M (PointZ/PointM) value.
  if (shapeType === 1) return 4 + 16;
  if (shapeType === 11) return 4 + 16 + 8 + 8;
  return 4 + 16 + 8;
}

function computeContentBytes(record: ShpRecord): number {
  if (record.kind === "null") return 4;
  if (record.kind === "point") return computePointContentBytes(record.shapeType);
  const pointCount = record.rings.reduce((total, ring) => total + ring.length, 0);
  const baseBytes = 4 + 32 + 4 + 4 + record.rings.length * 4 + pointCount * BYTES_PER_POINT;
  // Z and M blocks (range + one value per point) are zero filled and ignored by the reader.
  const rangeAndValuesBytes = 16 + pointCount * 8;
  if (record.shapeType === 15) return baseBytes + 2 * rangeAndValuesBytes;
  if (record.shapeType === 25) return baseBytes + rangeAndValuesBytes;
  return baseBytes;
}

function writePolygonBody(view: DataView, bodyOffset: number, rings: ShpRing[]): void {
  const allPoints = rings.flat();
  const xs = allPoints.map(([pointX]) => pointX);
  const ys = allPoints.map(([, pointY]) => pointY);
  view.setFloat64(bodyOffset + 4, allPoints.length ? Math.min(...xs) : 0, true);
  view.setFloat64(bodyOffset + 12, allPoints.length ? Math.min(...ys) : 0, true);
  view.setFloat64(bodyOffset + 20, allPoints.length ? Math.max(...xs) : 0, true);
  view.setFloat64(bodyOffset + 28, allPoints.length ? Math.max(...ys) : 0, true);
  view.setInt32(bodyOffset + 36, rings.length, true);
  view.setInt32(bodyOffset + 40, allPoints.length, true);

  let partStart = 0;
  rings.forEach((ring, ringIndex) => {
    view.setInt32(bodyOffset + 44 + ringIndex * 4, partStart, true);
    partStart += ring.length;
  });

  const pointsOffset = bodyOffset + 44 + rings.length * 4;
  allPoints.forEach(([pointX, pointY], pointIndex) => {
    view.setFloat64(pointsOffset + pointIndex * BYTES_PER_POINT, pointX, true);
    view.setFloat64(pointsOffset + pointIndex * BYTES_PER_POINT + 8, pointY, true);
  });
}

export function buildShpBuffer(records: ShpRecord[]): ArrayBuffer {
  const contentSizes = records.map(computeContentBytes);
  const totalBytes =
    HEADER_BYTES + contentSizes.reduce((total, size) => total + RECORD_HEADER_BYTES + size, 0);
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  view.setInt32(0, 9994, false);
  view.setInt32(24, totalBytes / 2, false);
  view.setInt32(28, 1000, true);
  const headerShapeType = records.reduce(
    (found, record) => (found === 0 && record.kind !== "null" ? record.shapeType : found),
    0 as number
  );
  view.setInt32(32, headerShapeType, true);

  let recordOffset = HEADER_BYTES;
  records.forEach((record, recordIndex) => {
    const contentBytes = contentSizes[recordIndex];
    view.setInt32(recordOffset, recordIndex + 1, false);
    view.setInt32(recordOffset + 4, contentBytes / 2, false);
    const bodyOffset = recordOffset + RECORD_HEADER_BYTES;

    if (record.kind === "null") {
      view.setInt32(bodyOffset, 0, true);
    } else if (record.kind === "point") {
      view.setInt32(bodyOffset, record.shapeType, true);
      view.setFloat64(bodyOffset + 4, record.point[0], true);
      view.setFloat64(bodyOffset + 12, record.point[1], true);
    } else {
      view.setInt32(bodyOffset, record.shapeType, true);
      writePolygonBody(view, bodyOffset, record.rings);
    }
    recordOffset += RECORD_HEADER_BYTES + contentBytes;
  });

  return buffer;
}
