// Same run-store API names as fullReplaceRunStore; fixed by tests/unit/core/services/shpReplaceRunStore.test.ts.
// fallow-ignore-file duplicate-export
import { ReplaceRunStore } from "@/core/services/replaceRunStoreFactory";
import { fetchShpReplaceStatus, startShpReplace, uploadShapefileZip } from "@/core/services/shpReplaceClient";

export { ShpReplaceRunStatus, type ShpReplaceRunClient } from "@/core/services/replaceRunTypes";

const store = new ReplaceRunStore({
  upload: uploadShapefileZip,
  start: startShpReplace,
  status: fetchShpReplaceStatus,
});

export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;
export const getServerSnapshot = store.getServerSnapshot;
export const start = store.start;
export const reset = store.reset;
export const rerun = store.rerun;
