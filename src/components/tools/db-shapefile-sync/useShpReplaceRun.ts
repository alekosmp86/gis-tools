import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "@/core/services/shpReplaceRunStore";

export function useShpReplaceRun() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
