import React from "react";
import styles from "./SchemaTableCard.module.css";

export interface SchemaTableCardProps {
  title: string;
  note: string;
  headerAction?: React.ReactNode;
  schema?: React.ReactNode;
  table: React.ReactNode;
}

export const SchemaTableCard: React.FC<SchemaTableCardProps> = ({ title, note, headerAction, schema, table }) => (
  <article className={styles.card}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h5 className={styles.title}>{title}</h5>
        <p className={styles.note}>{note}</p>
      </div>
      {headerAction !== undefined && <div className={styles.action}>{headerAction}</div>}
    </header>
    <div className={schema === undefined ? styles.singleField : styles.fields}>
      {schema !== undefined && <div className={styles.field}>{schema}</div>}
      <div className={styles.field}>{table}</div>
    </div>
  </article>
);
