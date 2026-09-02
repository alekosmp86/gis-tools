import React from "react";
import { CheckCircle2, AlertTriangle, Database, Layers, BarChart2, HelpCircle, Copy, Shapes } from "lucide-react";
import { formatNumber } from "@/utils/common/ValueFormatter";
import { DiscrepancyFilter, type ComparisonSummary } from "@/types/comparison";
import { SummaryKpiCard } from "./SummaryKpiCard";
import styles from "./DiscrepanciesSummaryBar.module.css";

export interface DiscrepanciesSummaryBarProps {
  summary: ComparisonSummary;
  activeFilter: DiscrepancyFilter;
  onSelectFilter: (filter: DiscrepancyFilter) => void;
  isReanalyzing?: boolean;
}

export const DiscrepanciesSummaryBar: React.FC<DiscrepanciesSummaryBarProps> = ({
  summary,
  activeFilter,
  onSelectFilter,
  isReanalyzing = false,
}) => {
  return (
    <div className={`${styles.grid} ${isReanalyzing ? styles.reanalyzing : ""}`}>
      {/* Total Analyzed Card */}
      <SummaryKpiCard
        title="Total Evaluados"
        value={summary.totalAnalyzed}
        subtitle={`DB: ${formatNumber(summary.totalDbRecords)} | Archivo: ${formatNumber(summary.totalFileRecords)}`}
        icon={BarChart2}
        iconContainerClass={styles.iconTotal}
        isActive={activeFilter === DiscrepancyFilter.ALL}
        onClick={() => onSelectFilter(DiscrepancyFilter.ALL)}
      />

      {/* Attribute Discrepancies Card */}
      <SummaryKpiCard
        title="Discrepancias Atributos"
        value={summary.attributeMismatchCount}
        subtitle="Valores dispares entre DB y SHP"
        icon={AlertTriangle}
        iconContainerClass={styles.iconWarning}
        valueClass={styles.valWarning}
        isActive={activeFilter === DiscrepancyFilter.ATTRIBUTE_MISMATCH}
        onClick={() => onSelectFilter(DiscrepancyFilter.ATTRIBUTE_MISMATCH)}
      />

      {/* Geometry Discrepancies Card */}
      <SummaryKpiCard
        title="Discrepancias Geométricas"
        value={summary.geometryMismatchCount}
        subtitle="Geometría o topología dispar"
        icon={Shapes}
        iconContainerClass={styles.iconShp}
        valueClass={styles.valWarning}
        isActive={activeFilter === DiscrepancyFilter.GEOMETRY_MISMATCH}
        onClick={() => onSelectFilter(DiscrepancyFilter.GEOMETRY_MISMATCH)}
      />

      {/* Exact Matches Card */}
      <SummaryKpiCard
        title="Coincidencias Exactas"
        value={summary.exactMatchesCount}
        subtitle="Registros idénticos"
        icon={CheckCircle2}
        iconContainerClass={styles.iconSuccess}
        valueClass={styles.valSuccess}
        isActive={activeFilter === DiscrepancyFilter.MATCH}
        onClick={() => onSelectFilter(DiscrepancyFilter.MATCH)}
      />

      {/* Null SUID Card */}
      <SummaryKpiCard
        title="SUIDs Nulos / Vacíos"
        value={summary.nullSuidCount}
        subtitle="Sin clave identificadora"
        icon={HelpCircle}
        iconContainerClass={styles.iconNull}
        valueClass={styles.valNull}
        isActive={activeFilter === DiscrepancyFilter.NULL_SUID}
        onClick={() => onSelectFilter(DiscrepancyFilter.NULL_SUID)}
      />

      {/* Duplicate SUID Card */}
      <SummaryKpiCard
        title="SUIDs Duplicados"
        value={summary.duplicateSuidCount}
        subtitle="Claves repetidas encontradas"
        icon={Copy}
        iconContainerClass={styles.iconDuplicate}
        valueClass={styles.valDuplicate}
        isActive={activeFilter === DiscrepancyFilter.DUPLICATE_SUID}
        onClick={() => onSelectFilter(DiscrepancyFilter.DUPLICATE_SUID)}
      />

      {/* Only in DB Card */}
      <SummaryKpiCard
        title="Solo en Base de Datos"
        value={summary.onlyInDbCount}
        subtitle="Faltantes en archivo fuente"
        icon={Database}
        iconContainerClass={styles.iconDb}
        valueClass={styles.valError}
        isActive={activeFilter === DiscrepancyFilter.ONLY_IN_DB}
        onClick={() => onSelectFilter(DiscrepancyFilter.ONLY_IN_DB)}
      />

      {/* Only in SHP Card */}
      <SummaryKpiCard
        title="Solo en Archivo Fuente"
        value={summary.onlyInShpCount}
        subtitle="Faltantes en Base de Datos"
        icon={Layers}
        iconContainerClass={styles.iconShp}
        valueClass={styles.valInfo}
        isActive={activeFilter === DiscrepancyFilter.ONLY_IN_SHP}
        onClick={() => onSelectFilter(DiscrepancyFilter.ONLY_IN_SHP)}
      />
    </div>
  );
};
