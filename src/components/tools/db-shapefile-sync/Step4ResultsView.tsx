import React, { useState } from "react";
import { Loader2, ArrowLeft, Database, Table, FileCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { DiscrepanciesSummaryBar } from "./DiscrepanciesSummaryBar";
import { DiscrepanciesTable } from "./DiscrepanciesTable";
import { SqlPatchDrawer } from "./SqlPatchDrawer";
import { useComparisonQuery } from "@/hooks/useComparisonQuery";
import { DiscrepancyFilter, ResultsViewTab } from "@/types/comparison";
import type { ParsedFileDataset } from "@/types/parsers";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/gis";
import styles from "./Step4ResultsView.module.css";

interface Step4ResultsViewProps {
  dbConfig: DbConfig;
  fileDataset: ParsedShapefileData | ParsedFileDataset;
  mappingConfig: ColumnMappingConfig;
  onBackToMapping: () => void;
}

export const Step4ResultsView: React.FC<Step4ResultsViewProps> = ({
  dbConfig,
  fileDataset,
  mappingConfig,
  onBackToMapping,
}) => {
  const { data: summary, isLoading: loading, error } = useComparisonQuery(
    dbConfig,
    fileDataset,
    mappingConfig
  );

  const [activeFilter, setActiveFilter] = useState<DiscrepancyFilter>(DiscrepancyFilter.ALL);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeViewTab, setActiveViewTab] = useState<ResultsViewTab>(ResultsViewTab.TABLE);

  const errorMessage = error instanceof Error ? error.message : error ? "Error en el análisis." : null;

  return (
    <div className={`glass-panel ${styles.container}`}>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <Database size={24} />
        </div>
        <div>
          <h2 className={styles.title}>4. Resultados de Análisis y Discrepancias</h2>
          <p className={styles.subtitle}>
            Correlación realizada entre la tabla <code>{dbConfig.schema_name}.{dbConfig.table_name}</code> y el archivo <code>{fileDataset.fileName}</code> usando la clave SUID <code>{mappingConfig.suidColumn}</code>.
          </p>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className={styles.loadingArea}>
          <Loader2 size={36} className={styles.spin} />
          <span>Consultando registros PostGIS y correlacionando atributos contra el archivo...</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && <AlertMessage type="error" text={errorMessage} />}

      {/* Results View */}
      {summary && !loading && (
        <div className={styles.resultsContent}>
          {/* KPI Summary Cards */}
          <DiscrepanciesSummaryBar
            summary={summary}
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
          />

          {/* Controls Bar & View Mode Tabs */}
          <div className={styles.viewControlsRow}>
            <div className={styles.viewTabs}>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeViewTab === ResultsViewTab.TABLE ? styles.tabActive : ""}`}
                onClick={() => setActiveViewTab(ResultsViewTab.TABLE)}
              >
                <Table size={16} />
                <span>Tabla de Discrepancias ({summary.items.length})</span>
              </button>

              <button
                type="button"
                className={`${styles.tabBtn} ${activeViewTab === ResultsViewTab.SQL ? styles.tabActive : ""}`}
                onClick={() => setActiveViewTab(ResultsViewTab.SQL)}
              >
                <FileCode size={16} />
                <span>Script SQL PostGIS</span>
              </button>
            </div>

            {activeViewTab === ResultsViewTab.TABLE && (
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Filtrar por SUID o valor de atributo..."
              />
            )}
          </div>

          {/* Table View */}
          {activeViewTab === ResultsViewTab.TABLE && (
            <DiscrepanciesTable
              items={summary.items}
              activeFilter={activeFilter}
              searchQuery={searchQuery}
            />
          )}

          {/* SQL Patch Script Drawer */}
          {activeViewTab === ResultsViewTab.SQL && (
            <SqlPatchDrawer
              sqlScript={summary.sqlPatchScript}
              tableName={dbConfig.table_name}
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
