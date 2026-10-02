"use client";

import React from "react";
import { FileSpreadsheet, Loader2, MapPinned, Route } from "lucide-react";
import { ExportFormat } from "../constants";
import { EXPORT_BUTTONS } from "../data/dedupLabels";
import styles from "./DedupExportBar.module.css";

interface DedupExportBarProps {
  exportingFormat: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

const ICON_BY_FORMAT = {
  [ExportFormat.CSV]: FileSpreadsheet,
  [ExportFormat.GEOJSON]: MapPinned,
  [ExportFormat.LINKS]: Route,
} as const;

export const DedupExportBar: React.FC<DedupExportBarProps> = ({ exportingFormat, onExport }) => (
  <div className={styles.group} role="group" aria-label="Exportar resultado">
    {EXPORT_BUTTONS.map(({ format, label, description }) => {
      const isExporting = exportingFormat === format;
      const Icon = isExporting ? Loader2 : ICON_BY_FORMAT[format];
      return (
        <button
          key={format}
          type="button"
          className={styles.button}
          title={description}
          aria-label={description}
          disabled={exportingFormat !== null}
          onClick={() => onExport(format)}
        >
          <Icon size={15} className={isExporting ? styles.spin : undefined} />
          {label}
        </button>
      );
    })}
  </div>
);
