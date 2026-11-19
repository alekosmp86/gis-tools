"use client";

import React from "react";
import { OUTLINE_ROLE } from "../shared/map/outlineTypes";
import { coverageTextOf, metersTextOf, twinDecisionTextOf, twinRowCaseTextOf } from "./ejesCallesReportView";
import { truncationNoteOf, type EjesMapOutline, type EjesMapSubject, type EjesTwinFacts } from "./ejesMapSubject";
import { geoTwinKeptTextOf, geoTwinRemovedTextOf, GEO_TWIN_TEXT } from "./compact/ejesGeoTwinColumns";
import { textOrNoData } from "../shared/reportFormat";
import type { EjesAcceptView } from "./ejesAccept";
import { EjesUndecidedCopies } from "./EjesUndecidedCopies";
import type { EjesGeoTwinRow } from "../../jobs/ejes-calles/types";
import styles from "./EjesMapDetails.module.css";

const HINT = "Haga clic en un tramo del mapa o de la lista para ver su referencia.";
const ROW_TITLE = "Datos del caso";
const ROLE_TEXT = {
  [OUTLINE_ROLE.OLD]: "Tramo anterior (en la tabla de tramos)",
  [OUTLINE_ROLE.NEW]: "Tramo nuevo (en el origen)",
  [OUTLINE_ROLE.ZONE]: "Padrones cerca del tramo",
  [OUTLINE_ROLE.LOCALITY]: "Localidad que cruza el tramo",
  [OUTLINE_ROLE.DEPARTMENT]: "Departamento del tramo",
} as const;

type DetailRow = [string, string];

const twinFactsOf = (idcalle: string | null, twin: EjesTwinFacts): DetailRow[] => {
  const textRow = {
    class: twin.twinClass,
    localities: twin.localities,
    dropLocalities: twin.dropLocalities,
    insideLocalities: twin.insideLocalities,
  };
  return [
  ["idcalle", textOrNoData(idcalle)],
  ["Departamento", textOrNoData(twin.department)],
  ["Localidades", twin.localities.join(", ")],
  ["Caso", twinRowCaseTextOf(textRow)],
  ["Qué pasa", twinDecisionTextOf(textRow)],
  ["Largo (m)", metersTextOf(twin.length)],
  ["Cerca de urbanos (m)", metersTextOf(twin.urbanLength)],
  ["Cerca de rurales (m)", metersTextOf(twin.ruralLength)],
  ];
};

const splitMergeFactsOf = (subject: EjesMapSubject): DetailRow[] => [
  ["idcalle", textOrNoData(subject.facts.idcalle)],
  ["Puntos de acceso", String(subject.facts.points)],
  ["Cobertura", coverageTextOf(subject.facts.coverage)],
  ["Largo anterior (m)", metersTextOf(subject.facts.oldLength)],
  ["Largo nuevo (m)", metersTextOf(subject.facts.newLength)],
  ["Nuevo fuera del anterior (m)", metersTextOf(subject.facts.outsideLength)],
];

const renumberedFactsOf = (subject: EjesMapSubject, hausdorff: number | null): DetailRow[] => [
  ["idcalle", textOrNoData(subject.facts.idcalle)],
  ["Puntos de acceso", String(subject.facts.points)],
  ["Largo anterior (m)", metersTextOf(subject.facts.oldLength)],
  ["Largo nuevo (m)", metersTextOf(subject.facts.newLength)],
  ["Distancia máxima entre trazados (m)", metersTextOf(hausdorff)],
];

const geoTwinFactsOf = (row: EjesGeoTwinRow): DetailRow[] => [
  ["idcalle", textOrNoData(row.idcalle)],
  ["Localidad", textOrNoData(row.localidad)],
  [GEO_TWIN_TEXT.KEPT_HEADER, geoTwinKeptTextOf(row)],
  [GEO_TWIN_TEXT.REMOVED_HEADER, geoTwinRemovedTextOf(row)],
];

const idAndPointsFactsOf = (subject: EjesMapSubject): DetailRow[] => [
  ["idcalle", textOrNoData(subject.facts.idcalle)],
  ["Puntos de acceso", String(subject.facts.points)],
];

function rowFactsOf(subject: EjesMapSubject): DetailRow[] {
  if (subject.twin !== undefined) return twinFactsOf(subject.facts.idcalle, subject.twin);
  if (subject.geoTwin !== undefined) return geoTwinFactsOf(subject.geoTwin);
  if (subject.renumbered !== undefined) return renumberedFactsOf(subject, subject.renumbered.hausdorff);
  if (subject.held === true || subject.undecided !== undefined) return idAndPointsFactsOf(subject);
  return splitMergeFactsOf(subject);
}

const outlineFactsOf = (outline: EjesMapOutline): DetailRow[] => [
  ["reftramo", outline.ref],
  ["Tramo", ROLE_TEXT[outline.role]],
  ...(outline.locality === undefined ? [] : [["Localidad", outline.locality] as DetailRow]),
  ...(outline.dropped === undefined ? [] : [["Copia", outline.dropped ? "Se quitaría" : "Se queda"] as DetailRow]),
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
  /** The selected outline; null before any selection, when the hint asks for one. */
  outline: EjesMapOutline | null;
  selectedOutlineIndex?: number | null;
  /** Selecting from the list reaches outlines that lie under others on the map. */
  onSelectOutline?: (outlineIndex: number | null) => void;
  /** The wizard's accept state: the copies of an undecided row are picked from the map through it. */
  accept?: EjesAcceptView;
}

const LIST_TITLE = "Tramos";

interface OutlineListProps {
  outlines: readonly EjesMapOutline[];
  selectedOutlineIndex: number | null;
  onSelectOutline: (outlineIndex: number | null) => void;
}

function OutlineList({ outlines, selectedOutlineIndex, onSelectOutline }: OutlineListProps) {
  return (
    <>
      <h4 className={styles.sectionTitle}>{LIST_TITLE}</h4>
      <ul className={styles.outlineList}>
        {outlines.map((outline, index) => (
          <li key={`${outline.role}-${outline.mapType ?? ""}-${outline.ref}-${outline.locality ?? ""}`}>
            <button
              type="button"
              className={styles.outlineButton}
              data-role={outline.role}
              aria-pressed={index === selectedOutlineIndex}
              onClick={() => onSelectOutline(index === selectedOutlineIndex ? null : index)}
            >
              <span className={styles.swatch} data-role={outline.role} data-map-type={outline.mapType} />
              <span>{outline.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The facts of the whole row, the cut note when the row has more outlines than one request carries, the list of outlines and the selected one. */
export function EjesMapDetails({ subject, outline, selectedOutlineIndex = null, onSelectOutline, accept }: EjesMapDetailsProps) {
  const note = truncationNoteOf(subject);
  return (
    <section className={styles.details} aria-live="polite">
      <h4 className={styles.sectionTitle}>{ROW_TITLE}</h4>
      <DetailList rows={rowFactsOf(subject)} />
      {note !== null && <p className={styles.note}>{note}</p>}
      {subject.undecided !== undefined && accept !== undefined && (
        <EjesUndecidedCopies
          reference={subject.undecided.ref}
          copies={subject.undecided.copies}
          picks={accept.twinPicks}
          onChange={accept.onTwinPickChange}
        />
      )}
      {onSelectOutline !== undefined && (
        <OutlineList outlines={subject.outlines} selectedOutlineIndex={selectedOutlineIndex} onSelectOutline={onSelectOutline} />
      )}
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
