import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import {
  CorruptShapefileError,
  NotAShapefileError,
  ShapefileNotFoundError,
  ShapefileUnreadableError,
  UnsupportedShapeError,
} from "./errors.ts";
import { readExact } from "./fileIo.ts";
import { SHAPE_TYPE } from "./types.ts";
import type { ShpRecordHeader } from "./types.ts";

const HEADER_BYTES = 100;
const FILE_CODE = 9994;
const RECORD_PREFIX_BYTES = 52;
const POLYGON_FIXED_BYTES = 44;
const EMPTY_PARTS = new Int32Array(0);

export interface ShapefileHandle {
  path: string;
  fh: FileHandle;
  size: number;
  close: () => Promise<void>;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export async function openShapefile(path: string): Promise<ShapefileHandle> {
  let fh: FileHandle;
  let size: number;
  try {
    fh = await open(path, "r");
    size = (await fh.stat()).size;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") throw new ShapefileNotFoundError(path);
    throw new ShapefileUnreadableError(path, error instanceof Error ? error.message : String(error));
  }
  try {
    if (size < HEADER_BYTES) {
      throw new NotAShapefileError(path, `tamaño ${size} menor al encabezado de ${HEADER_BYTES} bytes.`);
    }
    const bytes = new Uint8Array(HEADER_BYTES);
    await readExact(fh, bytes, 0, HEADER_BYTES, 0);
    const view = new DataView(bytes.buffer);
    const fileCode = view.getInt32(0, false);
    if (fileCode !== FILE_CODE) {
      throw new NotAShapefileError(path, `código de archivo ${fileCode}, se esperaba ${FILE_CODE}.`);
    }
    const declaredLength = view.getInt32(24, false) * 2;
    if (declaredLength > size) {
      throw new CorruptShapefileError(`el encabezado declara ${declaredLength} bytes pero el archivo tiene ${size}.`);
    }
    const shapeType = view.getInt32(32, true);
    if (shapeType !== SHAPE_TYPE.Polygon) throw new UnsupportedShapeError(shapeType, null);
    return { path, fh, size, close: () => fh.close() };
  } catch (error) {
    await fh.close();
    throw error;
  }
}

/** Walks the record table in file order; points are not read. */
export async function* walkRecords(
  file: ShapefileHandle,
  signal?: AbortSignal,
): AsyncGenerator<ShpRecordHeader, void, undefined> {
  const prefix = new Uint8Array(RECORD_PREFIX_BYTES);
  const view = new DataView(prefix.buffer);
  let off = HEADER_BYTES;
  while (off < file.size) {
    signal?.throwIfAborted();
    const available = Math.min(RECORD_PREFIX_BYTES, file.size - off);
    if (available < 12) {
      throw new CorruptShapefileError(`registro incompleto en el byte ${off}.`);
    }
    await readExact(file.fh, prefix, 0, available, off);
    const recordNumber = view.getInt32(0, false);
    const contentLength = view.getInt32(4, false) * 2;
    if (contentLength < 4) {
      throw new CorruptShapefileError(`longitud de contenido inválida (${contentLength}).`, recordNumber);
    }
    if (off + 8 + contentLength > file.size) {
      throw new CorruptShapefileError(
        `la longitud declarada (${contentLength} bytes) excede el fin del archivo.`,
        recordNumber,
      );
    }
    const shapeType = view.getInt32(8, true);
    const contentOffset = off + 8;
    if (shapeType === SHAPE_TYPE.Null) {
      yield { recordNumber, shapeType, contentOffset, contentLength, numParts: 0, numPoints: 0, parts: EMPTY_PARTS, pointsOffset: 0 };
    } else if (shapeType !== SHAPE_TYPE.Polygon) {
      throw new UnsupportedShapeError(shapeType, recordNumber);
    } else {
      if (contentLength < POLYGON_FIXED_BYTES) {
        throw new CorruptShapefileError(`contenido de polígono demasiado corto (${contentLength}).`, recordNumber);
      }
      const numParts = view.getInt32(8 + 36, true);
      const numPoints = view.getInt32(8 + 40, true);
      if (numParts < 0 || numPoints < 0) {
        throw new CorruptShapefileError(`conteos negativos (partes ${numParts}, puntos ${numPoints}).`, recordNumber);
      }
      if (contentLength !== POLYGON_FIXED_BYTES + 4 * numParts + 16 * numPoints) {
        throw new CorruptShapefileError(
          `la longitud (${contentLength}) no coincide con ${numParts} partes y ${numPoints} puntos.`,
          recordNumber,
        );
      }
      const parts = new Int32Array(numParts + 1);
      if (numParts > 0) {
        await readExact(file.fh, new Uint8Array(parts.buffer, 0, numParts * 4), 0, numParts * 4, contentOffset + POLYGON_FIXED_BYTES);
        validateParts(parts, numParts, numPoints, recordNumber);
      }
      parts[numParts] = numPoints;
      yield {
        recordNumber,
        shapeType,
        contentOffset,
        contentLength,
        numParts,
        numPoints,
        parts,
        pointsOffset: contentOffset + POLYGON_FIXED_BYTES + 4 * numParts,
      };
    }
    off += 8 + contentLength;
  }
}

function validateParts(parts: Int32Array, numParts: number, numPoints: number, recordNumber: number): void {
  if (parts[0] !== 0) {
    throw new CorruptShapefileError(`el primer índice de partes es ${parts[0]}, se esperaba 0.`, recordNumber);
  }
  let previous = 0;
  for (let i = 0; i < numParts; i++) {
    const start = parts[i] as number;
    if (start < previous || start > numPoints) {
      throw new CorruptShapefileError(`índice de parte fuera de rango (${start}, parte ${i}).`, recordNumber);
    }
    previous = start;
  }
}
