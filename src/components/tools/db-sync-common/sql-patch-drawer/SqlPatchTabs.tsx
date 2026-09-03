import React from "react";
import { RefreshCw, PlusSquare } from "lucide-react";
import { SqlScriptType } from "@/types/comparison";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchTabsProps {
  activeTab: SqlScriptType;
  executedTabs: Record<SqlScriptType, boolean>;
  onTabChange: (tab: SqlScriptType) => void;
}

export const SqlPatchTabs: React.FC<SqlPatchTabsProps> = ({
  activeTab,
  executedTabs,
  onTabChange,
}) => {
  return (
    <div className={styles.scriptTabs}>
      <button
        type="button"
        className={`${styles.scriptTabBtn} ${activeTab === SqlScriptType.UPDATE ? styles.scriptTabActive : ""}`}
        onClick={() => onTabChange(SqlScriptType.UPDATE)}
      >
        <RefreshCw size={15} />
        <span>
          Script UPDATE
          {executedTabs[SqlScriptType.UPDATE] && " (Ejecutado)"}
        </span>
        <span className={styles.scriptTabHint}>Corregir atributos existentes</span>
      </button>

      <button
        type="button"
        className={`${styles.scriptTabBtn} ${activeTab === SqlScriptType.INSERT ? styles.scriptTabInsert : ""} ${activeTab === SqlScriptType.INSERT ? styles.scriptTabActive : ""}`}
        onClick={() => onTabChange(SqlScriptType.INSERT)}
      >
        <PlusSquare size={15} />
        <span>
          Script INSERT
          {executedTabs[SqlScriptType.INSERT] && " (Ejecutado)"}
        </span>
        <span className={styles.scriptTabHint}>Agregar registros faltantes</span>
      </button>
    </div>
  );
};
