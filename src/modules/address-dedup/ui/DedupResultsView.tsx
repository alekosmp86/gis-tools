"use client";

import React, { useState } from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { DedupTab } from "../constants";
import type { AnalyzeResponsePayload, DedupRequestPayload, GroupFilterCriteria } from "../types";
import { DedupGroupsTab } from "./DedupGroupsTab";
import { DedupSummaryTab } from "./DedupSummaryTab";
import { DedupTabs } from "./DedupTabs";
import { useDedupGroupFilters } from "./useDedupGroupFilters";

interface DedupResultsViewProps {
  result: AnalyzeResponsePayload;
  payload: DedupRequestPayload;
  onRemovalComplete: () => void;
}

/**
 * Owns the Grupos filter state so it survives tab switches. Mount it with a key per result: a new
 * result then starts again on Resumen with every filter cleared.
 */
export const DedupResultsView: React.FC<DedupResultsViewProps> = ({ result, payload, onRemovalComplete }) => {
  const [activeTab, setActiveTab] = useState<DedupTab>(DedupTab.SUMMARY);
  const groupFilters = useDedupGroupFilters(result.groups);

  const handleKpiSelect = (criteria: GroupFilterCriteria) => {
    groupFilters.applyPreset(criteria);
    setActiveTab(DedupTab.GROUPS);
  };

  return (
    <DedupTabs
      activeTab={activeTab}
      groupCount={formatNumber(result.summary.groupCount)}
      onChange={setActiveTab}
    >
      {activeTab === DedupTab.SUMMARY ? (
        <DedupSummaryTab
          summary={result.summary}
          payload={payload}
          onKpiSelect={handleKpiSelect}
          onRemovalComplete={onRemovalComplete}
        />
      ) : (
        <DedupGroupsTab
          groups={result.groups}
          view={groupFilters}
          skippedWithoutCoordinates={result.skippedWithoutCoordinates}
        />
      )}
    </DedupTabs>
  );
};
