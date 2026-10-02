"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { PaginationControls } from "@/ui-kit/components/PaginationControls";
import { AlertType } from "@/ui-kit/types/ui";
import { formatNumber } from "@/core/common/ValueFormatter";
import { GROUP_PAGE_SIZE_OPTIONS, NO_COORDINATES_MESSAGES } from "../data/dedupLabels";
import { pluralize } from "../domain/rowFormat";
import type { AnalysisGroup } from "../types";
import { DedupGroupsEmptyState } from "./DedupGroupsEmptyState";
import { DedupGroupTable } from "./DedupGroupTable";
import { DedupGroupToolbar } from "./DedupGroupToolbar";
import type { DedupGroupFiltersView } from "./useDedupGroupFilters";
import styles from "./DedupGroupsTab.module.css";

interface DedupGroupsTabProps {
  groups: ReadonlyArray<AnalysisGroup>;
  view: DedupGroupFiltersView;
  skippedWithoutCoordinates: number;
}

export const DedupGroupsTab: React.FC<DedupGroupsTabProps> = ({
  groups,
  view,
  skippedWithoutCoordinates,
}) => (
  <div className={styles.stack}>
    {skippedWithoutCoordinates > 0 && (
      <AlertMessage
        type={AlertType.WARNING}
        text={`${formatNumber(skippedWithoutCoordinates)} ${pluralize(
          skippedWithoutCoordinates,
          NO_COORDINATES_MESSAGES.singular,
          NO_COORDINATES_MESSAGES.plural
        )}`}
      />
    )}

    <DedupGroupToolbar
      criteria={view.criteria}
      sort={view.sort}
      fuentes={view.fuentes}
      matchingCount={view.matchingGroups.length}
      totalCount={groups.length}
      isFiltered={view.isFiltered}
      onCriteriaChange={view.updateCriteria}
      onSortChange={view.changeSort}
      onClearFilters={view.clearFilters}
      onExpandAll={view.expandAll}
      onCollapseAll={view.collapseAll}
    />

    {view.matchingGroups.length === 0 ? (
      <DedupGroupsEmptyState isFiltered={view.isFiltered} onClearFilters={view.clearFilters} />
    ) : (
      <>
        <DedupGroupTable
          groups={view.pageGroups}
          collapsedGroupIds={view.collapsedGroupIds}
          onToggleGroup={view.toggleGroup}
        />
        <PaginationControls
          currentPage={view.currentPage}
          totalPages={view.totalPages}
          pageSize={view.pageSize}
          totalFilteredCount={view.matchingGroups.length}
          startIndex={view.startIndex}
          endIndex={view.endIndex}
          pageSizeOptions={[...GROUP_PAGE_SIZE_OPTIONS]}
          onPageChange={view.changePage}
          onPageSizeChange={view.changePageSize}
        />
      </>
    )}
  </div>
);
