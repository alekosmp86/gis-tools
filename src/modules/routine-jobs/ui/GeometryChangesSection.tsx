"use client";

import React, { useMemo } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { AcceptedGeometry, PadronGeometryChange } from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { CollapsibleSection } from "./ActualizarReportSections";
import { DataTable } from "./DataTable";
import { RESIMULATE_LABEL } from "./PairChoiceGroups";
import { ShowOnMapButton } from "./ShowOnMapButton";
import { GeometryDecisionButtons } from "./GeometryDecisionButtons";
import {
  acceptKeySetOf,
  acceptOfGeometryChange,
  GEOMETRY_DECISION_LABEL,
  GeometryDecisionState,
  geometryDecisionStateOf,
  isDecidableGeometry,
} from "./geometryAccepts";
import { choicesWithinLimit } from "./pendingPairChoices";
import { geometryReviewItemsOf, type OpenReview } from "./padronReviewItems";
import type { GeometryAcceptSelection } from "./reviewDecisions";
import { GEOMETRY_COLUMNS, keyContentOf } from "./targetColumns";
import groupStyles from "./PairChoiceGroups.module.css";
import own from "./PendingPairsSection.module.css";
import reportStyles from "./ActualizarPadronReport.module.css";

const ICON_SIZE = 15;
const NOTE = "Aceptar aplica la geometría del catastro aunque supere el umbral. Se aplica al volver a analizar con la selección; sin aceptar, queda pendiente.";
const ACCEPT_ALL_LABEL = "Aceptar todos los listados";
const REJECT_ALL_LABEL = "Rechazar todos";
const MAP_HEADER = "Mapa";
const DECISION_HEADER = "Decisión";
const ACTIONS_HEADER = "Acciones";

const capNoteOf = (accepted: number, total: number): string =>
  `Aceptar todos los listados llega al límite de ${PAIR_LIST_LIMIT} geometrías aceptadas: acepta ${accepted} de ${total} pendientes listadas.`;

const STATE_CLASS: Record<GeometryDecisionState, string> = {
  [GeometryDecisionState.ACCEPTED]: own.stateAccepted,
  [GeometryDecisionState.PENDING]: "",
  [GeometryDecisionState.REJECTED]: own.stateBlocked,
  [GeometryDecisionState.APPLIED]: "",
};

interface GeometryRowProps {
  change: PadronGeometryChange;
  state: GeometryDecisionState;
  editable: boolean;
  accepted: readonly AcceptedGeometry[];
  selection: GeometryAcceptSelection;
  onShowMap: () => void;
}

function GeometryRow({ change, state, editable, accepted, selection, onShowMap }: GeometryRowProps) {
  return (
    <tr>
      <td>
        <ShowOnMapButton onShow={onShowMap} />
      </td>
      {GEOMETRY_COLUMNS.map((column) => (
        <td key={column.header}>{column.cell(change)}</td>
      ))}
      <td className={`${own.state} ${STATE_CLASS[state]}`}>{GEOMETRY_DECISION_LABEL[state]}</td>
      {editable && (
        <td>
          {isDecidableGeometry(state, change) && (
            <GeometryDecisionButtons change={change} state={state} accepted={accepted} selection={selection} />
          )}
        </td>
      )}
    </tr>
  );
}

export interface GeometryChangesSectionProps {
  changes: PadronGeometryChange[];
  summary: string;
  selection: GeometryAcceptSelection;
  onResimulate?: () => void;
  canResimulate: boolean;
  onOpenReview: OpenReview;
}

/** The listed geometry changes with their acceptance (AP-100). Read-only without the selection callbacks. */
export function GeometryChangesSection({ changes, summary, selection, onResimulate, canResimulate, onOpenReview }: GeometryChangesSectionProps) {
  const { accepted, submitted, onAcceptMany, onRejectMany } = selection;
  const editable = onAcceptMany !== undefined && onRejectMany !== undefined;
  const states = useMemo(() => {
    const current = acceptKeySetOf(accepted);
    const shown = acceptKeySetOf(submitted);
    return changes.map((change) => geometryDecisionStateOf(change, current, shown));
  }, [changes, accepted, submitted]);
  const acceptance = useMemo(() => {
    const open = changes.flatMap((change, index) => {
      const accept = states[index] === GeometryDecisionState.PENDING ? acceptOfGeometryChange(change) : null;
      return accept === null ? [] : [accept];
    });
    return { open: open.length, ...choicesWithinLimit(open, accepted, PAIR_LIST_LIMIT) };
  }, [changes, states, accepted]);
  const decidable = changes.filter((change, index) => isDecidableGeometry(states[index], change)).length;
  const acceptedListed = states.filter((state) => state === GeometryDecisionState.ACCEPTED).length;
  const openReview = (index: number) => onOpenReview(geometryReviewItemsOf(changes), index);

  return (
    <CollapsibleSection summary={summary}>
      {editable && (
        <div className={own.toolbar}>
          <p className={groupStyles.count}>{`${acceptedListed} aceptadas de ${decidable} pendientes (listadas)`}</p>
          <div className={own.actions}>
            <Button variant={ButtonVariant.SECONDARY} onClick={() => onAcceptMany(acceptance.choices)} disabled={acceptance.choices.length === 0}>
              <Check size={ICON_SIZE} />
              <span>{ACCEPT_ALL_LABEL}</span>
            </Button>
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
      )}
      {editable && <p className={groupStyles.note}>{NOTE}</p>}
      {editable && acceptance.truncated && <p className={reportStyles.zeroNote}>{capNoteOf(acceptance.choices.length, acceptance.open)}</p>}
      <div className={`${reportStyles.tableWrap} ${reportStyles.scrollTable} ${reportStyles.mapColumnTable}`}>
        <DataTable headers={[MAP_HEADER, ...GEOMETRY_COLUMNS.map((column) => column.header), DECISION_HEADER, ...(editable ? [ACTIONS_HEADER] : [])]}>
          {changes.map((change, index) => (
            <GeometryRow
              key={`${keyContentOf(change)}|${change.oldId ?? ""}`}
              change={change}
              state={states[index]}
              editable={editable}
              accepted={accepted}
              selection={selection}
              onShowMap={() => openReview(index)}
            />
          ))}
        </DataTable>
      </div>
    </CollapsibleSection>
  );
}
