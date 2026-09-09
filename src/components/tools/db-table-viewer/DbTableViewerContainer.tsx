import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { TableMetaPanel } from "./TableMetaPanel";
import { AttributeTable } from "../file-viewer/AttributeTable";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import type { DbConfig } from "@/types/db";
import { useDbTableViewerState } from "@/hooks/useDbTableViewerState";
import { buildFeatureRecordIndex } from "@/utils/spatial/FeatureRecordIndex";
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
  // Selection is held as a record index: a record whose geometry did not parse has no feature, but
  // its row must still be selectable.
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number | null>(null);
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
  const featureRecordIndex = buildFeatureRecordIndex(geojson?.features);
  const selectedFeatureIndex =
    selectedRecordIndex === null ? null : featureRecordIndex.toFeatureIndex(selectedRecordIndex);

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
                  selectedFeatureIndex={selectedFeatureIndex}
                  onSelectFeature={(featureIndex) =>
                    setSelectedRecordIndex(
                      featureIndex === null ? null : featureRecordIndex.toRecordIndex(featureIndex)
                    )
                  }
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
            selectedIndex={selectedRecordIndex}
            onSelectRow={setSelectedRecordIndex}
          />
        </div>
      )}
    </div>
  );
};
