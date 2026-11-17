"use client";

import React from "react";
import { Map as MapIcon } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesSplitReviewPoint, EjesStreet } from "../../../jobs/ejes-calles/types";
import { EjesSplitCandidateGroup } from "./EjesSplitCandidateGroup";
import { EJES_SPLIT_DOOR_TEXT, EJES_SPLIT_REASON_NOTE, EJES_SPLIT_REASON_TEXT, EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { splitStreetViewOf } from "./ejesSplitReviewView";
import styles from "./EjesSplitReview.module.css";

const ICON_SIZE = 15;
const DOOR_SEPARATOR = " · ";

export interface EjesSplitPointPanelProps {
  point: EjesSplitReviewPoint;
  /** The street of the old section of the split (the page's). */
  oldStreet: EjesStreet | null;
  chosenRef: string | undefined;
  /** True when no piece can be chosen here (the request limit is reached, or the stored points disagree with the summary). */
  disabled: boolean;
  mapOpen: boolean;
  onChoose: (newRef: string) => void;
  onToggleMap: () => void;
}

const doorFieldsOf = (point: EjesSplitReviewPoint): [string, string | null][] => [
  [EJES_SPLIT_DOOR_TEXT.NUMBER, point.number],
  [EJES_SPLIT_DOOR_TEXT.LETTER, point.letter],
  [EJES_SPLIT_DOOR_TEXT.KM, point.km],
  [EJES_SPLIT_DOOR_TEXT.CIRCULATION_WAY, point.circulationWay],
];

const doorLineOf = (point: EjesSplitReviewPoint): string => {
  const filled = doorFieldsOf(point).filter(([, value]) => value !== null && value !== "");
  if (filled.length === 0) return EJES_SPLIT_DOOR_TEXT.NO_DATA;
  return filled.map(([label, value]) => `${label} ${value}`).join(DOOR_SEPARATOR);
};

/** The point on screen: its reason and door data, its pieces as a radio group, and the switch of its map. */
export const EjesSplitPointPanel: React.FC<EjesSplitPointPanelProps> = ({
  point,
  oldStreet,
  chosenRef,
  disabled,
  mapOpen,
  onChoose,
  onToggleMap,
}) => {
  const streets = splitStreetViewOf(point.pointStreet, oldStreet);
  return (
    <section className={styles.pointPanel} aria-live="polite">
      <div className={styles.pointHeader}>
        <h4 className={styles.pointTitle}>{`${EJES_SPLIT_REVIEW_TEXT.POINT_TITLE} ${point.pointId}`}</h4>
        <span className={styles.reasonBadge}>{EJES_SPLIT_REASON_TEXT[point.reason]}</span>
      </div>
      <p className={styles.note}>{EJES_SPLIT_REASON_NOTE[point.reason]}</p>
      <p className={styles.doorLine}>{doorLineOf(point)}</p>
      <div className={styles.streetBlock}>
        {streets.lines.map((line) => (
          <p key={line} className={styles.streetLine}>{line}</p>
        ))}
      </div>
      {streets.mismatch && <AlertMessage type={AlertType.WARNING} text={EJES_SPLIT_REVIEW_TEXT.STREET_MISMATCH} />}
      <EjesSplitCandidateGroup candidates={point.candidates} chosenRef={chosenRef} disabled={disabled} onChoose={onChoose} />
      <div>
        <Button variant={ButtonVariant.SECONDARY} onClick={onToggleMap}>
          <MapIcon size={ICON_SIZE} />
          <span>{mapOpen ? EJES_SPLIT_REVIEW_TEXT.HIDE_MAP : EJES_SPLIT_REVIEW_TEXT.SHOW_MAP}</span>
        </Button>
      </div>
    </section>
  );
};
