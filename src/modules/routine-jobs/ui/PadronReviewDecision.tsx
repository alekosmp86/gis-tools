"use client";

import React from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { PadronGeometryChange, PairChoice } from "../jobs/actualizar-padron/types";
import { GeometryDecisionButtons } from "./GeometryDecisionButtons";
import {
  acceptKeySetOf,
  GEOMETRY_DECISION_LABEL,
  GeometryDecisionState,
  geometryDecisionStateOf,
  isDecidableGeometry,
} from "./geometryAccepts";
import { MissingDecisionPanel } from "./MissingDecisionPanel";
import { RESIMULATE_LABEL } from "./PairChoiceGroups";
import { PairChoiceGroupCard } from "./PairChoiceGroupCard";
import { isUnappliedGroup, type AmbiguousGroupView } from "./pairChoices";
import { REVIEW_KIND, type PadronReviewItem } from "./padronReviewItems";
import { PENDING_CHOICE_STATE_LABEL, PendingChoiceState, pendingChoiceStateOf } from "./pendingPairChoices";
import type { ReviewDecisions } from "./reviewDecisions";
import styles from "./PadronReview.module.css";

const ICON_SIZE = 15;
const GEOMETRY_TITLE = "Decisión: geometría que cambia";
const GEOMETRY_NOTE = "Aceptar aplica la geometría del catastro al volver a analizar con la selección.";
const PAIR_TITLE = "Decisión: par por coincidencia parcial";
const PAIR_NOTE = "Aceptar elige el par. El par queda aplicado solo al volver a analizar con la selección.";
const GROUP_TITLE = "Decisión: elija el padrón anterior";
const ACCEPT_LABEL = "Aceptar";
const REJECT_LABEL = "Rechazar";
const MODAL_RADIO_SUFFIX = "-modal";

function DecisionState({ label, accepted }: { label: string; accepted: boolean }) {
  return (
    <p className={styles.stateLine}>
      <span>Estado: </span>
      <span className={`${styles.stateValue} ${accepted ? styles.stateAccepted : ""}`}>{label}</span>
    </p>
  );
}

function ResimulateButton({ decisions }: { decisions: ReviewDecisions }) {
  const { onResimulate, canResimulate } = decisions.pairs;
  if (onResimulate === undefined) return null;
  return (
    <Button variant={ButtonVariant.SECONDARY} onClick={onResimulate} disabled={!canResimulate}>
      <RefreshCw size={ICON_SIZE} />
      <span>{RESIMULATE_LABEL}</span>
    </Button>
  );
}

function GeometryDecision({ change, decisions }: { change: PadronGeometryChange; decisions: ReviewDecisions }) {
  const { geometries, geometryLockReason } = decisions;
  const state = geometryDecisionStateOf(change, acceptKeySetOf(geometries.accepted), acceptKeySetOf(geometries.submitted));
  return (
    <section className={styles.panel}>
      <h4 className={styles.panelTitle}>{GEOMETRY_TITLE}</h4>
      <DecisionState label={GEOMETRY_DECISION_LABEL[state]} accepted={state === GeometryDecisionState.ACCEPTED} />
      {geometryLockReason !== null && <p className={styles.hint}>{geometryLockReason}</p>}
      {geometries.onAcceptMany !== undefined && isDecidableGeometry(state, change) && (
        <>
          <GeometryDecisionButtons change={change} state={state} accepted={geometries.accepted} selection={geometries} />
          <p className={styles.hint}>{GEOMETRY_NOTE}</p>
          <div className={styles.actions}>
            <ResimulateButton decisions={decisions} />
          </div>
        </>
      )}
    </section>
  );
}

function PendingPairDecision({ choice, decisions }: { choice: PairChoice | null; decisions: ReviewDecisions }) {
  const { choices, onChoose, onRemoveMany } = decisions.pairs;
  const state = pendingChoiceStateOf(choice, choices);
  const editable = choice !== null && onChoose !== undefined && onRemoveMany !== undefined;
  return (
    <section className={styles.panel}>
      <h4 className={styles.panelTitle}>{PAIR_TITLE}</h4>
      <DecisionState label={PENDING_CHOICE_STATE_LABEL[state]} accepted={state === PendingChoiceState.ACCEPTED} />
      {editable && (
        <>
          <div className={styles.actions}>
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onChoose(choice)} disabled={state !== PendingChoiceState.OPEN}>
              <Check size={ICON_SIZE} />
              <span>{ACCEPT_LABEL}</span>
            </Button>
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onRemoveMany([choice])} disabled={state !== PendingChoiceState.ACCEPTED}>
              <X size={ICON_SIZE} />
              <span>{REJECT_LABEL}</span>
            </Button>
          </div>
          <p className={styles.hint}>{PAIR_NOTE}</p>
          <div className={styles.actions}>
            <ResimulateButton decisions={decisions} />
          </div>
        </>
      )}
    </section>
  );
}

function AmbiguousDecision({ group, decisions }: { group: AmbiguousGroupView; decisions: ReviewDecisions }) {
  return (
    <section className={styles.panel}>
      <h4 className={styles.panelTitle}>{GROUP_TITLE}</h4>
      <PairChoiceGroupCard
        group={group}
        choices={decisions.pairs.choices}
        unapplied={isUnappliedGroup(group, decisions.unappliedChoices)}
        onChoose={decisions.pairs.onChoose}
        numbered
        radioName={`${group.id}${MODAL_RADIO_SUFFIX}`}
      />
      <div className={styles.actions}>
        <ResimulateButton decisions={decisions} />
      </div>
    </section>
  );
}

export interface PadronReviewDecisionProps {
  item: PadronReviewItem;
  decisions: ReviewDecisions;
}

/** The decision controls of the item on screen, by kind; an applied pair has none. */
export function PadronReviewDecision({ item, decisions }: PadronReviewDecisionProps) {
  switch (item.kind) {
    case REVIEW_KIND.GEOMETRY:
      return <GeometryDecision change={item.change} decisions={decisions} />;
    case REVIEW_KIND.PENDING_PAIR:
      return <PendingPairDecision choice={item.choice} decisions={decisions} />;
    case REVIEW_KIND.AMBIGUOUS:
      return <AmbiguousDecision group={item.group} decisions={decisions} />;
    case REVIEW_KIND.MISSING:
      return <MissingDecisionPanel padron={item.padron} removals={decisions.removals} />;
    case REVIEW_KIND.INFO:
      return null;
  }
}
