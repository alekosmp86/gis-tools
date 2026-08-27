import React from "react";
import { Table, MapPin, FileCode } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";
import { ResultsViewTab } from "@/types/comparison";
type ResultsViewTabType = (typeof ResultsViewTab)[keyof typeof ResultsViewTab];

import styles from "./ResultsControlsBar.module.css";

interface ResultsControlsBarProps {
  activeViewTab: ResultsViewTabType;
  onSelectTab: (tab: ResultsViewTabType) => void;
  itemsCount: number;
  hasGeojson: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const ResultsControlsBar: React.FC<ResultsControlsBarProps> = ({
  activeViewTab,
  onSelectTab,
  itemsCount,
  hasGeojson,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <div className={styles.viewControlsRow}>
      <div className={styles.viewTabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeViewTab === ResultsViewTab.TABLE ? styles.tabActive : ""}`}
          onClick={() => onSelectTab(ResultsViewTab.TABLE)}
        >
          <Table size={16} />
          <span>Tabla de Discrepancias ({itemsCount})</span>
        </button>

        {hasGeojson && (
          <button
            type="button"
            className={`${styles.tabBtn} ${activeViewTab === ResultsViewTab.MAP ? styles.tabActive : ""}`}
            onClick={() => onSelectTab(ResultsViewTab.MAP)}
          >
            <MapPin size={16} />
            <span>Mapa de Discrepancias Espaciales</span>
          </button>
        )}

        <button
          type="button"
          className={`${styles.tabBtn} ${activeViewTab === ResultsViewTab.SQL ? styles.tabActive : ""}`}
          onClick={() => onSelectTab(ResultsViewTab.SQL)}
        >
          <FileCode size={16} />
          <span>Script SQL PostGIS</span>
        </button>
      </div>

      {activeViewTab === ResultsViewTab.TABLE && (
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Filtrar por SUID o valor de atributo..."
        />
      )}
    </div>
  );
};
