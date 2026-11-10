import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "@/core/services/csvReplaceRunStore";

export function useCsvReplaceRun() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
