"use client";

import React from "react";
import { OUTLINE_ROLE } from "./map/outlineTypes";
import { coverageTextOf, metersTextOf } from "./ejesCallesReportView";
import { truncationNoteOf, type EjesMapOutline, type EjesMapSubject } from "./ejesMapSubject";
import { textOrNoData } from "./reportFormat";
import styles from "./EjesMapDetails.module.css";

const HINT = "Haga clic en un tramo del mapa para ver su referencia.";
const ROW_TITLE = "Datos del caso";
const ROLE_TEXT = {
  [OUTLINE_ROLE.OLD]: "Tramo anterior (en la tabla de tramos)",
  [OUTLINE_ROLE.NEW]: "Tramo nuevo (en el origen)",
} as const;

type DetailRow = [string, string];

const rowFactsOf = (subject: EjesMapSubject): DetailRow[] => [
  ["idcalle", textOrNoData(subject.facts.idcalle)],
  ["Puntos de acceso", String(subject.facts.points)],
  ["Cobertura", coverageTextOf(subject.facts.coverage)],
  ["Largo anterior (m)", metersTextOf(subject.facts.oldLength)],
  ["Largo nuevo (m)", metersTextOf(subject.facts.newLength)],
  ["Nuevo fuera del anterior (m)", metersTextOf(subject.facts.outsideLength)],
];

const outlineFactsOf = (outline: EjesMapOutline): DetailRow[] => [
  ["reftramo", outline.ref],
  ["Tramo", ROLE_TEXT[outline.role]],
];

function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className={styles.list}>
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className={styles.term}>{label}</dt>
          <dd className={styles.definition}>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export interface EjesMapDetailsProps {
  subject: EjesMapSubject;
  /** The clicked outline; null before any click, when the hint asks for one. */
  outline: EjesMapOutline | null;
}

/** The facts of the whole row, the cut note when the row has more outlines than one request carries, and the clicked outline. */
export function EjesMapDetails({ subject, outline }: EjesMapDetailsProps) {
  const note = truncationNoteOf(subject);
  return (
    <section className={styles.details} aria-live="polite">
      <h4 className={styles.sectionTitle}>{ROW_TITLE}</h4>
      <DetailList rows={rowFactsOf(subject)} />
      {note !== null && <p className={styles.note}>{note}</p>}
      {outline === null ? (
        <p className={styles.hint}>{HINT}</p>
      ) : (
        <>
          <h4 className={styles.sectionTitle}>{outline.label}</h4>
          <DetailList rows={outlineFactsOf(outline)} />
        </>
      )}
    </section>
  );
}
