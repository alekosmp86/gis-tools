"use client";

import React from "react";
import type { AcceptedGeometry, PadronGeometryChange } from "../jobs/actualizar-padron/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { DataTable } from "./DataTable";
import { ShowOnMapButton } from "./ShowOnMapButton";
import { GeometryDecisionButtons } from "./GeometryDecisionButtons";
import { GeometryAcceptEveryBanner } from "./GeometryAcceptEveryBanner";
import { GeometryChangesToolbar } from "./GeometryChangesToolbar";
import { useGeometryChangesModel } from "./useGeometryChangesModel";
import { GEOMETRY_DECISION_LABEL, GeometryDecisionState, isDecidableGeometry } from "./geometryAccepts";
import { geometryReviewItemsOf, type OpenReview } from "./padronReviewItems";
import type { GeometryAcceptSelection } from "./reviewDecisions";
import { GEOMETRY_COLUMNS, keyContentOf } from "./targetColumns";
import own from "./PendingPairsSection.module.css";
import reportStyles from "./ActualizarPadronReport.module.css";

const MAP_HEADER = "Mapa";
const DECISION_HEADER = "Decisión";
const ACTIONS_HEADER = "Acciones";

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
  pendingTotal: number;
  selection: GeometryAcceptSelection;
  onResimulate?: () => void;
  canResimulate: boolean;
  onOpenReview: OpenReview;
}

/** The listed geometry changes with their acceptance (AP-100). Read-only without the selection callbacks. */
export function GeometryChangesSection({ changes: allChanges, summary, pendingTotal, selection, onResimulate, canResimulate, onOpenReview }: GeometryChangesSectionProps) {
  const { accepted, onAcceptMany, onRejectMany, onRejectAll } = selection;
  const acceptAll = selection.acceptAll === true;
  const editable = onAcceptMany !== undefined && onRejectMany !== undefined;
  const { changes, states, acceptance, decidable, acceptedListed } = useGeometryChangesModel(allChanges, selection);
  const openReview = (index: number) => onOpenReview(geometryReviewItemsOf(changes), index);
  if (changes.length === 0 && !acceptAll) return null;
  if (acceptAll) {
    return (
      <CollapsibleSection summary={summary}>
        <GeometryAcceptEveryBanner count={selection.acceptAllCount ?? 0} onRejectAll={editable ? onRejectAll : undefined} />
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection summary={summary}>
      {editable && (
        <GeometryChangesToolbar
          selection={selection}
          onAcceptMany={onAcceptMany}
          onRejectMany={onRejectMany}
          acceptance={acceptance}
          acceptedListed={acceptedListed}
          decidable={decidable}
          pendingTotal={pendingTotal}
          onResimulate={onResimulate}
          canResimulate={canResimulate}
        />
      )}
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
