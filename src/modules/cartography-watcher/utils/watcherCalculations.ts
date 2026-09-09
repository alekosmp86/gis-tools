/**
 * watcherCalculations.ts
 * Pure deterministic state transformation and business calculation functions
 * for Cartography Watcher deltas, badges, and summaries.
 */

import {
  type WatcherSourceCheckResult,
  type WatchResourceDelta,
  type SourceCheckSummary,
  DeltaStatus,
  SourceBadgeState,
} from "../types/watcher";

/**
 * Derives the appropriate badge status from a source inspection result.
 */
export function deriveBadgeStateFromResult(
  result: WatcherSourceCheckResult
): SourceBadgeState {
  if (result.updatesCount > 0) {
    return SourceBadgeState.UPDATE_AVAILABLE;
  }

  const hasAnyDownloaded = result.resources.some(
    (resource) => resource.status === DeltaStatus.UP_TO_DATE
  );

  if (!hasAnyDownloaded && result.totalResources > 0) {
    return SourceBadgeState.NOT_DOWNLOADED;
  }

  return SourceBadgeState.UP_TO_DATE;
}

/**
 * Purely updates a source check result after a resource is successfully downloaded.
 */
export function applyDownloadedResourceDelta(
  currentResult: WatcherSourceCheckResult,
  downloadedDelta: WatchResourceDelta
): WatcherSourceCheckResult {
  const updatedResources = currentResult.resources.map((item) =>
    item.resource.id === downloadedDelta.resource.id ? downloadedDelta : item
  );

  const newUpdatesCount = updatedResources.filter(
    (item) =>
      item.status === DeltaStatus.UPDATE_AVAILABLE ||
      item.status === DeltaStatus.NOT_DOWNLOADED
  ).length;

  return {
    ...currentResult,
    updatesCount: newUpdatesCount,
    resources: updatedResources,
  };
}

/**
 * Purely updates a source check summary badge after a resource download.
 */
export function recalculateSummaryAfterDownload(
  currentSummary: SourceCheckSummary
): SourceCheckSummary {
  const remainingUpdates = Math.max(0, currentSummary.updatesCount - 1);
  return {
    ...currentSummary,
    updatesCount: remainingUpdates,
    status:
      remainingUpdates === 0
        ? SourceBadgeState.UP_TO_DATE
        : SourceBadgeState.UPDATE_AVAILABLE,
  };
}
