"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Folder, Database, RefreshCw, Loader2, MapPin } from "lucide-react";
import type { ParsedFileDataset } from "@/core/types/parsers";
import type { DbConfig } from "@/core/types/db";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { DbConnectionForm } from "@/ui-kit/components/DbConnectionForm";
import { AttributeTable } from "@/ui-kit/components/AttributeTable";
import { FileViewerUploader } from "./FileViewerUploader";
import { FileMetaPanel } from "./FileMetaPanel";
import { TableMetaPanel } from "./TableMetaPanel";
import { useFileWorkspaceState } from "./hooks/useFileWorkspaceState";
import { useDbWorkspaceState } from "./hooks/useDbWorkspaceState";
import { useSpatialExplorerState } from "./hooks/useSpatialExplorerState";
import styles from "./SpatialExplorerContainer.module.css";

const DeckMapPreview = dynamic(
  () => import("@/ui-kit/components/DeckMapPreview").then((moduleExports) => moduleExports.DeckMapPreview),
  { ssr: false }
);

interface FileWorkspaceViewProps {
  dataset: ParsedFileDataset;
  onClear: () => void;
}

const FileWorkspaceView: React.FC<FileWorkspaceViewProps> = ({ dataset, onClear }) => {
  const {
    recordsList,
    hasGeometry,
    selectedRecordIndex,
    selectedFeatureIndex,
    handleSelectRecord,
    handleSelectFeature,
  } = useFileWorkspaceState(dataset);

  return (
    <div className={styles.container}>
      <FileViewerUploader
        parsedDataset={dataset}
        onFileParsed={(newDataset) => {
          if (!newDataset) {
            onClear();
          }
        }}
      />

      {hasGeometry && dataset.geojson ? (
        <div className={styles.mapLayout}>
          <div className={styles.mapSection}>
            <DeckMapPreview
              geojson={dataset.geojson}
              title={`VISTA ESPACIAL — ${dataset.fileName}`}
              selectedFeatureIndex={selectedFeatureIndex}
              onSelectFeature={handleSelectFeature}
            />
          </div>

          <div className={styles.sideSection}>
            <FileMetaPanel dataset={dataset} />
          </div>
        </div>
      ) : (
        <div className={styles.fullWidthSection}>
          <FileMetaPanel dataset={dataset} />
        </div>
      )}

      {recordsList.length > 0 && (
        <AttributeTable
          records={recordsList}
          attributes={dataset.attributes}
          selectedIndex={selectedRecordIndex}
          onSelectRow={handleSelectRecord}
        />
      )}
    </div>
  );
};

interface DbWorkspaceViewProps {
  config: DbConfig;
  columns: string[];
  totalRows: number;
  onDisconnect: () => void;
}

const DbWorkspaceView: React.FC<DbWorkspaceViewProps> = ({
  config,
  columns,
  totalRows,
  onDisconnect,
}) => {
  const {
    records,
    geojson,
    detectedGeometryType,
    detectedSrid,
    progressText,
    isPending,
    isError,
    error,
    hasGeometry,
    selectedRecordIndex,
    selectedFeatureIndex,
    handleSelectRecord,
    handleSelectFeature,
  } = useDbWorkspaceState(config, columns, totalRows);

  return (
    <div className={styles.container}>
      <div className={styles.connectedHeader}>
        <div className={styles.connectedInfo}>
          <Database size={18} />
          <span>
            {config.db_name} / {config.schema_name}.{config.table_name}
          </span>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          className={styles.changeConnectionBtn}
        >
          <RefreshCw size={13} />
          <span>Cambiar Tabla / Reconectar</span>
        </button>
      </div>

      {isPending && (
        <div className={styles.loadingArea}>
          <Loader2 size={24} className={styles.spin} />
          <span>{progressText}</span>
        </div>
      )}

      {isError && (
        <AlertMessage
          type={AlertType.ERROR}
          text={error ? error.message : "No se pudieron obtener los registros de la base de datos."}
        />
      )}

      {records.length > 0 && (
        <>
          {hasGeometry && geojson ? (
            <div className={styles.mapLayout}>
              <div className={styles.mapSection}>
                <DeckMapPreview
                  geojson={geojson}
                  title={`VISTA ESPACIAL POSTGIS — ${config.schema_name}.${config.table_name}`}
                  selectedFeatureIndex={selectedFeatureIndex}
                  onSelectFeature={handleSelectFeature}
                />
              </div>

              <div className={styles.sideSection}>
                <TableMetaPanel
                  config={config}
                  totalRows={totalRows || records.length}
                  columnsCount={columns.length}
                  geometryType={detectedGeometryType}
                  detectedSrid={detectedSrid}
                  loadedRows={records.length}
                />
              </div>
            </div>
          ) : (
            <div className={styles.fullWidthSection}>
              <TableMetaPanel
                config={config}
                totalRows={totalRows || records.length}
                columnsCount={columns.length}
                geometryType={detectedGeometryType}
                detectedSrid={detectedSrid}
                loadedRows={records.length}
              />
            </div>
          )}

          <AttributeTable
            records={records}
            attributes={columns}
            selectedIndex={selectedRecordIndex}
            onSelectRow={handleSelectRecord}
          />
        </>
      )}
    </div>
  );
};

export const SpatialExplorerContainer: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    parsedFileDataset,
    setParsedFileDataset,
    dbConfig,
    dbColumns,
    dbTotalRows,
    isDbConnected,
    setIsDbConnected,
    dbFormRef,
    handleDbSuccess,
    handleClearFile,
    handleDisconnectDb,
    handleProceedDb,
  } = useSpatialExplorerState();

  return (
    <div className={styles.container}>
      {/* Source Selector Tab Strip */}
      <div className={styles.sourceTabsContainer}>
        <button
          type="button"
          className={`${styles.sourceTabButton} ${
            activeTab === "file" ? styles.sourceTabButtonActive : ""
          }`}
          onClick={() => setActiveTab("file")}
        >
          <Folder size={16} />
          <span>Archivo Local (Shapefile, GeoJSON, CSV)</span>
        </button>

        <button
          type="button"
          className={`${styles.sourceTabButton} ${
            activeTab === "db" ? styles.sourceTabButtonActive : ""
          }`}
          onClick={() => setActiveTab("db")}
        >
          <Database size={16} />
          <span>Base de Datos PostGIS</span>
        </button>
      </div>

      {/* Active Source Content */}
      {activeTab === "file" ? (
        parsedFileDataset ? (
          <FileWorkspaceView
            dataset={parsedFileDataset}
            onClear={handleClearFile}
          />
        ) : (
          <FileViewerUploader
            parsedDataset={null}
            onFileParsed={setParsedFileDataset}
          />
        )
      ) : dbConfig ? (
        <DbWorkspaceView
          config={dbConfig}
          columns={dbColumns}
          totalRows={dbTotalRows}
          onDisconnect={handleDisconnectDb}
        />
      ) : (
        <div className={styles.dbCard}>
          <DbConnectionForm
            ref={dbFormRef}
            onSuccess={handleDbSuccess}
            onStatusChange={(status) =>
              setIsDbConnected(status.isConnected && status.columns.length > 0)
            }
          />

          {isDbConnected && (
            <div className={styles.proceedBar}>
              <div className={styles.proceedInfo}>
                <span className={styles.proceedInfoDot} />
                <span>Conexión establecida. Lista para visualización espacial.</span>
              </div>
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleProceedDb}
                type="button"
                className={styles.proceedButton}
              >
                <MapPin size={16} />
                <span>Visualizar Tabla en Mapa y Atributos</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
