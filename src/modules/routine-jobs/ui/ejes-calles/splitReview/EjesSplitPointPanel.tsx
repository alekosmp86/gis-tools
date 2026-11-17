"use client";

import React from "react";
import { Map as MapIcon } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesSplitReviewPoint } from "../../../jobs/ejes-calles/types";
import { textOrNoData } from "../../shared/reportFormat";
import { EjesSplitCandidateRow } from "./EjesSplitCandidateRow";
import { EJES_SPLIT_DOOR_TEXT, EJES_SPLIT_REASON_NOTE, EJES_SPLIT_REASON_TEXT, EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

const ICON_SIZE = 15;

export interface EjesSplitPointPanelProps {
  point: EjesSplitReviewPoint;
  chosenRef: string | undefined;
  /** True when no piece can be chosen here (the request limit is reached, or the stored points disagree with the summary). */
  disabled: boolean;
  mapOpen: boolean;
  onChoose: (newRef: string) => void;
  onToggleMap: () => void;
}

/** The point on screen: its reason and door data, one row per candidate piece, and the switch of its map. */
export const EjesSplitPointPanel: React.FC<EjesSplitPointPanelProps> = ({
  point,
  chosenRef,
  disabled,
  mapOpen,
  onChoose,
  onToggleMap,
}) => (
  <section className={styles.pointPanel} aria-live="polite">
    <div className={styles.pointHeader}>
      <h4 className={styles.pointTitle}>{`${EJES_SPLIT_REVIEW_TEXT.POINT_TITLE} ${point.pointId}`}</h4>
      <span className={styles.reasonBadge}>{EJES_SPLIT_REASON_TEXT[point.reason]}</span>
    </div>
    <p className={styles.note}>{EJES_SPLIT_REASON_NOTE[point.reason]}</p>
    <dl className={styles.doors}>
      <dt className={styles.doorTerm}>{EJES_SPLIT_DOOR_TEXT.NUMBER}</dt>
      <dd className={styles.doorValue}>{textOrNoData(point.number)}</dd>
      <dt className={styles.doorTerm}>{EJES_SPLIT_DOOR_TEXT.LETTER}</dt>
      <dd className={styles.doorValue}>{textOrNoData(point.letter)}</dd>
      <dt className={styles.doorTerm}>{EJES_SPLIT_DOOR_TEXT.KM}</dt>
      <dd className={styles.doorValue}>{textOrNoData(point.km)}</dd>
      <dt className={styles.doorTerm}>{EJES_SPLIT_DOOR_TEXT.CIRCULATION_WAY}</dt>
      <dd className={styles.doorValue}>{textOrNoData(point.circulationWay)}</dd>
    </dl>
    <ul className={styles.candidates}>
      {point.candidates.map((candidate) => {
        const chosen = chosenRef === candidate.newRef;
        return (
          <EjesSplitCandidateRow
            key={candidate.newRef}
            candidate={candidate}
            chosen={chosen}
            disabled={disabled}
            onToggle={() => onChoose(candidate.newRef)}
          />
        );
      })}
    </ul>
    <div>
      <Button variant={ButtonVariant.SECONDARY} onClick={onToggleMap}>
        <MapIcon size={ICON_SIZE} />
        <span>{mapOpen ? EJES_SPLIT_REVIEW_TEXT.HIDE_MAP : EJES_SPLIT_REVIEW_TEXT.SHOW_MAP}</span>
      </Button>
    </div>
  </section>
);
