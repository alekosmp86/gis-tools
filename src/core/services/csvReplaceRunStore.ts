// Same run-store API names as shpReplaceRunStore; the CSV replace keeps its own run state.
// fallow-ignore-file duplicate-export
import { ReplaceRunStore } from "@/core/services/replaceRunStoreFactory";
import {
  fetchReplaceJobStatus,
  startReplaceJob,
  uploadReplaceFile,
  type ReplaceUploadTarget,
} from "@/core/services/shpReplaceClient";

const CSV_UPLOAD_TARGET: ReplaceUploadTarget = { route: "/api/db/csv-replace/upload", fileName: "datos.csv" };
const CSV_START_ROUTE = "/api/db/csv-replace/start";
const CSV_STATUS_ROUTE = "/api/db/csv-replace/status";

const store = new ReplaceRunStore({
  upload: (file, onProgress) => uploadReplaceFile(CSV_UPLOAD_TARGET, file, onProgress),
  start: (body) => startReplaceJob(CSV_START_ROUTE, body),
  status: (jobId) => fetchReplaceJobStatus(CSV_STATUS_ROUTE, jobId),
});

export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;
export const getServerSnapshot = store.getServerSnapshot;
export const start = store.start;
export const reset = store.reset;
