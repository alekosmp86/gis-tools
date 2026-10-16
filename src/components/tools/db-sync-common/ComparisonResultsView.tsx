import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { FeatureCollection } from "geojson";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { DiscrepanciesSummaryBar } from "./DiscrepanciesSummaryBar";
import { DiscrepanciesTable } from "./discrepancies-table/DiscrepanciesTable";
import { SelectionSqlPatchDrawer } from "./sql-patch-drawer/SelectionSqlPatchDrawer";
import { useDiscrepancySelection } from "./discrepancies-table/useDiscrepancySelection";
import { ResultsControlsBar } from "./ResultsControlsBar";
import { useDiscrepancyGeojson } from "@/hooks/useDiscrepancyGeojson";
import { useDatasetComparison } from "@/hooks/useDatasetComparison";
import { DiscrepancyFilter, ResultsViewTab } from "@/core/types/comparison";
import type { ParsedFileDataset } from "@/core/types/parsers";
import type { DbConfig } from "@/core/types/db";
import type { ParsedShapefileData } from "@/core/types/shp";
import type { ColumnMappingConfig, ComparisonSourceDescriptor } from "@/core/types/comparison";
import { resolveComparisonDescriptor } from "@/core/constants/comparisonDescriptors";
import { ResyncBanner } from "./ResyncBanner";
import styles from "./ComparisonResultsView.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/ui-kit/components/SpatialMapPreview").then((m) => m.SpatialMapPreview),
  { ssr: false }
);

export interface ComparisonResultsViewProps {
  dbConfig: DbConfig;
  fileDataset: ParsedShapefileData | ParsedFileDataset;
  mappingConfig: ColumnMappingConfig;
  sourceDbConfig?: DbConfig;
  descriptor?: ComparisonSourceDescriptor;
}

function buildComparisonKey({
  dbConfig,
  fileDataset,
  mappingConfig,
  sourceDbConfig,
}: Pick<ComparisonResultsViewProps, "dbConfig" | "fileDataset" | "mappingConfig" | "sourceDbConfig">): string {
  return JSON.stringify([
    sourceDbConfig?.db_name ?? "",
    sourceDbConfig?.schema_name ?? "",
    sourceDbConfig?.table_name ?? "",
    dbConfig.db_name,
    dbConfig.schema_name,
    dbConfig.table_name,
    fileDataset.fileName,
    mappingConfig.suidColumns,
    mappingConfig.fieldsToCompare,
    mappingConfig.compareGeometry,
    mappingConfig.treatPlaceholdersAsEmpty,
    mappingConfig.ignoreEncodingArtifacts,
  ]);
}

export const ComparisonResultsView: React.FC<ComparisonResultsViewProps> = ({
  dbConfig,
  fileDataset,
  mappingConfig,
  sourceDbConfig,
  descriptor: customDescriptor,
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

  const selection = useDiscrepancySelection({
    items: summary?.items,
    comparisonKey: buildComparisonKey({ dbConfig, fileDataset, mappingConfig, sourceDbConfig }),
    primaryKeyColumn: mappingConfig.primaryKeyColumn,
  });

  const errorMessage = error ? error.message : null;

  const showProgress = loading && progress.phase !== "";
  const hasGeojson = Boolean(fileDataset.geojson && fileDataset.geojson.features && fileDataset.geojson.features.length > 0);

  const [hasActivatedMap, setHasActivatedMap] = useState<boolean>(false);
  if (activeViewTab === ResultsViewTab.MAP && !hasActivatedMap) {
    setHasActivatedMap(true);
  }

  const isMapActive = activeViewTab === ResultsViewTab.MAP;

  // Hook encapsulating discrepancy GeoJSON feature collection creation (Lazy-evaluated only when Map tab is active)
  const rawDiscrepancyGeojson = useDiscrepancyGeojson(summary, fileDataset, activeFilter, isMapActive);

  const [discrepancyGeojsonCache, setDiscrepancyGeojsonCache] = useState<{
    summary: typeof summary;
    fileDataset: typeof fileDataset;
    activeFilter: typeof activeFilter;
    geojson: FeatureCollection;
  } | null>(null);

  if (
    rawDiscrepancyGeojson !== null &&
    (!discrepancyGeojsonCache ||
      discrepancyGeojsonCache.summary !== summary ||
      discrepancyGeojsonCache.fileDataset !== fileDataset ||
      discrepancyGeojsonCache.activeFilter !== activeFilter)
  ) {
    setDiscrepancyGeojsonCache({ summary, fileDataset, activeFilter, geojson: rawDiscrepancyGeojson });
  }

  const discrepancyGeojson = hasActivatedMap ? (discrepancyGeojsonCache?.geojson ?? null) : null;

  const descriptor = resolveComparisonDescriptor({
    descriptor: customDescriptor,
    isDbToDb: Boolean(sourceDbConfig),
    fileSourceKind: fileDataset.kind,
  });

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
            descriptor={descriptor}
            isReanalyzing={isBusy}
          />

          {/* View Mode Navigation Tabs */}
          <ResultsControlsBar
            activeViewTab={activeViewTab}
            onSelectTab={setActiveViewTab}
            itemsCount={summary.items.length}
            hasGeojson={hasGeojson}
          />

          {/* Table View */}
          <div className={activeViewTab === ResultsViewTab.TABLE ? undefined : styles.tabHidden}>
            <DiscrepanciesTable
              items={summary.items}
              activeFilter={activeFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              descriptor={descriptor}
              selection={selection}
              primaryKeyColumn={mappingConfig.primaryKeyColumn}
            />
          </div>

          {/* Map View with Color-Coded Discrepancies (Preserved in DOM to eliminate 500k layer teardown overhead) */}
          {hasGeojson && discrepancyGeojson && (
            <div className={activeViewTab === ResultsViewTab.MAP ? undefined : styles.tabHidden}>
              {discrepancyGeojson.features.length === 0 && (
                <AlertMessage
                  type={AlertType.INFO}
                  text="No se encontraron discrepancias para el filtro seleccionado."
                />
              )}
              <SpatialMapPreview
                geojson={discrepancyGeojson}
                title="MAPA DE DISCREPANCIAS ESPACIALES"
                isVisible={activeViewTab === ResultsViewTab.MAP}
                /* The discrepancy map must show every difference found, so it is never capped.
                 * maxFeatures={null} disables static pre-slice, while neverCapViewportRender={true}
                 * prevents the viewport-windowing layer from truncating for density. Both together
                 * satisfy the "never capped" contract. */
                maxFeatures={null}
                neverCapViewportRender={true}
              />
            </div>
          )}

          {/* SQL Patch Script Drawer (selected records only) */}
          <div className={activeViewTab === ResultsViewTab.SQL ? undefined : styles.tabHidden}>
            <SelectionSqlPatchDrawer
              summary={summary}
              selectedIds={selection.selectedIds}
              selectionVersion={selection.selectionVersion}
              fileDataset={fileDataset}
              mappingConfig={mappingConfig}
              dbConfig={dbConfig}
            />
          </div>
        </div>
      )}
    </div>
  );
};

ComparisonResultsView.displayName = "ComparisonResultsView";
