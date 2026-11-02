"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { PairChoice } from "../jobs/actualizar-padron/types";
import { pairChoiceKeyId } from "../jobs/actualizar-padron/domain/pairChoiceKey";
import { PairChoiceState, type ListedPairChoice } from "./pairChoices";
import { NO_DATA_TEXT } from "./reportFormat";
import styles from "./PairChoiceGroups.module.css";

const ICON_SIZE = 15;
const TITLE = "Elecciones de par";
const NOTE = "Elecciones que no aparecen en los grupos ambiguos: aplicadas, sin emparejar o no aplicadas.";
const REMOVE_LABEL = "Quitar elección";
const NO_PAIR_TEXT = "No emparejar";
const STATUS_LABEL: Record<PairChoiceState, string> = {
  [PairChoiceState.APPLIED]: "Aplicada",
  [PairChoiceState.UNAPPLIED]: "No aplicada",
  [PairChoiceState.NOT_PAIRED]: "Sin emparejar",
};
const STATUS_CLASS: Record<PairChoiceState, string> = {
  [PairChoiceState.APPLIED]: styles.statusApplied,
  [PairChoiceState.UNAPPLIED]: styles.badge,
  [PairChoiceState.NOT_PAIRED]: styles.badge,
};

const newPadronTextOf = (choice: PairChoice): string =>
  [
    `tipo ${choice.typePadron}`,
    `provincia ${choice.provinceId}`,
    `localidad ${choice.localityId ?? NO_DATA_TEXT}`,
    `padrón ${choice.number}`,
  ].join(", ");

const chosenTextOf = (choice: PairChoice): string =>
  choice.oldId === null ? NO_PAIR_TEXT : `id anterior elegido: ${choice.oldId}`;

export interface PairChoiceListProps {
  rows: readonly ListedPairChoice[];
  onRemove?: (choice: PairChoice) => void;
}

/** Choices listed apart from their cards; without onRemove (real-run results) they are read-only. */
export function PairChoiceList({ rows, onRemove }: PairChoiceListProps) {
  return (
    <div className={styles.unapplied}>
      <p className={styles.unappliedTitle}>{TITLE}</p>
      <p className={styles.note}>{NOTE}</p>
      <ul className={styles.unappliedList}>
        {rows.map(({ choice, state }) => (
          <li key={pairChoiceKeyId(choice)} className={styles.unappliedItem}>
            <span>{`Padrón nuevo: ${newPadronTextOf(choice)} · ${chosenTextOf(choice)}`}</span>
            <span className={STATUS_CLASS[state]}>{STATUS_LABEL[state]}</span>
            {onRemove !== undefined && (
              <Button variant={ButtonVariant.SECONDARY} onClick={() => onRemove(choice)}>
                <X size={ICON_SIZE} />
                <span>{REMOVE_LABEL}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
