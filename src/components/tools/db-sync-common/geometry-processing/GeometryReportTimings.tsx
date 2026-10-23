import React from "react";
import { formatDuration } from "@/core/services/formatDuration";
import type { StepTiming } from "@/core/types/geometryProcessing";
import { ReportSection } from "./GeometryReportTables";
import styles from "./GeometryReport.module.css";

export interface GeometryReportTimingsProps {
  timings: ReadonlyArray<StepTiming>;
  processingMs: number;
}

export const GeometryReportTimings: React.FC<GeometryReportTimingsProps> = ({ timings, processingMs }) => (
  <ReportSection title="Tiempos por paso" count={timings.length}>
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Paso</th>
          <th>Duración</th>
        </tr>
      </thead>
      <tbody>
        {timings.map((timing) => (
          <tr key={timing.label}>
            <td>{timing.label}</td>
            <td>{formatDuration(timing.ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p className={styles.timingTotal}>{`Total del procesamiento: ${formatDuration(processingMs)}`}</p>
  </ReportSection>
);
