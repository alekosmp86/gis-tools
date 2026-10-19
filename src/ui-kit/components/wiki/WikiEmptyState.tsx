import React from "react";
import { Construction } from "lucide-react";
import styles from "./WikiEmptyState.module.css";

export interface WikiEmptyStateProps {
  toolTitle: string;
}

/** "En construcción" notice for a tool that has no wiki pages yet. */
export const WikiEmptyState: React.FC<WikiEmptyStateProps> = ({ toolTitle }) => (
  <div className={`glass-panel ${styles.emptyState}`}>
    <Construction size={32} className={styles.icon} />
    <h2 className={styles.title}>En construcción</h2>
    <p className={styles.text}>La ayuda de {toolTitle} todavía no está disponible.</p>
  </div>
);
