import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "@/core/services/fullReplaceRunStore";

export function useFullReplaceRun() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
