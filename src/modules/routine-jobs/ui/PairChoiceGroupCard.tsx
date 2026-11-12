"use client";

import React from "react";
import type { PairChoice } from "../jobs/actualizar-padron/types";
import { choiceFor, choiceOfGroup, takenOldIds, type AmbiguousGroupView } from "./pairChoices";
import { PairCandidateRow } from "./PairCandidateRow";
import { MAP_CANDIDATE_LIMIT } from "./padronMapSubject";
import { textOrNoData } from "./reportFormat";
import { ShowOnMapButton } from "./map/ShowOnMapButton";
import styles from "./PairChoiceGroups.module.css";

const NO_PAIR_LABEL = "No emparejar (insertar como nuevo)";
const UNAPPLIED_BADGE = "Elección no aplicada";

const groupTitleOf = (group: AmbiguousGroupView): string =>
  `${textOrNoData(group.department)} · ${textOrNoData(group.locality)} · padrón ${group.key.number} (tipo ${group.key.typePadron})`;

export interface PairChoiceGroupCardProps {
  group: AmbiguousGroupView;
  choices: readonly PairChoice[];
  unapplied: boolean;
  onChoose?: (choice: PairChoice) => void;
  /** Opens the group in the map modal; absent inside the modal itself. */
  onShowMap?: () => void;
  /** Numbers the candidates with the colours of their map outlines (the card shown in the map modal). */
  numbered?: boolean;
  /** The radio group name; the modal copy of a card needs its own so it never shares the radios of the report's card. */
  radioName?: string;
}

/** The colour swatch index of a candidate on the map, or undefined when the card is not numbered or the map cannot colour it. */
const swatchIndexOf = (numbered: boolean, index: number): number | undefined =>
  numbered && index < MAP_CANDIDATE_LIMIT ? index : undefined;

export function PairChoiceGroupCard({ group, choices, unapplied, onChoose, onShowMap, numbered = false, radioName }: PairChoiceGroupCardProps) {
  const chosen = choiceOfGroup(choices, group);
  const taken = takenOldIds(choices, group);
  const readOnly = onChoose === undefined;
  const name = radioName ?? group.id;
  const choose = (oldId: number | null) => onChoose?.(choiceFor(group, oldId));
  return (
    <fieldset className={unapplied ? styles.cardUnapplied : styles.card}>
      <legend className={styles.cardTitle}>{groupTitleOf(group)}</legend>
      {onShowMap !== undefined && (
        <div className={styles.cardMap}>
          <ShowOnMapButton onShow={onShowMap} />
        </div>
      )}
      {unapplied && <p className={styles.badge}>{UNAPPLIED_BADGE}</p>}
      <div className={styles.options}>
        {group.candidates.map((candidate, index) => (
          <PairCandidateRow
            key={candidate.oldId}
            candidate={candidate}
            name={name}
            checked={chosen?.oldId === candidate.oldId}
            disabled={readOnly || taken.has(candidate.oldId)}
            takenElsewhere={taken.has(candidate.oldId)}
            swatchIndex={swatchIndexOf(numbered, index)}
            onSelect={() => choose(candidate.oldId)}
          />
        ))}
        <label className={readOnly ? styles.optionDisabled : styles.option}>
          <input
            type="radio"
            name={name}
            checked={chosen !== undefined && chosen.oldId === null}
            disabled={readOnly}
            onChange={() => choose(null)}
          />
          <span className={styles.optionText}>{NO_PAIR_LABEL}</span>
        </label>
      </div>
    </fieldset>
  );
}
