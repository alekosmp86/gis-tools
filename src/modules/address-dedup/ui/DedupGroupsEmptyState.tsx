"use client";

import React from "react";
import { FilterX, SearchX } from "lucide-react";
import styles from "./DedupGroupsEmptyState.module.css";

interface DedupGroupsEmptyStateProps {
  isFiltered: boolean;
  onClearFilters: () => void;
}

export const DedupGroupsEmptyState: React.FC<DedupGroupsEmptyStateProps> = ({
  isFiltered,
  onClearFilters,
}) => (
  <div className={`glass-panel ${styles.card}`}>
    <SearchX size={32} className={styles.icon} />
    <p className={styles.message}>
      {isFiltered
        ? "Ningún grupo coincide con los filtros aplicados."
        : "El análisis no encontró grupos de direcciones duplicadas."}
    </p>
    {isFiltered && (
      <button type="button" className={styles.action} onClick={onClearFilters}>
        <FilterX size={14} />
        Limpiar filtros
      </button>
    )}
  </div>
);
