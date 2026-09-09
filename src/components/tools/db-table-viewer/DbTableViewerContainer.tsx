import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { TableMetaPanel } from "./TableMetaPanel";
import { AttributeTable } from "../file-viewer/AttributeTable";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import type { DbConfig } from "@/types/db";
import { useDbTableViewerState } from "@/hooks/useDbTableViewerState";
import styles from "./DbTableViewerContainer.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((m) => m.SpatialMapPreview),
  { ssr: false }
);

interface DbTableViewerContainerProps {
  config: DbConfig;
  columns: string[];
  totalRows: number;
}

export const DbTableViewerContainer: React.FC<DbTableViewerContainerProps> = ({
  config,
  columns,
  totalRows,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const {
    records,
    geojson,
    detectedGeometryType,
    detectedSrid,
    progressText,
    isPending,
    isError,
    error,
  } = useDbTableViewerState(config, columns, totalRows);

  const hasGeometry = Boolean(geojson && geojson.features && geojson.features.length > 0);

  return (
    <div className={styles.container}>
      {/* Loading State with Live Streaming Progress */}
      {isPending && (
        <div className={styles.loadingArea}>
          <Loader2 size={24} className={styles.spin} />
          <span>{progressText}</span>
        </div>
      )}

      {/* Error Message if streaming records fails */}
      {isError && (
        <AlertMessage
          type={AlertType.ERROR}
          text={error ? error.message : "No se pudieron obtener los registros de la base de datos."}
        />
      )}

      {/* Main Workspace Layout after Connection */}
      {records.length > 0 && (
        <div className={styles.workspaceLayout}>
          {hasGeometry && geojson ? (
            <div className={styles.mapLayout}>
              <div className={styles.mapSection}>
                <SpatialMapPreview
                  geojson={geojson}
                  title={`VISTA ESPACIAL POSTGIS — ${config.schema_name}.${config.table_name}`}
                  selectedFeatureIndex={selectedIndex}
                  onSelectFeature={setSelectedIndex}
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

          {/* Attribute Table with Search & Bi-directional Row-Map Selection */}
          <AttributeTable
            records={records}
            attributes={columns}
            selectedIndex={selectedIndex}
            onSelectRow={setSelectedIndex}
          />
        </div>
      )}
    </div>
  );
};
