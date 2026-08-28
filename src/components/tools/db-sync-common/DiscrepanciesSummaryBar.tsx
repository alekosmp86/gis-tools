import React from "react";
import { CheckCircle2, AlertTriangle, Database, Layers, BarChart2, HelpCircle, Copy } from "lucide-react";
import { formatNumber } from "@/utils/formatters";
import { DiscrepancyFilter, type DiscrepanciesSummaryBarProps } from "@/types/comparison";
import styles from "./DiscrepanciesSummaryBar.module.css";

export const DiscrepanciesSummaryBar: React.FC<DiscrepanciesSummaryBarProps> = ({
  summary,
  activeFilter,
  onSelectFilter,
  isReanalyzing = false,
}) => {
  return (
    <div className={`${styles.grid} ${isReanalyzing ? styles.reanalyzing : ""}`}>
      {/* Total Analyzed Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.ALL)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.ALL)}
        className={`${styles.kpiCard} ${activeFilter === DiscrepancyFilter.ALL ? styles.active : ""}`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Total Evaluados</span>
          <div className={styles.iconTotal}>
            <BarChart2 size={18} />
          </div>
        </div>
        <div className={styles.cardValue}>{formatNumber(summary.totalAnalyzed)}</div>
        <div className={styles.cardSub}>
          DB: {formatNumber(summary.totalDbRecords)} | Archivo: {formatNumber(summary.totalFileRecords)}
        </div>
      </div>

      {/* Attribute Discrepancies Card */}
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
          {formatNumber(summary.attributeMismatchCount)}
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
          {formatNumber(summary.exactMatchesCount)}
        </div>
        <div className={styles.cardSub}>Registros idénticos</div>
      </div>

      {/* Null SUID Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.NULL_SUID)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.NULL_SUID)}
        className={`${styles.kpiCard} ${activeFilter === DiscrepancyFilter.NULL_SUID ? styles.active : ""}`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>SUIDs Nulos / Vacíos</span>
          <div className={styles.iconNull}>
            <HelpCircle size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valNull}`}>
          {formatNumber(summary.nullSuidCount)}
        </div>
        <div className={styles.cardSub}>Sin clave identificadora</div>
      </div>

      {/* Duplicate SUID Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFilter(DiscrepancyFilter.DUPLICATE_SUID)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectFilter(DiscrepancyFilter.DUPLICATE_SUID)}
        className={`${styles.kpiCard} ${activeFilter === DiscrepancyFilter.DUPLICATE_SUID ? styles.active : ""}`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>SUIDs Duplicados</span>
          <div className={styles.iconDuplicate}>
            <Copy size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valDuplicate}`}>
          {formatNumber(summary.duplicateSuidCount)}
        </div>
        <div className={styles.cardSub}>Claves repetidas encontradas</div>
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
          {formatNumber(summary.onlyInDbCount)}
        </div>
        <div className={styles.cardSub}>Faltantes en archivo fuente</div>
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
          <span className={styles.cardTitle}>Solo en Archivo Fuente</span>
          <div className={styles.iconShp}>
            <Layers size={18} />
          </div>
        </div>
        <div className={`${styles.cardValue} ${styles.valInfo}`}>
          {formatNumber(summary.onlyInShpCount)}
        </div>
        <div className={styles.cardSub}>Faltantes en Base de Datos</div>
      </div>
    </div>
  );
};
