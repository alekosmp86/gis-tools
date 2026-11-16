import { MonthlyStage } from "../shared/monthlyCartoStages";
import { downloadBlob } from "../shared/downloadBlob";
import { REPORT_CSV_KIND, reportCsvFilename } from "../shared/filename";
import { createRoutineJobsClient } from "../shared/routineJobsClient";

const client = createRoutineJobsClient();

export async function downloadPendingGeometryCsv(planId: string): Promise<void> {
  const fileName = reportCsvFilename(MonthlyStage.ACTUALIZAR_PADRON, true, new Date(), REPORT_CSV_KIND.PENDING_GEOMETRIES);
  downloadBlob(await client.fetchPendingGeometryCsv(planId), fileName);
}
