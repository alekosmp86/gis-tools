import React, { useState } from "react";
import dynamic from "next/dynamic";
import type { ParsedFileDataset } from "@/types/parsers";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import { formatNumber } from "@/utils/common/ValueFormatter";
import { FileViewerUploader } from "./FileViewerUploader";
import { FileMetaPanel } from "./FileMetaPanel";
import { AttributeTable } from "./AttributeTable";
import { buildFeatureRecordIndex } from "@/utils/spatial/FeatureRecordIndex";
import styles from "./FileViewerContainer.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

export const FileViewerContainer: React.FC = () => {
  const [parsedDataset, setParsedDataset] = useState<ParsedFileDataset | null>(null);
  // Selection is held as a record index: the map may omit records whose geometry did not parse, and
  // for large datasets it renders only a capped sample, while the table lists every record.
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number | null>(null);

  const recordsList = parsedDataset?.recordsMap
    ? Array.from(parsedDataset.recordsMap.values())
    : [];

  const hasGeometry = Boolean(
    parsedDataset?.geojson &&
      parsedDataset.geojson.features &&
      parsedDataset.geojson.features.length > 0
  );

  const featureRecordIndex = buildFeatureRecordIndex(parsedDataset?.geojson?.features);
  const selectedFeatureIndex =
    selectedRecordIndex === null ? null : featureRecordIndex.toFeatureIndex(selectedRecordIndex);

  return (
    <div className={styles.container}>
      <FileViewerUploader
        parsedDataset={parsedDataset}
        onFileParsed={(dataset) => {
          setParsedDataset(dataset);
          setSelectedRecordIndex(null);
        }}
      />

      {parsedDataset && (
        <>
          {hasGeometry && parsedDataset.geojson ? (
            <div className={styles.mapLayout}>
              <div className={styles.mapSection}>
                {parsedDataset.isLargeDataset && (
                  <AlertMessage
                    type={AlertType.WARNING}
                    className={styles.previewNotice}
                    text={`Vista previa de muestra: Mostrando ${formatNumber(parsedDataset.geojson.features.length)} de ${formatNumber(parsedDataset.featureCount)} entidades en el mapa inicial para asegurar fluidez de navegación.`}
                  />
                )}
                <SpatialMapPreview
                  geojson={parsedDataset.geojson}
                  title={`VISTA ESPACIAL — ${parsedDataset.fileName}`}
                  selectedFeatureIndex={selectedFeatureIndex}
                  onSelectFeature={(featureIndex) =>
                    setSelectedRecordIndex(
                      featureIndex === null ? null : featureRecordIndex.toRecordIndex(featureIndex)
                    )
                  }
                />
              </div>

              <div className={styles.sideSection}>
                <FileMetaPanel dataset={parsedDataset} />
              </div>
            </div>
          ) : (
            <div className={styles.fullWidthSection}>
              <FileMetaPanel dataset={parsedDataset} />
            </div>
          )}
        </>
      )}

      {/* Attribute Table (always visible after upload) */}
      {parsedDataset && recordsList.length > 0 && (
        <AttributeTable
          records={recordsList}
          attributes={parsedDataset.attributes}
          selectedIndex={selectedRecordIndex}
          onSelectRow={setSelectedRecordIndex}
        />
      )}
    </div>
  );
};
