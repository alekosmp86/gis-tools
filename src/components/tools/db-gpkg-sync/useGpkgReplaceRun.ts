import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "@/core/services/gpkgReplaceRunStore";

export function useGpkgReplaceRun() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
