"use client";

/**
 * useCartographyWatcher.ts
 * High-level orchestrator facade composing atomic watcher hooks:
 * - useWatchedSources (localStorage persistence and source configuration)
 * - useSourceSummaries (multi-source batch telemetry polling and status cache)
 * - useSourceInspection (active catalog delta checking and vault binary downloading)
 * - useResourceFilter (search and format filtering)
 */

import { useEffect } from "react";
import { type WatcherSourceCheckResult } from "../types/watcher";
import {
  deriveBadgeStateFromResult,
  recalculateSummaryAfterDownload,
} from "../utils/watcherCalculations";
import { useWatchedSources } from "./useWatchedSources";
import { useSourceSummaries } from "./useSourceSummaries";
import { useSourceInspection } from "./useSourceInspection";
import { useResourceFilter } from "./useResourceFilter";

export function useCartographyWatcher() {
  const {
    watchedSources,
    selectedSourceId,
    selectedSource,
    selectSource: selectSourceInternal,
    addCustomSource: addCustomSourceInternal,
  } = useWatchedSources();

  const {
    sourceSummaries,
    isCheckingSummaries,
    refreshSummaries,
    patchSourceSummary,
  } = useSourceSummaries(watchedSources);

  const handleInspectionSuccess = (result: WatcherSourceCheckResult) => {
    const status = deriveBadgeStateFromResult(result);
    patchSourceSummary(selectedSourceId, () => ({
      sourceId: selectedSourceId,
      datasetSlug: result.datasetSlug,
      title: result.datasetTitle || selectedSource.title,
      status,
      totalResources: result.totalResources,
      updatesCount: result.updatesCount,
      lastChecked: new Date().toISOString(),
    }));
  };

  const handleDownloadSuccess = () => {
    patchSourceSummary(selectedSourceId, (currentSummary) => {
      if (!currentSummary) return undefined;
      return recalculateSummaryAfterDownload(currentSummary);
    });
  };

  const {
    sourceUrl,
    setSourceUrl,
    isChecking,
    downloadingResourceId,
    checkResult,
    setCheckResult,
    errorMessage,
    setErrorMessage,
    successMessage,
    setSuccessMessage,
    executeCheck,
    downloadResource,
  } = useSourceInspection(selectedSource, {
    onInspectionSuccess: handleInspectionSuccess,
    onDownloadSuccess: handleDownloadSuccess,
  });

  const {
    filterQuery,
    setFilterQuery,
    selectedFormat,
    setSelectedFormat,
    availableFormats,
    filteredResources,
  } = useResourceFilter(checkResult?.resources);

  const selectSource = (sourceId: string) => {
    const targetSource = selectSourceInternal(sourceId);
    if (!targetSource) return;

    setSourceUrl(targetSource.url);
    setCheckResult(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    executeCheck(targetSource.url);
  };

  const addCustomSource = (url: string) => {
    const newSource = addCustomSourceInternal(url);
    if (!newSource) return;

    setSourceUrl(newSource.url);
    setCheckResult(null);

    const updatedSources = [
      ...watchedSources.filter((sourceItem) => sourceItem.id !== newSource.id),
      newSource,
    ];

    refreshSummaries(updatedSources);
    executeCheck(newSource.url);
  };

  // Initial mount telemetry check
  useEffect(() => {
    let isCancelled = false;

    const timerId = setTimeout(() => {
      if (!isCancelled) {
        refreshSummaries(watchedSources);
        executeCheck(selectedSource.url);
      }
    }, 0);

    return () => {
      isCancelled = true;
      clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    watchedSources,
    selectedSourceId,
    selectedSource,
    sourceSummaries,
    isCheckingSummaries,
    sourceUrl,
    setSourceUrl,
    isChecking,
    downloadingResourceId,
    checkResult,
    errorMessage,
    successMessage,
    filterQuery,
    setFilterQuery,
    selectedFormat,
    setSelectedFormat,
    availableFormats,
    filteredResources,
    selectSource,
    addCustomSource,
    refreshSummaries,
    executeCheck,
    handleDownloadResource: downloadResource,
  };
}
