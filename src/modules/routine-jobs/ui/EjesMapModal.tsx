"use client";

import React from "react";
import type { EjesGeometryMapBase } from "./clientTypes";
import { EjesMapDetails } from "./EjesMapDetails";
import { EjesMapView } from "./EjesMapView";
import type { EjesMapOutline, EjesMapSubject } from "./ejesMapSubject";
import { OutlineMapBody } from "./map/OutlineMapBody";
import { OutlineMapModal } from "./map/OutlineMapModal";

export const EJES_PASSWORD_NOTICE = "Escriba la contraseña de la conexión en el paso de conexión para ver el mapa.";

/** The rows of the table the modal was opened from and the one on screen. */
export interface EjesMapReview {
  subjects: EjesMapSubject[];
  index: number;
}

export interface EjesMapModalProps {
  /** Null while closed. */
  review: EjesMapReview | null;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  base: EjesGeometryMapBase | null;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

const outlineAt = (outlines: readonly EjesMapOutline[], outlineIndex: number | null): EjesMapOutline | null =>
  outlineIndex === null ? null : outlines[outlineIndex] ?? null;

/**
 * The map of one split or merge in a dialog, with the way to the previous and next rows of the same table. Mounted only while a
 * review is open, so the dialog's behaviour starts and ends with it; moving keeps the dialog and its map.
 */
export function EjesMapModal({ review, base, onNavigate, onClose }: EjesMapModalProps) {
  if (review === null) return null;
  const subject = review.subjects[review.index];
  if (subject === undefined) return null;
  return (
    <OutlineMapModal
      title={subject.title}
      navigation={{ index: review.index, total: review.subjects.length, onNavigate }}
      onClose={onClose}
    >
      <OutlineMapBody
        subject={subject}
        notice={base === null ? EJES_PASSWORD_NOTICE : null}
        renderMap={(selectedOutlineIndex, onSelectOutline) =>
          base === null ? null : (
            <EjesMapView subject={subject} base={base} selectedOutlineIndex={selectedOutlineIndex} onSelectOutline={onSelectOutline} />
          )
        }
        renderDetails={(selectedOutlineIndex) => (
          <EjesMapDetails subject={subject} outline={outlineAt(subject.outlines, selectedOutlineIndex)} />
        )}
      />
    </OutlineMapModal>
  );
}
