import { downloadBlob } from "./downloadBlob";
import { createRoutineJobsClient } from "./routineJobsClient";

const client = createRoutineJobsClient();

export async function downloadPadronBackup(token: string, fileName: string): Promise<void> {
  downloadBlob(await client.fetchActualizarBackup(token), fileName);
}
