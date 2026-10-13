"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import type { CutPlan } from "../client";
import styles from "./IndicatorsCutPlanCard.module.css";

interface IndicatorsCutPlanCardProps {
  cut: CutPlan;
}

export const IndicatorsCutPlanCard: React.FC<IndicatorsCutPlanCardProps> = ({ cut }) => (
  <article className={styles.card}>
    <header className={styles.header}>
      <h3 className={styles.title}>Corte {cut.fechaact}</h3>
      <span className={styles.fileName}>{cut.fileName}</span>
    </header>
    <p className={styles.replace}>{cut.replaceMessage}</p>
    <dl className={styles.facts}>
      <div>
        <dt>Filas en el archivo</dt>
        <dd>{formatNumber(cut.totalRows)}</dd>
      </div>
      <div>
        <dt>Filas válidas</dt>
        <dd>{formatNumber(cut.validRows)}</dd>
      </div>
      <div>
        <dt>Filas rechazadas</dt>
        <dd>{formatNumber(cut.rejectedRows.length)}</dd>
      </div>
      <div>
        <dt>Filas existentes</dt>
        <dd>{formatNumber(cut.existingRows)}</dd>
      </div>
    </dl>
    {cut.incompleteMessage && <AlertMessage type={AlertType.WARNING} text={cut.incompleteMessage} />}
    {cut.shrinkMessage && <AlertMessage type={AlertType.WARNING} text={cut.shrinkMessage} />}
  </article>
);
