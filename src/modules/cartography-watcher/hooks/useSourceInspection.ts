"use client";

/**
 * useSourceInspection.ts
 * Manages active CKAN catalog probing, inspection deltas,
 * resource binary downloading to the local vault, and flash notifications.
 */

import { useState } from "react";
import {
  type WatchedSourceConfig,
  type WatcherSourceCheckResult,
  type WatchResourceDelta,
} from "../types/watcher";
import { fetchSourceCheckApi, downloadResourceApi } from "../services/watcherApi";
import { applyDownloadedResourceDelta } from "../utils/watcherCalculations";

interface SourceInspectionOptions {
  readonly onInspectionSuccess?: (result: WatcherSourceCheckResult) => void;
  readonly onDownloadSuccess?: (downloadedDelta: WatchResourceDelta) => void;
}

export function useSourceInspection(
  initialSource: WatchedSourceConfig,
  options?: SourceInspectionOptions
) {
  const [sourceUrl, setSourceUrl] = useState<string>(initialSource.url);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [downloadingResourceId, setDownloadingResourceId] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<WatcherSourceCheckResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const executeCheck = (targetUrl?: string) => {
    const urlToProbe = targetUrl || sourceUrl;
    setIsChecking(true);
    setErrorMessage(null);

    fetchSourceCheckApi(urlToProbe).then((result) => {
      setIsChecking(false);
      if (result.ok) {
        setCheckResult(result.data);
        options?.onInspectionSuccess?.(result.data);
      } else {
        setErrorMessage(result.error);
      }
    });
  };

  const downloadResource = (resourceId: string) => {
    setDownloadingResourceId(resourceId);
    setErrorMessage(null);
    setSuccessMessage(null);

    downloadResourceApi(sourceUrl, resourceId).then((result) => {
      setDownloadingResourceId(null);
      if (result.ok) {
        const updatedDelta = result.data.delta;

        // Reactively update checkResult using pure transformation
        setCheckResult((previous) => {
          if (!previous) return previous;
          return applyDownloadedResourceDelta(previous, updatedDelta);
        });

        options?.onDownloadSuccess?.(updatedDelta);

        setSuccessMessage(
          `Recurso "${updatedDelta.resource.name}" descargado y almacenado exitosamente en el vault.`
        );
      } else {
        setErrorMessage(result.error);
      }
    });
  };

  return {
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
  };
}
