import React from "react";
import { FileCode } from "lucide-react";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchHeaderProps {
  children?: React.ReactNode;
}

export const SqlPatchHeader: React.FC<SqlPatchHeaderProps> = ({ children }) => {
  return (
    <div className={styles.header}>
      <div className={styles.titleGroup}>
        <FileCode size={20} className={styles.icon} />
        <div>
          <h3 className={styles.title}>Scripts SQL PostGIS</h3>
          <p className={styles.subtitle}>
            Seleccione el tipo de script a visualizar, copiar, descargar o ejecutar directamente.
          </p>
        </div>
      </div>

      <div className={styles.actionButtons}>
        {children}
      </div>
    </div>
  );
};
