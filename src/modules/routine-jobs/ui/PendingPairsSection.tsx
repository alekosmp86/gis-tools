"use client";

import React, { useMemo } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { PairChoice } from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { CollapsibleSection } from "./ActualizarReportSections";
import { DataTable } from "./DataTable";
import { RESIMULATE_LABEL, type PairChoiceSelection } from "./PairChoiceGroups";
import styles from "./PairChoiceGroups.module.css";
import own from "./PendingPairsSection.module.css";
import reportStyles from "./ActualizarPadronReport.module.css";
import { ShowOnMapButton } from "./ShowOnMapButton";
import type { PairRowView } from "./actualizarPadronReportView";
import { pairReviewItemsOf, type OpenReview } from "./padronReviewItems";
import {
  acceptableChoicesOf,
  choicesWithinLimit,
  choiceIndexOf,
  PENDING_CHOICE_STATE_LABEL,
  PendingChoiceState,
  pendingChoiceStateIn,
} from "./pendingPairChoices";
import { decimalOrNoData } from "./reportFormat";

const ICON_SIZE = 15;
const PERCENT_DECIMAL_PLACES = 1;
const SECTION_TITLE = "Pares por coincidencia parcial pendientes";
const NOTE = "Aceptar elige el par. El par queda aplicado solo al volver a analizar con la selección.";
const ACCEPT_LABEL = "Aceptar";
const REJECT_LABEL = "Rechazar";
const ACCEPT_ALL_LABEL = "Aceptar todos";
const REJECT_ALL_LABEL = "Rechazar todos";
const HEADERS = [
  "Mapa",
  "Departamento",
  "Localidad",
  "Clave anterior",
  "Clave nueva",
  "Cambio de área (%)",
  "Estado",
  "Acciones",
];

const capNoteOf = (accepted: number, total: number): string =>
  `Aceptar todos llega al límite de ${PAIR_LIST_LIMIT} elecciones: acepta ${accepted} de ${total} pares abiertos.`;

const oldKeyTextOf = (row: PairRowView): string =>
  `${row.view.oldType} · ${row.view.oldLocality} · ${row.view.oldNumber} (id ${row.view.oldId ?? "sin dato"})`;

const newKeyTextOf = (row: PairRowView): string => `${row.view.type} · ${row.view.number}`;

interface PendingRowProps {
  row: PairRowView;
  state: PendingChoiceState;
  canChoose: boolean;
  onAccept: (choice: PairChoice) => void;
  onReject: (choice: PairChoice) => void;
  onShowMap: () => void;
}

function PendingPairRow({ row, state, canChoose, onAccept, onReject, onShowMap }: PendingRowProps) {
  const choice = row.choice;
  const stateClass = state === PendingChoiceState.ACCEPTED ? own.stateAccepted : state === PendingChoiceState.BLOCKED ? own.stateBlocked : "";
  return (
    <tr>
      <td>
        <ShowOnMapButton onShow={onShowMap} />
      </td>
      <td>{row.view.department}</td>
      <td>{row.view.locality}</td>
      <td>{oldKeyTextOf(row)}</td>
      <td>{newKeyTextOf(row)}</td>
      <td>{decimalOrNoData(row.view.areaChangePct, PERCENT_DECIMAL_PLACES)}</td>
      <td className={`${own.state} ${stateClass}`}>{PENDING_CHOICE_STATE_LABEL[state]}</td>
      <td>
        <div className={own.rowActions}>
          {canChoose && choice !== null && (
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onAccept(choice)} disabled={state !== PendingChoiceState.OPEN}>
              <Check size={ICON_SIZE} />
              <span>{ACCEPT_LABEL}</span>
            </Button>
          )}
          {canChoose && choice !== null && (
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onReject(choice)} disabled={state !== PendingChoiceState.ACCEPTED}>
              <X size={ICON_SIZE} />
              <span>{REJECT_LABEL}</span>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export interface PendingPairsSectionProps {
  /** The pending pairs of the report list (AP-93), in report order. */
  rows: PairRowView[];
  /** Every pending pair of the run, listed or not. */
  pendingTotal: number;
  selection: PairChoiceSelection;
  onOpenReview: OpenReview;
}

/** The loose pairs the analysis left pending. Accepting a row chooses it; the re-analysis is what applies it. Read-only without onChoose. */
export function PendingPairsSection({ rows, pendingTotal, selection, onOpenReview }: PendingPairsSectionProps) {
  const { choices, onChoose, onChooseMany, onRemoveMany, onResimulate, canResimulate } = selection;
  const choiceIndex = useMemo(() => choiceIndexOf(choices), [choices]);
  const states = useMemo(() => rows.map((row) => pendingChoiceStateIn(choiceIndex, row.choice)), [rows, choiceIndex]);
  const acceptance = useMemo(() => {
    const open = acceptableChoicesOf(rows.map((row) => row.choice), choices);
    return { open: open.length, ...choicesWithinLimit(open, choices, PAIR_LIST_LIMIT) };
  }, [rows, choices]);
  if (rows.length === 0) return null;
  const canChoose = onChoose !== undefined;
  const acceptedRows = rows.filter((_, index) => states[index] === PendingChoiceState.ACCEPTED);
  const blocked = states.filter((state) => state === PendingChoiceState.BLOCKED).length;
  const acceptedChoices = acceptedRows.flatMap((row) => (row.choice === null ? [] : [row.choice]));
  const isListCapped = pendingTotal > rows.length;

  const acceptOne = (choice: PairChoice) => onChoose?.(choice);
  const rejectOne = (choice: PairChoice) => onRemoveMany?.([choice]);
  const acceptAll = () => onChooseMany?.(acceptance.choices);
  const rejectAll = () => onRemoveMany?.(acceptedChoices);
  const listedNote = `Lista incompleta: se muestran ${rows.length} de ${pendingTotal} pares pendientes. Aceptar todos actúa solo sobre los listados.`;

  return (
    <CollapsibleSection summary={`${SECTION_TITLE} (${rows.length})`}>
      {canChoose && (
        <div className={own.toolbar}>
          <p className={styles.count}>
            {`${acceptedRows.length} aceptados de ${pendingTotal} pendientes${blocked > 0 ? ` · ${blocked} bloqueados` : ""}`}
          </p>
          <div className={own.actions}>
            <Button variant={ButtonVariant.SECONDARY} onClick={acceptAll} disabled={acceptance.open === 0}>
              <Check size={ICON_SIZE} />
              <span>{ACCEPT_ALL_LABEL}</span>
            </Button>
            <Button variant={ButtonVariant.SECONDARY} onClick={rejectAll} disabled={acceptedChoices.length === 0}>
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
      )}
      {canChoose && <p className={styles.note}>{NOTE}</p>}
      {canChoose && isListCapped && (
        <p className={reportStyles.zeroNote}>{listedNote}</p>
      )}
      {canChoose && acceptance.truncated && (
        <p className={reportStyles.zeroNote}>{capNoteOf(acceptance.choices.length, acceptance.open)}</p>
      )}
      <div className={`${reportStyles.tableWrap} ${reportStyles.scrollTable} ${reportStyles.mapColumnTable}`}>
        <DataTable headers={HEADERS}>
          {rows.map((row, index) => (
            <PendingPairRow
              key={row.view.key}
              row={row}
              state={states[index]}
              canChoose={canChoose}
              onAccept={acceptOne}
              onReject={rejectOne}
              onShowMap={() => onOpenReview(pairReviewItemsOf(rows, []), index)}
            />
          ))}
        </DataTable>
      </div>
    </CollapsibleSection>
  );
}
