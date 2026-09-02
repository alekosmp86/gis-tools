import React from "react";
import { Table, MapPin, FileCode } from "lucide-react";
import { ResultsViewTab } from "@/types/comparison";
import { formatNumber } from "@/utils/common/ValueFormatter";
import styles from "./ResultsControlsBar.module.css";

type ResultsViewTabType = (typeof ResultsViewTab)[keyof typeof ResultsViewTab];

interface ResultsControlsBarProps {
  activeViewTab: ResultsViewTabType;
  onSelectTab: (tab: ResultsViewTabType) => void;
  itemsCount: number;
  hasGeojson: boolean;
}

export const ResultsControlsBar: React.FC<ResultsControlsBarProps> = ({
  activeViewTab,
  onSelectTab,
  itemsCount,
  hasGeojson,
}) => {
  return (
    <div className={styles.viewTabs}>
      <button
        type="button"
        className={`${styles.tabBtn} ${activeViewTab === ResultsViewTab.TABLE ? styles.tabActive : ""}`}
        onClick={() => onSelectTab(ResultsViewTab.TABLE)}
      >
        <Table size={16} />
        <span>Tabla de Discrepancias</span>
        <span className={styles.countBadge}>{formatNumber(itemsCount)}</span>
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
  );
};
