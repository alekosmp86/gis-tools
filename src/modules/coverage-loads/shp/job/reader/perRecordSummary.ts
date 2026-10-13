import type { RecordScanSummary } from "./types.ts";

/** Growable struct-of-arrays accumulator: 28 bytes per record. */
export class PerRecordSummaryBuilder {
  private length = 0;
  private capacity = 1024;
  private recordNumbers = new Int32Array(this.capacity);
  private ringCounts = new Int32Array(this.capacity);
  private pointCounts = new Int32Array(this.capacity);
  private shellCounts = new Int32Array(this.capacity);
  private holeCounts = new Int32Array(this.capacity);
  private netAreas = new Float64Array(this.capacity);

  add(recordNumber: number, rings: number, points: number, shells: number, holes: number, netArea: number): void {
    if (this.length === this.capacity) this.grow();
    const i = this.length++;
    this.recordNumbers[i] = recordNumber;
    this.ringCounts[i] = rings;
    this.pointCounts[i] = points;
    this.shellCounts[i] = shells;
    this.holeCounts[i] = holes;
    this.netAreas[i] = netArea;
  }

  build(): RecordScanSummary {
    const n = this.length;
    return {
      length: n,
      recordNumbers: this.recordNumbers.slice(0, n),
      ringCounts: this.ringCounts.slice(0, n),
      pointCounts: this.pointCounts.slice(0, n),
      shellCounts: this.shellCounts.slice(0, n),
      holeCounts: this.holeCounts.slice(0, n),
      netAreas: this.netAreas.slice(0, n),
    };
  }

  private grow(): void {
    this.capacity *= 2;
    this.recordNumbers = grownInt(this.recordNumbers, this.capacity);
    this.ringCounts = grownInt(this.ringCounts, this.capacity);
    this.pointCounts = grownInt(this.pointCounts, this.capacity);
    this.shellCounts = grownInt(this.shellCounts, this.capacity);
    this.holeCounts = grownInt(this.holeCounts, this.capacity);
    const areas = new Float64Array(this.capacity);
    areas.set(this.netAreas);
    this.netAreas = areas;
  }
}

function grownInt(source: Int32Array<ArrayBuffer>, capacity: number): Int32Array<ArrayBuffer> {
  const next = new Int32Array(capacity);
  next.set(source);
  return next;
}
