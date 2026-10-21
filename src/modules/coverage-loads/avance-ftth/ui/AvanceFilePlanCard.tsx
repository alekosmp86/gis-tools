"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { FILE_KIND_LABELS, type FilePlan } from "../client";
import styles from "./AvanceFilePlanCard.module.css";

interface AvanceFilePlanCardProps {
  file: FilePlan;
  currentRows: number;
}

interface Fact {
  label: string;
  value: number;
}

function buildFacts(file: FilePlan, currentRows: number): Fact[] {
  return [
    { label: "Filas en el archivo", value: file.rowsRead },
    { label: "Filas válidas", value: file.validRows },
    { label: "Filas rechazadas", value: file.rejectedTotal },
    { label: "Basura CZONA (se elimina)", value: file.junkRows },
    { label: "Edificio vacío o #N/A", value: file.emptyEdificioRows },
    { label: "Claves repetidas", value: file.duplicateKeys },
    { label: "Filas hoy en la planilla", value: currentRows },
  ];
}

export const AvanceFilePlanCard: React.FC<AvanceFilePlanCardProps> = ({ file, currentRows }) => (
  <article className={styles.card}>
    <header className={styles.header}>
      <h3 className={styles.title}>
        {FILE_KIND_LABELS[file.kind]} · {file.fechaact}
      </h3>
      <span className={styles.fileName}>{file.fileName}</span>
    </header>
    <dl className={styles.facts}>
      {buildFacts(file, currentRows).map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{formatNumber(fact.value)}</dd>
        </div>
      ))}
    </dl>
  </article>
);
