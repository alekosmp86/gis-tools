import type { FileHandle } from "node:fs/promises";
import { CorruptShapefileError } from "./errors.ts";
import { MIB } from "./types.ts";

export async function readExact(
  fh: FileHandle,
  dst: Uint8Array,
  dstPos: number,
  length: number,
  filePos: number,
): Promise<void> {
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(dst, dstPos + done, length - done, filePos + done);
    if (bytesRead === 0) {
      throw new CorruptShapefileError(`fin de archivo inesperado en el byte ${filePos + done}.`);
    }
    done += bytesRead;
  }
}

/** One reusable 1 MiB buffer plus a Float64 view over it (x, y pairs). */
export interface SliceBuffer {
  bytes: Uint8Array;
  f64: Float64Array;
  pointCapacity: number;
}

export function createSliceBuffer(): SliceBuffer {
  const buffer = new ArrayBuffer(MIB);
  return { bytes: new Uint8Array(buffer), f64: new Float64Array(buffer), pointCapacity: MIB / 16 };
}

/** Read-through 1 MiB window so ring-sized copies stay sequential on disk. */
export class FileWindow {
  private readonly fh: FileHandle;
  private readonly size: number;
  private readonly buf = new Uint8Array(MIB);
  private off = -1;
  private len = 0;

  constructor(fh: FileHandle, size: number) {
    this.fh = fh;
    this.size = size;
  }

  async copy(dst: Uint8Array, dstPos: number, fileOffset: number, length: number): Promise<void> {
    let dpos = dstPos;
    let foff = fileOffset;
    let n = length;
    while (n > 0) {
      if (foff >= this.off && foff < this.off + this.len) {
        const k = Math.min(n, this.off + this.len - foff);
        dst.set(this.buf.subarray(foff - this.off, foff - this.off + k), dpos);
        dpos += k;
        foff += k;
        n -= k;
      } else if (n >= this.buf.length) {
        await readExact(this.fh, dst, dpos, n, foff);
        return;
      } else {
        const sequential = foff === this.off + this.len;
        const want = sequential ? this.buf.length : Math.max(n, 64 * 1024);
        this.off = foff;
        this.len = Math.min(want, this.size - foff);
        if (this.len <= 0) {
          throw new CorruptShapefileError(`lectura fuera del archivo en el byte ${foff}.`);
        }
        await readExact(this.fh, this.buf, 0, this.len, foff);
      }
    }
  }
}
