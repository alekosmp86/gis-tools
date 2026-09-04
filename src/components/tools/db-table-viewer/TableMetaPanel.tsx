import React from "react";
import { Database, Table, Layers, HardDrive, Hash, Globe } from "lucide-react";
import { formatNumber } from "@/utils/common/ValueFormatter";
import type { DbConfig } from "@/types/db";
import styles from "./TableMetaPanel.module.css";

interface TableMetaPanelProps {
  config: DbConfig;
  totalRows: number;
  columnsCount: number;
  geometryType?: string | null;
  detectedSrid?: number | null;
  loadedRows?: number;
}

export const TableMetaPanel: React.FC<TableMetaPanelProps> = ({
  config,
  totalRows,
  columnsCount,
  geometryType,
  detectedSrid,
  loadedRows,
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
            <Database size={13} className={styles.valueIcon} />
            {config.db_name}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Esquema & Tabla</span>
          <span className={styles.cardValue}>
            <Table size={13} className={styles.valueIcon} />
            {config.schema_name}.{config.table_name}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Host / Servidor</span>
          <span className={styles.cardValue}>
            <HardDrive size={13} className={styles.valueIcon} />
            {config.host}:{config.port}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Total de Registros</span>
          <span className={`${styles.cardValue} ${styles.cardValueHighlight}`}>
            <Hash size={13} className={styles.valueIcon} />
            {formatNumber(totalRows)} filas
            {loadedRows && totalRows > loadedRows ? (
              <span className={styles.sampleBadge}>
                {" "}(muestra: {formatNumber(loadedRows)})
              </span>
            ) : null}
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Total de Columnas</span>
          <span className={styles.cardValue}>
            <Layers size={13} className={styles.valueIcon} />
            {formatNumber(columnsCount)} columnas
          </span>
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Geometría Detectada</span>
          <span className={`${styles.cardValue} ${styles.cardValueHighlight}`}>
            <Globe size={13} className={styles.valueIcon} />
            {geometryType
              ? `${geometryType}${detectedSrid ? ` (EPSG:${detectedSrid})` : ""}`
              : "Alfanumérico / Sin Geometría"}
          </span>
        </div>
      </div>
    </div>
  );
};
