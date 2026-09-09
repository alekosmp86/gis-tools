"use client";

/**
 * useResourceFilter.ts
 * Manages search query, format filter state, available format extraction,
 * and resource list filtering.
 */

import { useState } from "react";
import {
  type WatchResourceDelta,
  CATALOG_FILTER_ALL,
} from "../types/watcher";

export function useResourceFilter(resources: readonly WatchResourceDelta[] = []) {
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [selectedFormat, setSelectedFormat] = useState<string>(CATALOG_FILTER_ALL);

  const formatSet = new Set<string>();
  resources.forEach((item) => {
    if (item.resource.format) {
      formatSet.add(item.resource.format.toUpperCase());
    }
  });
  const availableFormats = [CATALOG_FILTER_ALL, ...Array.from(formatSet)];

  const normalizedQuery = filterQuery.trim().toLowerCase();
  const filteredResources = resources.filter((item) => {
    const matchesSearch =
      !normalizedQuery ||
      item.resource.name.toLowerCase().includes(normalizedQuery);

    const itemFormat = (item.resource.format || "").toUpperCase();
    const matchesFormat =
      selectedFormat === CATALOG_FILTER_ALL || itemFormat === selectedFormat;

    return matchesSearch && matchesFormat;
  });

  return {
    filterQuery,
    setFilterQuery,
    selectedFormat,
    setSelectedFormat,
    availableFormats,
    filteredResources,
  };
}
