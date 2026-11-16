import React from "react";
import styles from "./SchemaTableSection.module.css";

export interface SchemaTableSectionProps {
  title?: string;
  note?: string;
  headerField?: React.ReactNode;
  children: React.ReactNode;
}

export const SchemaTableSection: React.FC<SchemaTableSectionProps> = ({ title, note, headerField, children }) => (
  <section className={styles.section}>
    {title !== undefined && <h4 className={styles.title}>{title}</h4>}
    {note !== undefined && <p className={styles.note}>{note}</p>}
    {headerField !== undefined && (
      <div className={styles.grid}>
        <div className={styles.cell}>{headerField}</div>
      </div>
    )}
    <div className={styles.grid}>{children}</div>
  </section>
);
