import { closeSync, openSync, readSync } from "node:fs";
import type { CsvTextEncoding } from "@/core/common/csvTextDecoding";

const CHUNK_BYTES = 64 * 1024;
const NO_BYTES = new Uint8Array(0);

function* readByteChunks(filePath: string): Generator<Uint8Array, void, undefined> {
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  const descriptor = openSync(filePath, "r");
  try {
    for (
      let bytesRead = readSync(descriptor, buffer, 0, CHUNK_BYTES, null);
      bytesRead > 0;
      bytesRead = readSync(descriptor, buffer, 0, CHUNK_BYTES, null)
    ) {
      yield buffer.subarray(0, bytesRead);
    }
  } finally {
    closeSync(descriptor);
  }
}

function detectFileEncoding(filePath: string): CsvTextEncoding {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (const bytes of readByteChunks(filePath)) {
      decoder.decode(bytes, { stream: true });
    }
    decoder.decode(NO_BYTES, { stream: false });
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

export function* readTextChunks(filePath: string): Generator<string, void, undefined> {
  const decoder = new TextDecoder(detectFileEncoding(filePath));
  for (const bytes of readByteChunks(filePath)) {
    yield decoder.decode(bytes, { stream: true });
  }
  yield decoder.decode(NO_BYTES, { stream: false });
}

export function readFirstLine(filePath: string): string {
  for (const chunk of readTextChunks(filePath)) {
    const lineEnd = chunk.search(/[\r\n]/);
    return lineEnd >= 0 ? chunk.slice(0, lineEnd) : chunk;
  }
  return "";
}
