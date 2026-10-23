import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { GeometryProcessingReport } from "@/core/types/geometryProcessing";
import styles from "./GeometryReport.module.css";

export interface GeometryReportKpisProps {
  report: GeometryProcessingReport;
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

export const GeometryReportKpis: React.FC<GeometryReportKpisProps> = ({ report }) => (
  <div className={styles.kpiGrid}>
    <Kpi label="Geometrías inválidas" value={report.invalidBefore} />
    <Kpi label="Geometrías reparadas" value={report.repaired} />
    <Kpi label="Vacías tras reparar" value={report.emptyAfterRepair} />
    <Kpi label="Grupos unificados" value={report.groups} />
    <Kpi label="Registros fusionados" value={report.rowsMerged} />
    <Kpi label="Conflictos de atributos" value={report.attributeConflicts} />
    <Kpi label="Solapes" value={report.overlapCount} />
    <Kpi label="Omitidas en solapes" value={report.overlapSkippedInvalid} />
    <Kpi label="Insertadas inválidas" value={report.insertedInvalid} />
  </div>
);
