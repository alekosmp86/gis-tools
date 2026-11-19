"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesTwinCopy, EjesTwinPick } from "../../jobs/ejes-calles/types";
import { twinPickOf, twinPicksCapReached, type EjesTwinPickChange } from "./ejesAccept";
import { EJES_TWIN_PICK_TEXT } from "./ejesTwinPickTexts";
import { copyTextOf, isChosenCopy, isPickableCopy } from "./ejesTwinPickView";
import styles from "./EjesUndecidedCopies.module.css";

const ICON_SIZE = 15;

export interface EjesUndecidedCopiesProps {
  reference: string;
  copies: EjesTwinCopy[];
  picks: readonly EjesTwinPick[];
  onChange: (change: EjesTwinPickChange) => void;
}

const copyKeyOf = (copy: EjesTwinCopy): string => `${copy.department ?? ""}|${copy.locality ?? ""}`;

/** The copies of an undecided `reftramo` on the map: each is chosen or cleared here, through the same pick the table select makes. */
export function EjesUndecidedCopies({ reference, copies, picks, onChange }: EjesUndecidedCopiesProps) {
  const pick = twinPickOf(picks, reference);
  const capReached = pick === undefined && twinPicksCapReached(picks);
  return (
    <section className={styles.copies}>
      <h4 className={styles.title}>{EJES_TWIN_PICK_TEXT.MAP_COPIES_TITLE}</h4>
      <ul className={styles.list}>
        {copies.map((copy) => {
          const chosen = isChosenCopy(copy, pick);
          return (
            <li key={copyKeyOf(copy)} className={styles.item}>
              <span>{copyTextOf(copy)}</span>
              {chosen ? (
                <div className={styles.actions}>
                  <span className={styles.chosen}>
                    <Check size={ICON_SIZE} />
                    <span>{EJES_TWIN_PICK_TEXT.CHOSEN_COPY}</span>
                  </span>
                  <Button variant={ButtonVariant.SECONDARY} onClick={() => onChange({ ref: reference, copy: null })}>
                    <X size={ICON_SIZE} />
                    <span>{EJES_TWIN_PICK_TEXT.CLEAR_CHOICE}</span>
                  </Button>
                </div>
              ) : isPickableCopy(copy) ? (
                <Button variant={ButtonVariant.SECONDARY} disabled={capReached} onClick={() => onChange({ ref: reference, copy })}>
                  <span>{EJES_TWIN_PICK_TEXT.CHOOSE_COPY}</span>
                </Button>
              ) : (
                <span className={styles.hint}>{EJES_TWIN_PICK_TEXT.COPY_NOT_PICKABLE}</span>
              )}
            </li>
          );
        })}
      </ul>
      {capReached && <p className={styles.note}>{EJES_TWIN_PICK_TEXT.CAP_NOTE}</p>}
      {pick !== undefined && <p className={styles.note}>{EJES_TWIN_PICK_TEXT.MAP_ANALYZE_NOTE}</p>}
    </section>
  );
}
