"use client";

import { useState } from "react";
import { GroupSort } from "../constants";
import { DEFAULT_GROUP_PAGE_SIZE } from "../data/dedupLabels";
import {
  EMPTY_CRITERIA,
  filterGroups,
  hasActiveFilters,
  listFuentes,
  sortGroups,
} from "../domain/groupFilters";
import type { AnalysisGroup, GroupFilterCriteria } from "../types";

/**
 * Filter, sort, pagination and collapse state of the groups table. Any change of filter, sort,
 * page or page size returns to a fully expanded view, which keeps the collapse state
 * deterministic.
 */
export function useDedupGroupFilters(groups: ReadonlyArray<AnalysisGroup>) {
  const [criteria, setCriteria] = useState<GroupFilterCriteria>(EMPTY_CRITERIA);
  const [sort, setSort] = useState<GroupSort>(GroupSort.GROUP_ASC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_GROUP_PAGE_SIZE);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<number>>(new Set());

  const matchingGroups = sortGroups(filterGroups(groups, criteria), sort);
  const totalPages = Math.max(1, Math.ceil(matchingGroups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(matchingGroups.length, startIndex + pageSize);

  const resetView = (nextPage: number) => {
    setPage(nextPage);
    setCollapsedGroupIds(new Set());
  };

  return {
    criteria,
    sort,
    pageSize,
    currentPage,
    totalPages,
    startIndex,
    endIndex,
    matchingGroups,
    pageGroups: matchingGroups.slice(startIndex, endIndex),
    fuentes: listFuentes(groups),
    collapsedGroupIds,
    isFiltered: hasActiveFilters(criteria),
    updateCriteria: (patch: Partial<GroupFilterCriteria>) => {
      setCriteria((previous) => ({ ...previous, ...patch }));
      resetView(1);
    },
    applyPreset: (preset: GroupFilterCriteria) => {
      setCriteria(preset);
      resetView(1);
    },
    clearFilters: () => {
      setCriteria(EMPTY_CRITERIA);
      resetView(1);
    },
    changeSort: (nextSort: GroupSort) => {
      setSort(nextSort);
      resetView(1);
    },
    changePage: (nextPage: number) => resetView(nextPage),
    changePageSize: (nextPageSize: number) => {
      setPageSize(nextPageSize);
      resetView(1);
    },
    toggleGroup: (groupId: number) =>
      setCollapsedGroupIds((previous) => {
        const next = new Set(previous);
        if (!next.delete(groupId)) next.add(groupId);
        return next;
      }),
    expandAll: () => setCollapsedGroupIds(new Set()),
    collapseAll: () =>
      setCollapsedGroupIds(new Set(matchingGroups.map((group) => group.groupId))),
  };
}

export type DedupGroupFiltersView = ReturnType<typeof useDedupGroupFilters>;
