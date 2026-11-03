import React from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { AcceptedGeometry } from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { ACCEPT_EVERY_NOTE } from "./GeometryAcceptEveryBanner";
import { RESIMULATE_LABEL } from "./PairChoiceGroups";
import type { GeometryAcceptSelection } from "./reviewDecisions";
import groupStyles from "./PairChoiceGroups.module.css";
import own from "./PendingPairsSection.module.css";
import reportStyles from "./ActualizarPadronReport.module.css";

const ICON_SIZE = 15;
const NOTE = "Aceptar aplica la geometría del catastro aunque supere el umbral. Se aplica al volver a analizar con la selección; sin aceptar, queda pendiente.";
const ACCEPT_ALL_LABEL = "Aceptar todos";
const REJECT_ALL_LABEL = "Rechazar todos";
const acceptEveryLabelOf = (pendingTotal: number): string => `Aceptar todas (${pendingTotal})`;
const capNoteOf = (accepted: number, total: number): string =>
  `Aceptar todos llega al límite de ${PAIR_LIST_LIMIT} geometrías aceptadas: acepta ${accepted} de ${total} pendientes listadas.`;

interface GeometryChangesToolbarProps {
  selection: GeometryAcceptSelection;
  onAcceptMany: (choices: AcceptedGeometry[]) => void;
  onRejectMany: (choices: AcceptedGeometry[]) => void;
  acceptance: { open: number; choices: AcceptedGeometry[]; truncated: boolean };
  acceptedListed: number;
  decidable: number;
  pendingTotal: number;
  onResimulate?: () => void;
  canResimulate: boolean;
}

export function GeometryChangesToolbar({
  selection,
  onAcceptMany,
  onRejectMany,
  acceptance,
  acceptedListed,
  decidable,
  pendingTotal,
  onResimulate,
  canResimulate,
}: GeometryChangesToolbarProps) {
  const { accepted, onAcceptAll } = selection;
  return (
    <>
      <div className={own.toolbar}>
        <p className={groupStyles.count}>{`${acceptedListed} aceptadas de ${decidable} pendientes (listadas)`}</p>
        <div className={own.actions}>
          {onAcceptAll !== undefined ? (
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onAcceptAll(pendingTotal)} disabled={pendingTotal === 0}>
              <Check size={ICON_SIZE} />
              <span>{acceptEveryLabelOf(pendingTotal)}</span>
            </Button>
          ) : (
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onAcceptMany(acceptance.choices)} disabled={acceptance.choices.length === 0}>
              <Check size={ICON_SIZE} />
              <span>{ACCEPT_ALL_LABEL}</span>
            </Button>
          )}
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onRejectMany([...accepted])} disabled={accepted.length === 0}>
            <X size={ICON_SIZE} />
            <span>{REJECT_ALL_LABEL}</span>
          </Button>
          {onResimulate !== undefined && (
            <Button variant={ButtonVariant.SECONDARY} onClick={onResimulate} disabled={!canResimulate}>
              <RefreshCw size={ICON_SIZE} />
              <span>{RESIMULATE_LABEL}</span>
            </Button>
          )}
        </div>
      </div>
      <p className={groupStyles.note}>{NOTE}</p>
      {onAcceptAll !== undefined && <p className={groupStyles.note}>{ACCEPT_EVERY_NOTE}</p>}
      {acceptance.truncated && <p className={reportStyles.zeroNote}>{capNoteOf(acceptance.choices.length, acceptance.open)}</p>}
    </>
  );
}
