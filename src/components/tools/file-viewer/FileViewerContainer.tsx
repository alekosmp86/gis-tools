import React, { useState } from "react";
import dynamic from "next/dynamic";
import type { ParsedFileDataset } from "@/types/parsers";
import { FileViewerUploader } from "./FileViewerUploader";
import { FileMetaPanel } from "./FileMetaPanel";
import { AttributeTable } from "./AttributeTable";
import styles from "./FileViewerContainer.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((m) => m.SpatialMapPreview),
  { ssr: false }
);

export const FileViewerContainer: React.FC = () => {
  const [parsedDataset, setParsedDataset] = useState<ParsedFileDataset | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const recordsList = parsedDataset?.recordsMap
    ? Array.from(parsedDataset.recordsMap.values())
    : [];

  const hasGeometry = Boolean(
    parsedDataset?.geojson &&
      parsedDataset.geojson.features &&
      parsedDataset.geojson.features.length > 0
  );

  return (
    <div className={styles.container}>
      <FileViewerUploader
        parsedDataset={parsedDataset}
        onFileParsed={(dataset) => {
          setParsedDataset(dataset);
          setSelectedIndex(null);
        }}
      />

      {parsedDataset && (
        <>
          {hasGeometry && parsedDataset.geojson ? (
            <div className={styles.mapLayout}>
              <div className={styles.mapSection}>
                <SpatialMapPreview
                  geojson={parsedDataset.geojson}
                  title={`VISTA ESPACIAL — ${parsedDataset.fileName}`}
                  selectedFeatureIndex={selectedIndex}
                  onSelectFeature={setSelectedIndex}
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
          selectedIndex={selectedIndex}
          onSelectRow={setSelectedIndex}
        />
      )}
    </div>
  );
};
