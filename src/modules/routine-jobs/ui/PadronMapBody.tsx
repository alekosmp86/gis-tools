"use client";

import React from "react";
import type { GeometryMapBase } from "./clientTypes";
import { OutlineMapBody } from "./map/OutlineMapBody";
import type { PadronMapOutline, PadronMapSubject } from "./padronMapSubject";
import { PadronMapView } from "./PadronMapView";
import { PadronOutlineDetails } from "./PadronOutlineDetails";

const PASSWORD_MESSAGE = "Escriba la contraseña de la conexión en el paso de conexión para ver el mapa.";

const outlineAt = (outlines: readonly PadronMapOutline[], outlineIndex: number | null): PadronMapOutline | null =>
  outlineIndex === null ? null : outlines[outlineIndex] ?? null;

export interface PadronMapBodyProps {
  subject: PadronMapSubject;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  base: GeometryMapBase | null;
  /** The decision controls of the subject, shown above its details. */
  aside?: React.ReactNode;
}

/** The map of a padrón beside the details of the outline clicked on it, on the shared map body. */
export function PadronMapBody({ subject, base, aside }: PadronMapBodyProps) {
  return (
    <OutlineMapBody
      subject={subject}
      notice={base === null ? PASSWORD_MESSAGE : null}
      renderMap={(selectedOutlineIndex, onSelectOutline) =>
        base === null ? null : (
          <PadronMapView subject={subject} base={base} selectedOutlineIndex={selectedOutlineIndex} onSelectOutline={onSelectOutline} />
        )
      }
      renderDetails={(selectedOutlineIndex) => <PadronOutlineDetails outline={outlineAt(subject.outlines, selectedOutlineIndex)} />}
      aside={aside}
    />
  );
}
