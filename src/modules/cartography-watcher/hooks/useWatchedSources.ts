"use client";

/**
 * useWatchedSources.ts
 * Manages persisted user cartography catalog sources in localStorage and server vault,
 * source selection, and adding custom CKAN catalog sources.
 */

import { useState, useEffect } from "react";
import {
  type WatchedSourceConfig,
  WATCHED_SOURCE_CATEGORY,
} from "../types/watcher";
import { DEFAULT_WATCHED_SOURCES } from "../data/defaultSources";
import { extractSlugFromUrl, formatTitleFromSlug } from "../utils/watcherUrls";
import {
  fetchPersistedSourcesApi,
  addCustomSourceApi,
  removeCustomSourceApi,
} from "../services/watcherApi";

const STORAGE_KEY = "gis_watched_cartography_sources_v1";

function loadStoredSources(): WatchedSourceConfig[] {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WatchedSourceConfig[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback to defaults on corrupt storage
    }
  }
  return [...DEFAULT_WATCHED_SOURCES];
}

function persistSources(sources: readonly WatchedSourceConfig[]): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
    } catch {
      // Ignore storage write errors (e.g., quota exceeded)
    }
  }
}

export function useWatchedSources() {
  const [watchedSources, setWatchedSources] = useState<WatchedSourceConfig[]>(loadStoredSources);

  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => {
    return DEFAULT_WATCHED_SOURCES[0].id;
  });

  // Reconcile client sources with server-persisted vault on mount
  useEffect(() => {
    let isCancelled = false;

    async function syncServerSources(): Promise<void> {
      const result = await fetchPersistedSourcesApi();
      if (!isCancelled && result.ok && result.data && result.data.length > 0) {
        setWatchedSources(result.data);
        persistSources(result.data);
      }
    }

    void syncServerSources();

    return () => {
      isCancelled = true;
    };
  }, []);

  const selectedSource =
    watchedSources.find((sourceItem) => sourceItem.id === selectedSourceId) ||
    watchedSources[0] ||
    DEFAULT_WATCHED_SOURCES[0];

  const selectSource = (sourceId: string): WatchedSourceConfig | null => {
    const targetSource = watchedSources.find((sourceItem) => sourceItem.id === sourceId);
    if (!targetSource) return null;
    setSelectedSourceId(sourceId);
    return targetSource;
  };

  const addCustomSource = (rawUrl: string): WatchedSourceConfig | null => {
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl) return null;

    const slug = extractSlugFromUrl(trimmedUrl);
    const title = formatTitleFromSlug(slug);
    const newConfig: WatchedSourceConfig = {
      id: slug,
      title,
      url: trimmedUrl,
      datasetSlug: slug,
      category: WATCHED_SOURCE_CATEGORY.CUSTOM,
      isDefault: false,
    };

    const updatedSources = [
      ...watchedSources.filter((sourceItem) => sourceItem.id !== slug),
      newConfig,
    ];

    setWatchedSources(updatedSources);
    persistSources(updatedSources);
    setSelectedSourceId(newConfig.id);

    // Persist to server vault
    void addCustomSourceApi(trimmedUrl);

    return newConfig;
  };

  const removeCustomSource = (sourceId: string): void => {
    const updatedSources = watchedSources.filter((sourceItem) => sourceItem.id !== sourceId);
    setWatchedSources(updatedSources);
    persistSources(updatedSources);

    // Remove from server vault
    void removeCustomSourceApi(sourceId);
  };

  return {
    watchedSources,
    selectedSourceId,
    selectedSource,
    selectSource,
    addCustomSource,
    removeCustomSource,
    setWatchedSources,
  };
}
