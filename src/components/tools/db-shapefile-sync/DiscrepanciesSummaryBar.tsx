import React from "react";
import { CheckCircle2, AlertTriangle, Database, Layers, BarChart2 } from "lucide-react";
import { DiscrepancyFilter, type DiscrepanciesSummaryBarProps } from "@/types/comparison";
import styles from "./DiscrepanciesSummaryBar.module.css";

export const DiscrepanciesSummaryBar: React.FC<DiscrepanciesSummaryBarProps> = ({
  summary,
  activeFilter,
  onSelectFilter,
}) => {
  return (
    <div className={styles.grid}>
      {/* Total Analyzed Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.ALL)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.ALL)}
        className={`${styles.kpiCard} ${activeFilter === DiscrepancyFilter.ALL ? styles.active : ""}`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Total Analizados</span>
          <div className={styles.iconTotal}>
            <BarChart2 size={18} />
          </div>
        </div>
        <div className={styles.cardValue}>{summary.totalAnalyzed.toLocaleString()}</div>
        <div className={styles.cardSub}>Registros evaluados</div>
      </div>

      {/* Discrepancies Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.ATTRIBUTE_MISMATCH)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.ATTRIBUTE_MISMATCH)}
        className={`${styles.kpiCard} ${
          activeFilter === DiscrepancyFilter.ATTRIBUTE_MISMATCH ? styles.active : ""
        }`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Discrepancias Atributos</span>
          <div className={styles.iconWarning}>
            <AlertTriangle size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valWarning}`}>
          {summary.attributeMismatchCount.toLocaleString()}
        </div>
        <div className={styles.cardSub}>Valores dispares entre DB y SHP</div>
      </div>

      {/* Exact Matches Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.MATCH)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.MATCH)}
        className={`${styles.kpiCard} ${activeFilter === DiscrepancyFilter.MATCH ? styles.active : ""}`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Coincidencias Exactas</span>
          <div className={styles.iconSuccess}>
            <CheckCircle2 size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valSuccess}`}>
          {summary.exactMatchesCount.toLocaleString()}
        </div>
        <div className={styles.cardSub}>Registros idénticos</div>
      </div>

      {/* Only in DB Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.ONLY_IN_DB)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.ONLY_IN_DB)}
        className={`${styles.kpiCard} ${
          activeFilter === DiscrepancyFilter.ONLY_IN_DB ? styles.active : ""
        }`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Solo en Base de Datos</span>
          <div className={styles.iconDb}>
            <Database size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valError}`}>
          {summary.onlyInDbCount.toLocaleString()}
        </div>
        <div className={styles.cardSub}>Faltantes en Shapefile</div>
      </div>

      {/* Only in SHP Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.ONLY_IN_SHP)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.ONLY_IN_SHP)}
        className={`${styles.kpiCard} ${
          activeFilter === DiscrepancyFilter.ONLY_IN_SHP ? styles.active : ""
        }`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Solo en Shapefile</span>
          <div className={styles.iconShp}>
            <Layers size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valInfo}`}>
          {summary.onlyInShpCount.toLocaleString()}
        </div>
        <div className={styles.cardSub}>Faltantes en Base de Datos</div>
      </div>
    </div>
  );
};
