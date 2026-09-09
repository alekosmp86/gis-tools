"use client";

import React from "react";
import { useCartographyWatcher } from "../hooks/useCartographyWatcher";
import { SourceSelector } from "./SourceSelector";
import { WatcherHeroCard } from "./WatcherHeroCard";
import { WatcherFilterBar } from "./WatcherFilterBar";
import { WatcherResourceGrid } from "./WatcherResourceGrid";
import styles from "./WatcherDashboard.module.css";

export const WatcherDashboard: React.FC = () => {
  const {
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
    handleDownloadResource,
  } = useCartographyWatcher();

  const handleSubmitUrl = (event: React.FormEvent) => {
    event.preventDefault();
    executeCheck(sourceUrl);
  };

  return (
    <div className={styles.container}>
      {/* Watched Sources Grid with Status Badges */}
      <SourceSelector
        sources={watchedSources}
        selectedSourceId={selectedSourceId}
        summaries={sourceSummaries}
        isCheckingSummaries={isCheckingSummaries}
        onSelectSource={selectSource}
        onAddSource={addCustomSource}
        onRefreshAll={() => refreshSummaries()}
      />

      {/* Hero Control Card with Real-time Metrics & Actions */}
      <WatcherHeroCard
        title={checkResult?.datasetTitle || selectedSource.title}
        description={selectedSource.description}
        checkResult={checkResult}
        sourceUrl={sourceUrl}
        onChangeSourceUrl={setSourceUrl}
        onSubmitUrl={handleSubmitUrl}
        isChecking={isChecking}
        successMessage={successMessage}
        errorMessage={errorMessage}
      />

      {/* Filter and Search Controls */}
      {checkResult && (
        <WatcherFilterBar
          filterQuery={filterQuery}
          onFilterQueryChange={setFilterQuery}
          availableFormats={availableFormats}
          selectedFormat={selectedFormat}
          onSelectFormat={setSelectedFormat}
        />
      )}

      {/* Resource Grid with Empty State */}
      <WatcherResourceGrid
        resources={filteredResources}
        sourceSlug={checkResult?.datasetSlug || selectedSource.datasetSlug}
        downloadingResourceId={downloadingResourceId}
        isChecking={isChecking}
        onDownload={handleDownloadResource}
      />
    </div>
  );
};

WatcherDashboard.displayName = "WatcherDashboard";
