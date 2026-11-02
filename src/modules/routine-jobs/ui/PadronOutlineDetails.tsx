"use client";

import React from "react";
import { AREA_CHANGE_KIND, type PadronMapDetails, type PadronMapOutline } from "./padronMapSubject";
import { PadronCatastroBlock } from "./PadronCatastroBlock";
import { decimalOrNoData, NO_DATA_TEXT, textOrNoData } from "./reportFormat";
import styles from "./PadronOutlineDetails.module.css";

const AREA_DECIMAL_PLACES = 1;
const PERCENT_DECIMAL_PLACES = 1;
const COORDINATE_DECIMAL_PLACES = 6;
const HINT = "Haga clic en un padrón del mapa para ver todos sus datos.";
const NONOVERLAP_LABEL = "Área no coincidente (%)";
const SIGNED_LABEL = "Cambio de área (%)";
const PREVIOUS_LABEL = "Clave anterior";

const differenceText = (details: PadronMapDetails): string => {
  if (details.oldAreaM2 === null || details.newAreaM2 === null) return NO_DATA_TEXT;
  const difference = details.newAreaM2 - details.oldAreaM2;
  const sign = difference > 0 ? "+" : "";
  return `${sign}${difference.toFixed(AREA_DECIMAL_PLACES)}`;
};

const idText = (value: number | null): string => (value === null ? NO_DATA_TEXT : String(value));

const detailRowsOf = (details: PadronMapDetails): Array<[string, string]> => [
  ["Tipo", textOrNoData(details.typePadron)],
  ["Departamento", textOrNoData(details.department)],
  ["Localidad", textOrNoData(details.locality)],
  ["Número", textOrNoData(details.number)],
  ["Id actual", idText(details.currentId)],
  ["Área anterior (m²)", decimalOrNoData(details.oldAreaM2, AREA_DECIMAL_PLACES)],
  ["Área nueva (m²)", decimalOrNoData(details.newAreaM2, AREA_DECIMAL_PLACES)],
  ["Diferencia de área (m²)", differenceText(details)],
  [
    details.areaChangeKind === AREA_CHANGE_KIND.NON_OVERLAP ? NONOVERLAP_LABEL : SIGNED_LABEL,
    decimalOrNoData(details.areaChangePct, PERCENT_DECIMAL_PLACES),
  ],
  ["Latitud", decimalOrNoData(details.centroidLat, COORDINATE_DECIMAL_PLACES)],
  ["Longitud", decimalOrNoData(details.centroidLon, COORDINATE_DECIMAL_PLACES)],
  ...(details.previous === null ? [] : [[PREVIOUS_LABEL, details.previous] as [string, string]]),
];

function DetailList({ details }: { details: PadronMapDetails }) {
  return (
    <dl className={styles.list}>
      {detailRowsOf(details).map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className={styles.term}>{label}</dt>
          <dd className={styles.definition}>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export interface PadronOutlineDetailsProps {
  /** The clicked outline; null before any click, when the hint asks for one. */
  outline: PadronMapOutline | null;
}

export function PadronOutlineDetails({ outline }: PadronOutlineDetailsProps) {
  if (outline === null) return <p className={styles.hint}>{HINT}</p>;
  return (
    <section className={styles.details} aria-live="polite">
      <h4 className={styles.outlineTitle}>{outline.label}</h4>
      <DetailList details={outline.details} />
      <PadronCatastroBlock keys={outline.catastro} />
    </section>
  );
}
