"use client";

import React from "react";
import { Search } from "lucide-react";
import styles from "./WatcherFilterBar.module.css";

export interface WatcherFilterBarProps {
  filterQuery: string;
  onFilterQueryChange: (query: string) => void;
  availableFormats: readonly string[];
  selectedFormat: string;
  onSelectFormat: (format: string) => void;
}

export const WatcherFilterBar: React.FC<WatcherFilterBarProps> = ({
  filterQuery,
  onFilterQueryChange,
  availableFormats,
  selectedFormat,
  onSelectFormat,
}) => {
  return (
    <div className={styles.filterBar}>
      <div className={styles.searchInputWrapper}>
        <Search size={16} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.searchInput}
          value={filterQuery}
          onChange={(event) => onFilterQueryChange(event.target.value)}
          placeholder="Filtrar por departamento o nombre..."
          aria-label="Filtrar por departamento o nombre"
        />
      </div>

      <div className={styles.formatChips}>
        {availableFormats.map((formatName) => (
          <button
            key={formatName}
            type="button"
            className={`${styles.chip} ${
              selectedFormat === formatName ? styles.chipActive : ""
            }`}
            onClick={() => onSelectFormat(formatName)}
          >
            {formatName}
          </button>
        ))}
      </div>
    </div>
  );
};

WatcherFilterBar.displayName = "WatcherFilterBar";
