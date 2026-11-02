import { MonthlyStage } from "./monthlyCartoStages";
import { downloadBlob } from "./downloadBlob";
import { REPORT_CSV_KIND, reportCsvFilename } from "./reportCsv/filename";
import { createRoutineJobsClient } from "./routineJobsClient";

const client = createRoutineJobsClient();

export async function downloadPendingGeometryCsv(planId: string): Promise<void> {
  const fileName = reportCsvFilename(MonthlyStage.ACTUALIZAR_PADRON, true, new Date(), REPORT_CSV_KIND.PENDING_GEOMETRIES);
  downloadBlob(await client.fetchPendingGeometryCsv(planId), fileName);
}
