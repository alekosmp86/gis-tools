import React from "react";
import { Database, Table, Layers, HardDrive, Hash, Globe } from "lucide-react";
import type { DbConfig } from "@/types/db";
import styles from "./TableMetaPanel.module.css";

interface TableMetaPanelProps {
  config: DbConfig;
  totalRows: number;
  columnsCount: number;
  geometryType?: string | null;
}

export const TableMetaPanel: React.FC<TableMetaPanelProps> = ({
  config,
  totalRows,
  columnsCount,
  geometryType,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.titleRow}>
        <div className={styles.iconBadge}>
          <Database size={22} />
        </div>
        <div>
          <h3 className={styles.titleText}>
            {config.schema_name}.{config.table_name}
          </h3>
          <p className={styles.subtitleText}>Metadatos de Tabla PostgreSQL / PostGIS</p>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Base de Datos</span>
          <span className={styles.cardValue}>
            <Database size={13} style={{ display: "inline", marginRight: 4 }} />
            {config.db_name}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Esquema & Tabla</span>
          <span className={styles.cardValue}>
            <Table size={13} style={{ display: "inline", marginRight: 4 }} />
            {config.schema_name}.{config.table_name}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Host / Servidor</span>
          <span className={styles.cardValue}>
            <HardDrive size={13} style={{ display: "inline", marginRight: 4 }} />
            {config.host}:{config.port}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Total de Registros</span>
          <span className={`${styles.cardValue} ${styles.cardValueHighlight}`}>
            <Hash size={13} style={{ display: "inline", marginRight: 4 }} />
            {totalRows.toLocaleString()} filas
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Total de Columnas</span>
          <span className={styles.cardValue}>
            <Layers size={13} style={{ display: "inline", marginRight: 4 }} />
            {columnsCount} columnas
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Geometría Detectada</span>
          <span className={`${styles.cardValue} ${styles.cardValueHighlight}`}>
            <Globe size={13} style={{ display: "inline", marginRight: 4 }} />
            {geometryType || "Alfanumérico / Sin Geometría"}
          </span>
        </div>
      </div>
    </div>
  );
};
