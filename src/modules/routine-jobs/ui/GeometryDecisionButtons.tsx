"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { AcceptedGeometry, PadronGeometryChange } from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { acceptOfGeometryChange, GeometryDecisionState } from "./geometryAccepts";
import { choicesWithinLimit } from "./pendingPairChoices";
import type { GeometryAcceptSelection } from "./reviewDecisions";
import own from "./PendingPairsSection.module.css";

const ICON_SIZE = 15;
const ACCEPT_LABEL = "Aceptar";
const REJECT_LABEL = "Rechazar";
const LIMIT_TITLE = `Se alcanzó el límite de ${PAIR_LIST_LIMIT} geometrías aceptadas.`;

export interface GeometryDecisionButtonsProps {
  change: PadronGeometryChange;
  state: GeometryDecisionState;
  accepted: readonly AcceptedGeometry[];
  selection: GeometryAcceptSelection;
}

/** Aceptar adds the row's key to the accepted geometries (within the request limit); Rechazar removes it. */
export function GeometryDecisionButtons({ change, state, accepted, selection }: GeometryDecisionButtonsProps) {
  const accept = acceptOfGeometryChange(change);
  if (accept === null || selection.onAcceptMany === undefined || selection.onRejectMany === undefined) return null;
  const { onAcceptMany, onRejectMany } = selection;
  const isAccepted = state === GeometryDecisionState.ACCEPTED;
  const overLimit = !isAccepted && choicesWithinLimit([accept], accepted, PAIR_LIST_LIMIT).truncated;
  return (
    <div className={own.rowActions}>
      <Button
        variant={ButtonVariant.SECONDARY}
        onClick={() => onAcceptMany([accept])}
        disabled={isAccepted || overLimit}
        title={overLimit ? LIMIT_TITLE : undefined}
      >
        <Check size={ICON_SIZE} />
        <span>{ACCEPT_LABEL}</span>
      </Button>
      <Button variant={ButtonVariant.SECONDARY} onClick={() => onRejectMany([accept])} disabled={!isAccepted}>
        <X size={ICON_SIZE} />
        <span>{REJECT_LABEL}</span>
      </Button>
    </div>
  );
}
