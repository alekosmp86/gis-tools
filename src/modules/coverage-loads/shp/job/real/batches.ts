export interface StageRecord {
  readonly rec: number;
  readonly npoints: number;
}

export interface RecordBatch {
  readonly firstRecord: number;
  readonly lastRecord: number;
  readonly points: number;
}

/**
 * Groups consecutive records (already ordered by `rec`) so a batch holds at most `maxPoints` raw
 * vertices. A record larger than that travels alone: it cannot be split further.
 */
export function planRecordBatches(records: readonly StageRecord[], maxPoints: number): RecordBatch[] {
  const batches: RecordBatch[] = [];
  let current: { firstRecord: number; lastRecord: number; points: number } | null = null;
  for (const record of records) {
    if (current !== null && current.points + record.npoints <= maxPoints) {
      current.lastRecord = record.rec;
      current.points += record.npoints;
      continue;
    }
    if (current !== null) batches.push(current);
    current = { firstRecord: record.rec, lastRecord: record.rec, points: record.npoints };
  }
  if (current !== null) batches.push(current);
  return batches;
}

export interface PieceRange {
  readonly firstId: number;
  readonly lastId: number;
}

/** Contiguous id windows of at most `size` ids covering `[firstId, lastId]`. */
export function planPieceRanges(firstId: number, lastId: number, size: number): PieceRange[] {
  const ranges: PieceRange[] = [];
  for (let start = firstId; start <= lastId; start += size) {
    ranges.push({ firstId: start, lastId: Math.min(start + size - 1, lastId) });
  }
  return ranges;
}
