"use client";

import React from "react";
import { PAIR_TIER, type PairTier } from "../jobs/actualizar-padron/constants";
import type { PairCandidateView } from "./pairChoices";
import { candidateLabelOf } from "./padronMapSubject";
import { NO_DATA_TEXT, textOrNoData } from "./reportFormat";
import styles from "./PairChoiceGroups.module.css";

const TIER_LABEL: Record<PairTier, string> = {
  [PAIR_TIER.STRICT]: "Estricta",
  [PAIR_TIER.LOOSE]: "Parcial",
};
const PERCENT_SCALE = 100;
const AREA_DECIMAL_PLACES = 2;
const TAKEN_TEXT = "ya elegido para otro grupo";

const overlapText = (overlap: number | null): string =>
  overlap === null ? NO_DATA_TEXT : `${Math.round(overlap * PERCENT_SCALE)} %`;

const areaRatioText = (areaRatio: number | null): string =>
  areaRatio === null ? NO_DATA_TEXT : areaRatio.toFixed(AREA_DECIMAL_PLACES);

const SWATCH_CLASSES: readonly string[] = [styles.swatch1, styles.swatch2, styles.swatch3, styles.swatch4, styles.swatch5];

export interface PairCandidateRowProps {
  candidate: PairCandidateView;
  name: string;
  checked: boolean;
  disabled: boolean;
  takenElsewhere: boolean;
  /** The candidate's colour on the map, by its position; absent when no map shows it. */
  swatchIndex?: number;
  onSelect: () => void;
}

function CandidateSwatch({ swatchIndex }: { swatchIndex: number }) {
  return (
    <span className={styles.swatchLabel}>
      <span className={`${styles.swatch} ${SWATCH_CLASSES[swatchIndex] ?? ""}`} aria-hidden="true" />
      <span>{candidateLabelOf(swatchIndex)}</span>
    </span>
  );
}

export function PairCandidateRow({ candidate, name, checked, disabled, takenElsewhere, swatchIndex, onSelect }: PairCandidateRowProps) {
  const metaText = [
    TIER_LABEL[candidate.tier],
    `superposición ${overlapText(candidate.overlap)}`,
    `proporción de área ${areaRatioText(candidate.areaRatio)}`,
    ...(takenElsewhere ? [TAKEN_TEXT] : []),
  ].join(" · ");
  return (
    <label className={disabled ? styles.optionDisabled : styles.option}>
      <input type="radio" name={name} value={String(candidate.oldId)} checked={checked} disabled={disabled} onChange={onSelect} />
      <span className={styles.optionText}>
        {swatchIndex !== undefined && <CandidateSwatch swatchIndex={swatchIndex} />}
        <span>{`Id ${candidate.oldId}: tipo ${textOrNoData(candidate.oldType)}, localidad ${textOrNoData(candidate.oldLocality)}, padrón ${textOrNoData(candidate.oldNumber)}`}</span>
        <span className={styles.optionMeta}>{metaText}</span>
      </span>
    </label>
  );
}
