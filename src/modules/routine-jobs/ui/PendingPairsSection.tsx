"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { PairChoice } from "../jobs/actualizar-padron/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { DataTable } from "./DataTable";
import type { PairChoiceSelection } from "./PairChoiceGroups";
import { PendingBulkControls, usePendingBulk } from "./PendingBulkControls";
import own from "./PendingPairsSection.module.css";
import reportStyles from "./ActualizarPadronReport.module.css";
import { ShowOnMapButton } from "./map/ShowOnMapButton";
import type { PairRowView } from "./actualizarPadronReportView";
import { pairReviewItemsOf, type OpenReview } from "./padronReviewItems";
import { PENDING_CHOICE_STATE_LABEL, PendingChoiceState } from "./pendingPairChoices";
import { decimalOrNoData } from "./reportFormat";

const ICON_SIZE = 15;
const PERCENT_DECIMAL_PLACES = 1;
const SECTION_TITLE = "Pares por coincidencia parcial pendientes";
const NOTE = "Aceptar elige el par. El par queda aplicado solo al volver a analizar con la selección.";
const ACCEPT_LABEL = "Aceptar";
const REJECT_LABEL = "Rechazar";
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
  const { onChoose, onRemoveMany } = selection;
  const bulk = usePendingBulk(rows, selection);
  if (rows.length === 0) return null;
  const canChoose = onChoose !== undefined;
  const acceptOne = (choice: PairChoice) => onChoose?.(choice);
  const rejectOne = (choice: PairChoice) => onRemoveMany?.([choice]);

  return (
    <CollapsibleSection summary={`${SECTION_TITLE} (${rows.length})`}>
      <PendingBulkControls bulk={bulk} listed={rows.length} pendingTotal={pendingTotal} selection={selection} hint={NOTE} />
      <div className={`${reportStyles.tableWrap} ${reportStyles.scrollTable} ${reportStyles.mapColumnTable}`}>
        <DataTable headers={HEADERS}>
          {rows.map((row, index) => (
            <PendingPairRow
              key={row.view.key}
              row={row}
              state={bulk.states[index]}
              canChoose={canChoose}
              onAccept={acceptOne}
              onReject={rejectOne}
              onShowMap={() => onOpenReview(pairReviewItemsOf(rows), index)}
            />
          ))}
        </DataTable>
      </div>
    </CollapsibleSection>
  );
}
