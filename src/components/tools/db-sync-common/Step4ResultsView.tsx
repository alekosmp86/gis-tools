import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { DiscrepanciesSummaryBar } from "./DiscrepanciesSummaryBar";
import { DiscrepanciesTable } from "./DiscrepanciesTable";
import { SqlPatchDrawer } from "./SqlPatchDrawer";
import { ResultsControlsBar } from "./ResultsControlsBar";
import { useDiscrepancyGeojson } from "@/hooks/useDiscrepancyGeojson";
import { useDatasetComparison } from "@/hooks/useDatasetComparison";
import { DiscrepancyFilter, ResultsViewTab } from "@/types/comparison";
import type { ParsedFileDataset } from "@/types/parsers";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/comparison";
import { ResyncBanner } from "./ResyncBanner";
import styles from "./Step4ResultsView.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((m) => m.SpatialMapPreview),
  { ssr: false }
);

interface Step4ResultsViewProps {
  dbConfig: DbConfig;
  fileDataset: ParsedShapefileData | ParsedFileDataset;
  mappingConfig: ColumnMappingConfig;
  onBackToMapping?: () => void;
  sourceDbConfig?: DbConfig;
}

export const Step4ResultsView: React.FC<Step4ResultsViewProps> = ({
  dbConfig,
  fileDataset,
  mappingConfig,
  sourceDbConfig,
}) => {
  const { summary, loading, isBusy, customNotice, error, progress } = useDatasetComparison({
    dbConfig,
    fileDataset,
    mappingConfig,
    sourceDbConfig,
  });

  const [activeFilter, setActiveFilter] = useState<DiscrepancyFilter>(DiscrepancyFilter.ALL);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeViewTab, setActiveViewTab] = useState<ResultsViewTab>(ResultsViewTab.TABLE);

  const errorMessage = error ? error.message : null;

  const showProgress = loading && progress.phase !== "";
  const hasGeojson = Boolean(fileDataset.geojson && fileDataset.geojson.features && fileDataset.geojson.features.length > 0);

  // Hook encapsulating discrepancy GeoJSON feature collection creation
  const discrepancyGeojson = useDiscrepancyGeojson(summary, fileDataset, activeFilter);

  return (
    <div className={styles.container}>
      {/* Loading State */}
      {loading && (
        <div className={styles.loadingArea}>
          {showProgress ? (
            <div className={styles.progressArea}>
              <ProgressBar
                phase={progress.phase}
                current={progress.current}
                total={progress.total}
                pct={progress.pct}
              />
            </div>
          ) : (
            <>
              <Loader2 size={36} className={styles.spin} />
              <span>Consultando registros PostGIS...</span>
            </>
          )}
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && <AlertMessage type="error" text={errorMessage} />}

      {/* Results View */}
      {summary && !loading && (
        <div className={styles.resultsContent}>
          {/* Background Re-sync Banner */}
          <ResyncBanner isReanalyzing={isBusy} progress={progress} customMessage={customNotice} />

          {/* KPI Summary Cards */}
          <DiscrepanciesSummaryBar
            summary={summary}
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
            isReanalyzing={isBusy}
          />

          {/* Controls Bar & View Mode Tabs */}
          <ResultsControlsBar
            activeViewTab={activeViewTab}
            onSelectTab={setActiveViewTab}
            itemsCount={summary.items.length}
            hasGeojson={hasGeojson}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          {/* Table View */}
          {activeViewTab === ResultsViewTab.TABLE && (
            <DiscrepanciesTable
              items={summary.items}
              activeFilter={activeFilter}
              searchQuery={searchQuery}
            />
          )}

          {/* Map View with Color-Coded Discrepancies */}
          {activeViewTab === ResultsViewTab.MAP && hasGeojson && discrepancyGeojson && (
            <SpatialMapPreview
              geojson={discrepancyGeojson}
              title="MAPA DE DISCREPANCIAS ESPACIALES"
            />
          )}

          {/* SQL Patch Script Drawer */}
          {activeViewTab === ResultsViewTab.SQL && (
            <SqlPatchDrawer
              sqlUpdateScript={summary.sqlUpdateScript}
              sqlInsertScript={summary.sqlInsertScript}
              tableName={dbConfig.table_name}
              dbConfig={dbConfig}
            />
          )}
        </div>
      )}
    </div>
  );
};

