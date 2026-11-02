"use client";

import React, { useState } from "react";
import type { GeometryMapBase } from "./clientTypes";
import type { PadronMapOutline, PadronMapSubject } from "./padronMapSubject";
import { PadronMapView } from "./PadronMapView";
import { PadronOutlineDetails } from "./PadronOutlineDetails";
import styles from "./PadronMapBody.module.css";

const PASSWORD_MESSAGE = "Escriba la contraseña de la conexión en el paso de conexión para ver el mapa.";

const outlineAt = (outlines: readonly PadronMapOutline[], outlineIndex: number | null): PadronMapOutline | null =>
  outlineIndex === null ? null : outlines[outlineIndex] ?? null;

interface OutlineSelection {
  subject: PadronMapSubject;
  outlineIndex: number | null;
}

export interface PadronMapBodyProps {
  subject: PadronMapSubject;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  base: GeometryMapBase | null;
  /** The decision controls of the subject, shown above its details. */
  aside?: React.ReactNode;
}

/**
 * The map of a padrón beside the details of the outline clicked on it. The selection is one outline, by its index, and belongs to
 * the subject it was made on: moving to another subject starts with no selection while the map keeps its cache.
 */
export function PadronMapBody({ subject, base, aside }: PadronMapBodyProps) {
  const [selection, setSelection] = useState<OutlineSelection>({ subject, outlineIndex: null });
  const selectedOutlineIndex = selection.subject === subject ? selection.outlineIndex : null;
  const selectOutline = (outlineIndex: number | null) => setSelection({ subject, outlineIndex });
  return (
    <div className={styles.body}>
      <div className={styles.mapColumn}>
        {base === null ? (
          <p className={styles.passwordNotice}>{PASSWORD_MESSAGE}</p>
        ) : (
          <PadronMapView
            subject={subject}
            base={base}
            selectedOutlineIndex={selectedOutlineIndex}
            onSelectOutline={selectOutline}
          />
        )}
      </div>
      <div className={styles.detailsColumn}>
        {aside}
        <PadronOutlineDetails outline={outlineAt(subject.outlines, selectedOutlineIndex)} />
      </div>
    </div>
  );
}
