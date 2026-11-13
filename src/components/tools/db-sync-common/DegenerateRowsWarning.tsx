import React from "react";
import { AlertTriangle } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { DegenerateFileExample } from "@/core/types/comparison";
import styles from "./DiscrepanciesSummaryBar.module.css";

export interface DegenerateRowsWarningProps {
  skipped: number;
  examples: readonly DegenerateFileExample[];
}

/** The file rows left out because their geometry collapsed to a point, with the first few to find them. */
export const DegenerateRowsWarning: React.FC<DegenerateRowsWarningProps> = ({ skipped, examples }) => (
  <div className={styles.warningBanner}>
    <AlertTriangle size={16} />
    <div className={styles.warningBody}>
      <span>
        Filas del archivo con geometría degenerada ({formatNumber(skipped)} omitidas): la geometría se redujo a un punto y las
        filas no se cargaron.
      </span>
      {examples.length > 0 && (
        <ul className={styles.warningExamples}>
          {examples.map((example) => (
            <li key={example.rowNumber}>
              Fila {formatNumber(example.rowNumber)}: {example.suid === "" ? "sin clave" : example.suid}
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);
