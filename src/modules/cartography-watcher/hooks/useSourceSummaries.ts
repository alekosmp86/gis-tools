"use client";

/**
 * useSourceSummaries.ts
 * Manages batch polling and status telemetry across all watched catalog sources.
 */

import { useState } from "react";
import {
  type WatchedSourceConfig,
  type SourceCheckSummary,
} from "../types/watcher";
import { fetchSourcesSummariesApi } from "../services/watcherApi";

export function useSourceSummaries(initialSources: readonly WatchedSourceConfig[]) {
  const [sourceSummaries, setSourceSummaries] = useState<Record<string, SourceCheckSummary>>({});
  const [isCheckingSummaries, setIsCheckingSummaries] = useState<boolean>(false);

  const refreshSummaries = (sourcesToScan?: readonly WatchedSourceConfig[]) => {
    const targetList = sourcesToScan || initialSources;
    setIsCheckingSummaries(true);

    fetchSourcesSummariesApi(targetList).then((result) => {
      setIsCheckingSummaries(false);
      if (result.ok) {
        const summariesMap: Record<string, SourceCheckSummary> = {};
        result.data.forEach((summary) => {
          summariesMap[summary.sourceId] = summary;
        });
        setSourceSummaries(summariesMap);
      }
    });
  };

  const patchSourceSummary = (
    sourceId: string,
    updater: (previousSummary?: SourceCheckSummary) => SourceCheckSummary | undefined
  ) => {
    setSourceSummaries((previousMap) => {
      const currentSummary = previousMap[sourceId];
      const updatedSummary = updater(currentSummary);
      if (!updatedSummary) return previousMap;
      return {
        ...previousMap,
        [sourceId]: updatedSummary,
      };
    });
  };

  return {
    sourceSummaries,
    isCheckingSummaries,
    refreshSummaries,
    patchSourceSummary,
    setSourceSummaries,
  };
}
