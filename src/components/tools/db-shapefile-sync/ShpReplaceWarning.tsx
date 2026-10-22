import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { describeDbServer } from "@/core/services/fullReplaceRunStore";
import type { DbConfig } from "@/core/types/db";
import styles from "./ShpReplaceWarning.module.css";

export interface ShpReplaceWarningProps {
  target: DbConfig;
  targetRowCount: number;
  recordCount: number;
}

export const ShpReplaceWarning: React.FC<ShpReplaceWarningProps> = ({ target, targetRowCount, recordCount }) => (
  <div className={styles.container}>
    <div className={styles.dangerBanner}>
      <AlertTriangle size={36} className={styles.dangerIcon} />
      <div className={styles.dangerContent}>
        <span className={styles.dangerTitle}>Acción destructiva: se eliminarán TODOS los registros de la tabla destino</span>
        <span className={styles.label}>Tabla destino que será vaciada</span>
        <span className={styles.server}>{describeDbServer(target)}</span>
        <span className={styles.table}>{buildQualifiedTableLabel(target.schema_name, target.table_name)}</span>
        <span className={styles.label}>Registros actuales en la tabla destino</span>
        <span className={styles.count}>{formatNumber(targetRowCount)}</span>
        <span className={styles.label}>Registros del Shapefile que se cargarán</span>
        <span className={styles.count}>{formatNumber(recordCount)}</span>
      </div>
    </div>

    <div className={styles.notice}>
      <ShieldAlert size={18} className={styles.noticeIcon} />
      <span>
        La carga se ejecuta en el servidor dentro de una sola transacción. Puede tardar varios minutos y bloquea la tabla
        destino durante todo el reemplazo. Si ocurre un error, la transacción se revierte y la tabla destino queda intacta.
        Cerrar la pestaña mientras el archivo se sube cancela la operación.
      </span>
    </div>
  </div>
);
