"use client";

import React, { useMemo } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { RESIMULATE_LABEL, type PairChoiceSelection } from "./PairChoiceGroups";
import styles from "./PairChoiceGroups.module.css";
import own from "./PendingPairsSection.module.css";
import reportStyles from "./ActualizarPadronReport.module.css";
import type { PairRowView } from "./actualizarPadronReportView";
import { pendingBulkOf, type PendingBulk } from "./pendingPairChoices";

const ICON_SIZE = 15;
const ACCEPT_ALL_LABEL = "Aceptar todos";
const REJECT_ALL_LABEL = "Rechazar todos";

const capNoteOf = (accepted: number, total: number): string =>
  `Aceptar todos llega al límite de ${PAIR_LIST_LIMIT} elecciones: acepta ${accepted} de ${total} pares abiertos.`;

/** The bulk state of the pending pairs of a list against the current choices of the wizard. */
export function usePendingBulk(rows: readonly PairRowView[], selection: PairChoiceSelection): PendingBulk {
  const { choices } = selection;
  return useMemo(() => pendingBulkOf(rows.map((row) => row.choice), choices, PAIR_LIST_LIMIT), [rows, choices]);
}

export interface PendingBulkControlsProps {
  bulk: PendingBulk;
  /** Pending pairs of the list. */
  listed: number;
  /** Every pending pair of the run, listed or not. */
  pendingTotal: number;
  selection: PairChoiceSelection;
  /** A line under the buttons. */
  hint?: string;
}

/** Accept all / reject all, the counter and the notes of the pending loose pairs. Renders nothing without selection callbacks. */
export function PendingBulkControls({ bulk, listed, pendingTotal, selection, hint }: PendingBulkControlsProps) {
  const { onChoose, onChooseMany, onRemoveMany, onResimulate, canResimulate } = selection;
  if (onChoose === undefined) return null;
  const accepted = bulk.acceptedChoices.length;
  return (
    <>
      <div className={own.toolbar}>
        <p className={styles.count}>
          {`${accepted} aceptados de ${pendingTotal} pendientes${bulk.blocked > 0 ? ` · ${bulk.blocked} bloqueados` : ""}`}
        </p>
        <div className={own.actions}>
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onChooseMany?.(bulk.acceptChoices)} disabled={bulk.open === 0}>
            <Check size={ICON_SIZE} />
            <span>{ACCEPT_ALL_LABEL}</span>
          </Button>
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onRemoveMany?.(bulk.acceptedChoices)} disabled={accepted === 0}>
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
      {hint !== undefined && <p className={styles.note}>{hint}</p>}
      {pendingTotal > listed && (
        <p className={reportStyles.zeroNote}>
          {`Lista incompleta: se muestran ${listed} de ${pendingTotal} pares pendientes. Aceptar todos actúa solo sobre los listados.`}
        </p>
      )}
      {bulk.truncated && <p className={reportStyles.zeroNote}>{capNoteOf(bulk.acceptChoices.length, bulk.open)}</p>}
    </>
  );
}
