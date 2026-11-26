// Same run-store API names as csvReplaceRunStore; the GeoPackage replace keeps its own run state.
// fallow-ignore-file duplicate-export
import { GPKG_START_ROUTE, GPKG_STATUS_ROUTE, GPKG_UPLOAD_TARGET } from "@/core/services/gpkgReplaceClient";
import { ReplaceRunStore } from "@/core/services/replaceRunStoreFactory";
import {
  fetchReplaceJobStatus,
  startReplaceJob,
  uploadReplaceFile,
} from "@/core/services/shpReplaceClient";

const store = new ReplaceRunStore({
  upload: (file, onProgress) => uploadReplaceFile(GPKG_UPLOAD_TARGET, file, onProgress),
  start: (body) => startReplaceJob(GPKG_START_ROUTE, body),
  status: (jobId) => fetchReplaceJobStatus(GPKG_STATUS_ROUTE, jobId),
});

export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;
export const getServerSnapshot = store.getServerSnapshot;
export const start = store.start;
export const reset = store.reset;
