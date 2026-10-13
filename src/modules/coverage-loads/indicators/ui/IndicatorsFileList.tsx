"use client";

import React from "react";
import { IndicatorsFileRow } from "./IndicatorsFileRow";
import styles from "./IndicatorsFileList.module.css";

interface IndicatorsFileListProps {
  files: ReadonlyArray<File>;
  onRemove: (index: number) => void;
}

export const IndicatorsFileList: React.FC<IndicatorsFileListProps> = ({ files, onRemove }) => {
  if (files.length === 0) return <p className={styles.empty}>Todavía no hay archivos seleccionados.</p>;

  return (
    <ul className={styles.list}>
      {files.map((file, index) => (
        <IndicatorsFileRow
          key={`${file.name}-${file.size}-${file.lastModified}`}
          file={file}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ul>
  );
};
