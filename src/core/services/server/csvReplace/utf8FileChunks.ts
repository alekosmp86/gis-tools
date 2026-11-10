import { closeSync, openSync, readSync } from "node:fs";

const CHUNK_BYTES = 64 * 1024;
const INVALID_UTF8_MESSAGE = "El archivo no está codificado en UTF-8. Guárdelo como CSV UTF-8 e inténtelo de nuevo.";
const NO_BYTES = new Uint8Array(0);

function decodeChunk(decoder: TextDecoder, bytes: Uint8Array, hasMore: boolean): string {
  try {
    return decoder.decode(bytes, { stream: hasMore });
  } catch {
    throw new Error(INVALID_UTF8_MESSAGE);
  }
}

export function* readUtf8Chunks(filePath: string): Generator<string, void, undefined> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  const descriptor = openSync(filePath, "r");
  try {
    for (
      let bytesRead = readSync(descriptor, buffer, 0, CHUNK_BYTES, null);
      bytesRead > 0;
      bytesRead = readSync(descriptor, buffer, 0, CHUNK_BYTES, null)
    ) {
      yield decodeChunk(decoder, buffer.subarray(0, bytesRead), true);
    }
    yield decodeChunk(decoder, NO_BYTES, false);
  } finally {
    closeSync(descriptor);
  }
}

export function readFirstLine(filePath: string): string {
  for (const chunk of readUtf8Chunks(filePath)) {
    const lineEnd = chunk.search(/[\r\n]/);
    return lineEnd >= 0 ? chunk.slice(0, lineEnd) : chunk;
  }
  return "";
}
