"use client";

import React from "react";
import type { MissingPadronView } from "./missingPadronView";
import { decimalOrNoData } from "./reportFormat";
import styles from "./PadronReview.module.css";

const PERCENT_DECIMAL_PLACES = 1;
const TITLE = "Padrón que ya no está en el catastro";
const AUTOMATIC_NOTE = "Los padrones sin direcciones asociadas o con direcciones reasignadas a sus partes se eliminan al guardar (salvo con par pendiente); no hay nada que decidir aquí.";

export interface MissingDecisionPanelProps {
  padron: MissingPadronView;
}

/** The read-only removal status (AP-101), with the facts that weigh on it: what replaced the padrón and what still references it. */
export function MissingDecisionPanel({ padron }: MissingDecisionPanelProps) {
  return (
    <section className={styles.panel}>
      <h4 className={styles.panelTitle}>{TITLE}</h4>
      <dl className={styles.facts}>
        <dt className={styles.factTerm}>Clase</dt>
        <dd className={styles.factValue}>{padron.classLabel}</dd>
        <dt className={styles.factTerm}>Reemplazado por</dt>
        <dd className={styles.factValue}>{padron.replacedBy}</dd>
        <dt className={styles.factTerm}>Cubierto (%)</dt>
        <dd className={styles.factValue}>{decimalOrNoData(padron.coveredPct, PERCENT_DECIMAL_PLACES)}</dd>
        <dt className={styles.factTerm}>Referencias</dt>
        <dd className={styles.factValue}>{padron.refs}</dd>
      </dl>
      <p className={styles.stateLine}>
        <span>Estado: </span>
        <span className={`${styles.stateValue} ${padron.willBeRemoved ? styles.stateWarning : ""}`}>{padron.removalStatus}</span>
      </p>
      <p className={styles.hint}>{AUTOMATIC_NOTE}</p>
    </section>
  );
}
