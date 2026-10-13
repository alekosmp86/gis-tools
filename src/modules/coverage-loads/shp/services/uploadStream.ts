import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { UPLOAD_STATUS_THROTTLE_MS } from "../constants";

export class UploadSizeMismatchError extends Error {
  constructor(readonly received: number, readonly declared: number) {
    super("El tamaño recibido no coincide con el tamaño declarado.");
    this.name = "UploadSizeMismatchError";
  }
}

export interface StreamToFileOptions {
  readonly declaredBytes: number;
  readonly signal: AbortSignal;
  /** Called at most about once per throttle window with the bytes received so far. */
  readonly onProgress: (receivedBytes: number) => void;
  readonly now?: () => number;
}

/** Counts bytes, never holds more than a chunk, and fails the moment the declared size is exceeded. */
function createCounter(options: StreamToFileOptions, state: { received: number }): Transform {
  const now = options.now ?? Date.now;
  let lastReport = now();
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      state.received += chunk.length;
      if (state.received > options.declaredBytes) return callback(new UploadSizeMismatchError(state.received, options.declaredBytes));
      if (now() - lastReport >= UPLOAD_STATUS_THROTTLE_MS) {
        lastReport = now();
        options.onProgress(state.received);
      }
      return callback(null, chunk);
    },
  });
}

/**
 * Streams the request body to `target` with backpressure (`pipeline`), so memory stays bounded by
 * the stream buffers whatever the file size. Resolves with the received byte count when it equals
 * the declared size; rejects on abort, I/O error or size mismatch (the caller removes the folder).
 */
export async function streamBodyToFile(body: ReadableStream<Uint8Array>, target: string, options: StreamToFileOptions): Promise<number> {
  const state = { received: 0 };
  await pipeline(
    Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>),
    createCounter(options, state),
    createWriteStream(target, { flags: "wx" }),
    { signal: options.signal }
  );
  if (state.received !== options.declaredBytes) throw new UploadSizeMismatchError(state.received, options.declaredBytes);
  return state.received;
}
