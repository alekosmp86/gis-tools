import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { TableMetaPanel } from "./TableMetaPanel";
import { AttributeTable } from "../file-viewer/AttributeTable";
import { useFetchDbRecords } from "@/hooks/useDbQueries";
import { parseRecordsToGeoJson } from "@/utils/spatial/GeoJsonDatasetBuilder";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import type { DbConfig } from "@/types/db";
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
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const fetchRecordsMutation = useFetchDbRecords();

  useEffect(() => {
    fetchRecordsMutation.mutate(config, {
      onSuccess: (data) => {
        setRecords(data.records);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Extract spatial GeoJSON features from PostGIS table records using utility
  const { geojson, detectedGeometryType } = parseRecordsToGeoJson(records, columns);
  const hasGeometry = Boolean(geojson && geojson.features && geojson.features.length > 0);

  return (
    <div className={styles.container}>
      {/* Loading State */}
      {fetchRecordsMutation.isPending && (
        <div className={styles.loadingArea}>
          <Loader2 size={24} className={styles.spin} />
          <span>Consultando y extrayendo registros espaciales de la base de datos PostGIS...</span>
        </div>
      )}

      {/* Error Message if fetching records fails */}
      {fetchRecordsMutation.isError && (
        <AlertMessage
          type={AlertType.ERROR}
          text={
            fetchRecordsMutation.error instanceof Error
              ? fetchRecordsMutation.error.message
              : "No se pudieron obtener los registros de la base de datos."
          }
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
