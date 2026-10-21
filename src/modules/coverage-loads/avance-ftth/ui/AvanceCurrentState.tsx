"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { AvancePlan } from "../client";
import styles from "./AvanceFilePlanCard.module.css";

interface AvanceCurrentStateProps {
  plan: AvancePlan;
}

const NO_DATE = "sin datos";

function describeLoadRange(plan: AvancePlan): string {
  const { oldestLoad, newestLoad } = plan.avance;
  if (oldestLoad === null || newestLoad === null) return NO_DATE;
  return oldestLoad === newestLoad ? oldestLoad : `${oldestLoad} a ${newestLoad}`;
}

export const AvanceCurrentState: React.FC<AvanceCurrentStateProps> = ({ plan }) => (
  <article className={styles.card}>
    <header className={styles.header}>
      <h3 className={styles.title}>Estado actual de la base de datos</h3>
    </header>
    <dl className={styles.facts}>
      <div>
        <dt>Filas del Avance</dt>
        <dd>{formatNumber(plan.avance.rows)}</dd>
      </div>
      <div>
        <dt>Fecha de carga del Avance</dt>
        <dd>{describeLoadRange(plan)}</dd>
      </div>
      <div>
        <dt>Filas del historial</dt>
        <dd>{formatNumber(plan.historyRows)}</dd>
      </div>
      <div>
        <dt>Zonas en SIGRA</dt>
        <dd>{formatNumber(plan.zoneRows)}</dd>
      </div>
    </dl>
  </article>
);
