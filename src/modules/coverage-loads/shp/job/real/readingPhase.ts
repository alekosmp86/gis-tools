import { scanShapefile } from "../reader/shpEwkbReader.ts";
import type { ShapefileScan } from "../reader/types.ts";
import { JOB_STAGE, LOG_LEVEL } from "../types.ts";
import type { JobContext } from "../pipeline.ts";
import { FAILURE_CODE, JobStepError } from "./stepErrors.ts";

function fraction(done: number, total: number): number {
  return total > 0 ? Math.min(1, done / total) : 0;
}

/** Pass 1: counts and net area of the file, bounded memory. Nothing touches the database. */
export async function readingPhase(job: JobContext): Promise<ShapefileScan> {
  job.setStage(JOB_STAGE.READING);
  const scan = await scanShapefile(job.sourcePath, {
    signal: job.signal,
    onProgress: (bytesRead, bytesTotal) =>
      job.updateProgress({ bytesRead, bytesTotal, stageFraction: fraction(bytesRead, bytesTotal) }),
  });
  const geometries = scan.recordCount - scan.nullRecordCount;
  job.log(
    LOG_LEVEL.INFO,
    `Archivo leído: ${scan.recordCount} registros (${scan.nullRecordCount} nulos), ${scan.ringCount} anillos, ${scan.pointCount} vértices.`
  );
  if (geometries <= 0) throw new JobStepError(FAILURE_CODE.SHP_EMPTY, "El shapefile no contiene geometrías.");
  return scan;
}
