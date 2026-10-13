import { open } from "node:fs/promises";
import { LOG_READ_CAP_BYTES } from "../constants";

const TRUNCATED_NOTICE = "[... registro truncado: solo se muestra el final ...]";

function lastLines(text: string, count: number): string {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-count).join("\n") + (lines.length > 0 ? "\n" : "");
}

/** Reads at most the last `LOG_READ_CAP_BYTES` of the file, then keeps the last `lines` lines. */
export async function readLogTail(file: string, lines: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, LOG_READ_CAP_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const truncated = size > length;
    let text = buffer.toString("utf8");
    // The first line of a truncated read is usually cut in half.
    if (truncated) text = text.slice(text.indexOf("\n") + 1);
    const tail = lastLines(text, lines);
    return truncated ? `${TRUNCATED_NOTICE}\n${tail}` : tail;
  } finally {
    await handle.close();
  }
}
