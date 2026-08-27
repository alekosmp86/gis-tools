import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, ArrowLeft, Database } from "lucide-react";
import { Button } from "@/components/ui/Button";
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
import type { ColumnMappingConfig } from "@/types/gis";
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
  onBackToMapping: () => void;
  sourceDbConfig?: DbConfig;
}

export const Step4ResultsView: React.FC<Step4ResultsViewProps> = ({
  dbConfig,
  fileDataset,
  mappingConfig,
  onBackToMapping,
  sourceDbConfig,
}) => {
  const { summary, loading, isReanalyzing, error, progress } = useDatasetComparison({
    dbConfig,
    fileDataset,
    mappingConfig,
    sourceDbConfig,
  });

  const [activeFilter, setActiveFilter] = useState<DiscrepancyFilter>(DiscrepancyFilter.ALL);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeViewTab, setActiveViewTab] = useState<ResultsViewTab>(ResultsViewTab.TABLE);

  const suidLabel = mappingConfig.suidColumns ? mappingConfig.suidColumns.join(" + ") : "";
  const errorMessage = error ? error.message : null;

  const showProgress = loading && progress.phase !== "";
  const hasGeojson = Boolean(fileDataset.geojson && fileDataset.geojson.features && fileDataset.geojson.features.length > 0);

  // Hook encapsulating discrepancy GeoJSON feature collection creation
  const discrepancyGeojson = useDiscrepancyGeojson(summary, fileDataset, activeFilter);

  return (
    <div className={`glass-panel ${styles.container}`}>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <Database size={24} />
        </div>
        <div>
          <h2 className={styles.title}>4. Resultados de Análisis y Discrepancias</h2>
          <p className={styles.subtitle}>
            Correlación realizada entre la tabla{" "}
            <code>
              {dbConfig.schema_name}.{dbConfig.table_name}
            </code>{" "}
            y el archivo <code>{fileDataset.fileName}</code> usando la clave SUID{" "}
            <code>{suidLabel}</code>.
          </p>
        </div>
      </div>

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
          <ResyncBanner isReanalyzing={isReanalyzing} progress={progress} />

          {/* KPI Summary Cards */}
          <DiscrepanciesSummaryBar
            summary={summary}
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
            isReanalyzing={isReanalyzing}
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

          {/* Back Navigation */}
          <div className={styles.actionsRow}>
            <Button variant="secondary" onClick={onBackToMapping}>
              <ArrowLeft size={16} />
              <span>Volver al Paso 3: Mapeo SUID</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
