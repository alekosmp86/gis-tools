import { CorruptShapefileError, HoleAssignmentError } from "./errors.ts";
import { buildLayout, computeEwkbSize, streamEwkb } from "./ewkb.ts";
import { FileWindow, createSliceBuffer } from "./fileIo.ts";
import { assignHoles } from "./holeAssignment.ts";
import { PerRecordSummaryBuilder } from "./perRecordSummary.ts";
import { RingMetadata, computeRingMetadata, summarizeRings } from "./ringMetadata.ts";
import { openShapefile, walkRecords } from "./shpHeader.ts";
import { SHAPE_TYPE } from "./types.ts";
import type { EwkbIterationSummary, EwkbRecord, ReaderOptions, ScanOptions, ShapefileScan } from "./types.ts";

class KahanSum {
  value = 0;
  private comp = 0;

  add(v: number): void {
    const y = v - this.comp;
    const t = this.value + y;
    this.comp = t - this.value - y;
    this.value = t;
  }
}

/** Pass-1 only scan of a polygon shapefile: counts and net area, bounded memory. */
export async function scanShapefile(path: string, options: ScanOptions = {}): Promise<ShapefileScan> {
  const { signal, onProgress, perRecord } = options;
  const file = await openShapefile(path);
  try {
    const slice = createSliceBuffer();
    const meta = new RingMetadata();
    const net = new KahanSum();
    const builder = perRecord ? new PerRecordSummaryBuilder() : undefined;
    const scan: ShapefileScan = {
      fileSize: file.size,
      recordCount: 0,
      nullRecordCount: 0,
      pointCount: 0,
      ringCount: 0,
      shellCount: 0,
      holeCount: 0,
      degenerateRingCount: 0,
      unclosedRingCount: 0,
      netArea: 0,
    };
    onProgress?.(0, file.size);
    for await (const rec of walkRecords(file, signal)) {
      scan.recordCount++;
      if (rec.shapeType === SHAPE_TYPE.Null) {
        scan.nullRecordCount++;
        builder?.add(rec.recordNumber, 0, 0, 0, 0, 0);
        continue;
      }
      const unclosed = await computeRingMetadata(file, rec, meta, slice, signal, onProgress);
      const summary = summarizeRings(meta, rec.parts, unclosed);
      scan.pointCount += rec.numPoints;
      scan.ringCount += rec.numParts;
      scan.shellCount += summary.shellCount;
      scan.holeCount += summary.holeCount;
      scan.degenerateRingCount += summary.degenerateCount;
      scan.unclosedRingCount += unclosed;
      net.add(summary.netArea);
      builder?.add(rec.recordNumber, rec.numParts, rec.numPoints, summary.shellCount, summary.holeCount, summary.netArea);
      onProgress?.(rec.contentOffset + rec.contentLength, file.size);
    }
    scan.netArea = net.value;
    if (builder) scan.perRecord = builder.build();
    onProgress?.(file.size, file.size);
    return scan;
  } finally {
    await file.close();
  }
}

/**
 * Yields one MultiPolygon EWKB (SRID 32721) per non-null record, shells with their holes assigned
 * in Node. Records must be consumed in order: read `chunks()` of a record (once) before asking the
 * generator for the next one, which reuses the shared ring metadata and invalidates the previous
 * record. Null and shell-less records are skipped and counted in the returned summary.
 * Throws HoleAssignmentError, before yielding the offending record, if a hole cannot be placed.
 */
export async function* iterateRecordEwkb(
  path: string,
  options: ReaderOptions = {},
): AsyncGenerator<EwkbRecord, EwkbIterationSummary, undefined> {
  const { signal, onProgress } = options;
  const file = await openShapefile(path);
  try {
    const slice = createSliceBuffer();
    const fileWindow = new FileWindow(file.fh, file.size);
    const meta = new RingMetadata();
    const totals: EwkbIterationSummary = {
      recordCount: 0,
      nullRecordCount: 0,
      emptyRecordCount: 0,
      yieldedRecordCount: 0,
      degenerateRingCount: 0,
    };
    let generation = 0;
    onProgress?.(0, file.size);
    for await (const rec of walkRecords(file, signal)) {
      totals.recordCount++;
      if (rec.shapeType === SHAPE_TYPE.Null) {
        totals.nullRecordCount++;
        continue;
      }
      const mine = ++generation;
      const unclosed = await computeRingMetadata(file, rec, meta, slice, signal);
      const summary = summarizeRings(meta, rec.parts, unclosed);
      totals.degenerateRingCount += summary.degenerateCount;
      if (summary.shellCount === 0 && summary.holeCount === 0) {
        totals.emptyRecordCount++;
        continue;
      }
      if (unclosed > 0) {
        throw new CorruptShapefileError(
          `${unclosed} anillo(s) sin cerrar (el primer y el último vértice difieren).`,
          rec.recordNumber,
        );
      }
      const assignment = await assignHoles({ fileWindow, slice, signal }, rec, meta);
      if (assignment.ambiguousCount > 0 || assignment.unassignedCount > 0) {
        throw new HoleAssignmentError(
          rec.recordNumber,
          assignment.holeCount,
          assignment.ambiguousCount,
          assignment.unassignedCount,
        );
      }
      const layout = buildLayout(rec, meta);
      const totalBytes = computeEwkbSize(rec, meta, layout);
      let started = false;
      const guard = (): void => {
        if (mine !== generation) {
          throw new Error(
            `El registro ${rec.recordNumber} ya no es el actual: los registros deben consumirse en orden.`,
          );
        }
      };
      totals.yieldedRecordCount++;
      yield {
        recordNumber: rec.recordNumber,
        totalBytes,
        netArea: summary.netArea,
        pointCount: rec.numPoints,
        chunks: () => {
          guard();
          if (started) throw new Error(`Los fragmentos del registro ${rec.recordNumber} ya fueron solicitados.`);
          started = true;
          return streamEwkb(fileWindow, rec, meta, layout, totalBytes, guard, signal);
        },
      };
      onProgress?.(rec.contentOffset + rec.contentLength, file.size);
    }
    onProgress?.(file.size, file.size);
    return totals;
  } finally {
    await file.close();
  }
}
