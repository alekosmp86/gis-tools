"use client";

import React from "react";
import { detectFileKind } from "../domain/fileName";
import { AvanceFileRow } from "./AvanceFileRow";
import styles from "./AvanceFileList.module.css";

interface AvanceFileListProps {
  files: ReadonlyArray<File>;
  onRemove: (index: number) => void;
}

export const AvanceFileList: React.FC<AvanceFileListProps> = ({ files, onRemove }) => {
  if (files.length === 0) return <p className={styles.empty}>Todavía no hay archivos seleccionados.</p>;

  return (
    <ul className={styles.list}>
      {files.map((file, index) => (
        <AvanceFileRow
          key={`${file.name}-${file.size}-${file.lastModified}`}
          file={file}
          kind={detectFileKind(file.name)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ul>
  );
};
