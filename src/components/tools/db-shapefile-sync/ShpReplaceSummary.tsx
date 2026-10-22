import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { formatNumber } from "@/core/common/ValueFormatter";
import { AnalyzeStatus, type AnalyzeOutcome, type SequenceAdjustment } from "@/core/types/replace";
import type { ShpReplaceResult } from "@/core/services/server/shpReplace/shpReplaceTypes";
import styles from "./ShpReplaceSummary.module.css";

export interface ShpReplaceSummaryProps {
  result: ShpReplaceResult;
}

interface KpiProps {
  label: string;
  value: number;
}

const Kpi: React.FC<KpiProps> = ({ label, value }) => (
  <div className={styles.kpi}>
    <span className={styles.kpiLabel}>{label}</span>
    <span className={styles.kpiValue}>{formatNumber(value)}</span>
  </div>
);

const describeAnalyze = (analyze: AnalyzeOutcome): { type: AlertType; text: string } => {
  if (analyze.status === AnalyzeStatus.OK) {
    return { type: AlertType.INFO, text: "ANALYZE ejecutado sobre la tabla destino." };
  }
  if (analyze.status === AnalyzeStatus.FAILED) {
    return {
      type: AlertType.WARNING,
      text: `ANALYZE falló: las estadísticas de la tabla destino no se actualizaron. ${analyze.message ?? ""}`.trim(),
    };
  }
  return { type: AlertType.INFO, text: "ANALYZE no ejecutado." };
};

const describeSequence = ({ qualifiedLabel, nextValue, resetToStart }: SequenceAdjustment): string =>
  `Secuencia ${qualifiedLabel} ajustada: el próximo id será ${nextValue}.${resetToStart ? " (se reinició en 1 antes de la carga)." : ""}`;

export const ShpReplaceSummary: React.FC<ShpReplaceSummaryProps> = ({ result }) => {
  const analyzeMessage = describeAnalyze(result.analyze);
  return (
    <div className={styles.summary}>
      <AlertMessage
        type={AlertType.SUCCESS}
        text="Reemplazo completado: la tabla destino contiene los registros del Shapefile."
      />

      <div className={styles.kpiGrid}>
        <Kpi label="Registros en el archivo" value={result.sourceRows} />
        <Kpi label="Registros cargados" value={result.stagedRows} />
        <Kpi label="Registros anteriores eliminados" value={result.previousRows} />
        <Kpi label="Registros insertados" value={result.insertedRows} />
      </div>

      {result.sequencesAdjusted.map((adjustment) => (
        <AlertMessage key={adjustment.qualifiedLabel} type={AlertType.INFO} text={describeSequence(adjustment)} />
      ))}

      <AlertMessage type={analyzeMessage.type} text={analyzeMessage.text} />
    </div>
  );
};
