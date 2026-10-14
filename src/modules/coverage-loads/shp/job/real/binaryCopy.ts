import type { Writable } from "node:stream";

/** PostgreSQL binary COPY framing. A geometry field is its EWKB bytes, exactly what `geometry_recv` reads. */

const SIGNATURE = [0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00];
const FIELD_COUNT_BYTES = 2;
const LENGTH_BYTES = 4;
const INT4_BYTES = 4;
const STAGE_FIELDS = 3;
const TRAILER_MARKER = -1;

const MAX_FIELD_BYTES = 0x3fffffff;

export function binaryCopyHeader(): Buffer {
  const header = Buffer.alloc(SIGNATURE.length + 2 * LENGTH_BYTES);
  Buffer.from(SIGNATURE).copy(header);
  return header;
}

export function binaryCopyTrailer(): Buffer {
  const trailer = Buffer.alloc(FIELD_COUNT_BYTES);
  trailer.writeInt16BE(TRAILER_MARKER, 0);
  return trailer;
}

/** Everything of one (rec, npoints, geom) tuple that precedes the geometry bytes. */
export function stageTupleHeader(rec: number, npoints: number, geomBytes: number): Buffer {
  if (geomBytes < 0 || geomBytes > MAX_FIELD_BYTES) throw new Error("La geometría supera el tamaño máximo de un campo de PostgreSQL.");
  const header = Buffer.alloc(FIELD_COUNT_BYTES + 3 * LENGTH_BYTES + 2 * INT4_BYTES);
  let offset = header.writeInt16BE(STAGE_FIELDS, 0);
  offset = header.writeInt32BE(INT4_BYTES, offset);
  offset = header.writeInt32BE(rec, offset);
  offset = header.writeInt32BE(INT4_BYTES, offset);
  offset = header.writeInt32BE(npoints, offset);
  header.writeInt32BE(geomBytes, offset);
  return header;
}

function waitForDrain(stream: Writable, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
      stream.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("El flujo COPY se cerró antes de terminar."));
    };
    const onAbort = (): void => {
      cleanup();
      reject(new Error("Operación cancelada."));
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
    stream.once("close", onClose);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Writes one chunk and, when the stream's buffer is full, waits for it to drain (backpressure). */
export async function writeChunk(stream: Writable, chunk: Uint8Array, signal?: AbortSignal): Promise<void> {
  if (stream.destroyed) throw new Error("El flujo COPY ya está cerrado.");
  if (stream.write(chunk)) return;
  await waitForDrain(stream, signal);
}
