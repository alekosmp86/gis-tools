"use client";

import React from "react";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { removalDecisionLabelOf, type MissingPadronView } from "./missingPadronView";
import { decimalOrNoData } from "./reportFormat";
import type { RemovalMarkSelection } from "./reviewDecisions";
import styles from "./PadronReview.module.css";

const ICON_SIZE = 15;
const PERCENT_DECIMAL_PLACES = 1;
const TITLE = "Decisión: padrón que ya no está en el catastro";
const MARK_LABEL = "Marcar para eliminar";
const KEEP_LABEL = "Conservar";
const RECORD_ONLY_NOTE = "Solo se registra: no se borra nada. La lista se descarga desde la sección de padrones faltantes.";

export interface MissingDecisionPanelProps {
  padron: MissingPadronView;
  removals: RemovalMarkSelection;
}

/** The record-only removal decision (AP-101), with the facts that weigh on it: what replaced the padrón and what still references it. */
export function MissingDecisionPanel({ padron, removals }: MissingDecisionPanelProps) {
  const marked = removals.marked.includes(padron.oldId);
  const { onMark, onUnmark } = removals;
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
        <span className={`${styles.stateValue} ${marked ? styles.stateWarning : ""}`}>{removalDecisionLabelOf(marked)}</span>
      </p>
      {onMark !== undefined && onUnmark !== undefined && (
        <div className={styles.actions}>
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onMark([padron.oldId])} disabled={marked}>
            <Trash2 size={ICON_SIZE} />
            <span>{MARK_LABEL}</span>
          </Button>
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onUnmark([padron.oldId])} disabled={!marked}>
            <Archive size={ICON_SIZE} />
            <span>{KEEP_LABEL}</span>
          </Button>
        </div>
      )}
      <p className={styles.hint}>{RECORD_ONLY_NOTE}</p>
    </section>
  );
}
