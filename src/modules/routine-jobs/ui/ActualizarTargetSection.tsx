"use client";

import React, { useMemo } from "react";
import type { PadronInserted, PadronKey, PadronNamedKey, PairChoice } from "../jobs/actualizar-padron/types";
import { pairChoiceKeyId } from "../jobs/actualizar-padron/domain/pairChoiceKey";
import type { PairRowView, TargetView } from "./actualizarPadronReportView";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { ReportRowList } from "./ReportRowList";
import { textOrNoData } from "./reportFormat";
import { PairChoiceGroups, type PairChoiceSelection } from "./PairChoiceGroups";
import { PairChoiceList } from "./PairChoiceList";
import { PendingPairsSection } from "./PendingPairsSection";
import { GeometryChangesSection } from "./GeometryChangesSection";
import type { ListedPairChoice } from "./pairChoices";
import { choiceIndexOf, PENDING_CHOICE_STATE_LABEL, pendingChoiceStateIn, type ChoiceIndex } from "./pendingPairChoices";
import { pairReviewItemsOf, type OpenReview } from "./padronReviewItems";
import type { GeometryAcceptSelection } from "./reviewDecisions";
import { idOrNoData, keyContentOf, locationColumnsOf, NUMBER_COLUMN, SIGNED_CHANGE_HEADER, TYPE_COLUMN } from "./targetColumns";
import sharedStyles from "./CargarPadronesReport.module.css";

const NO_PAIR_DECISION = "No emparejar";
const NO_DECISION = "Sin elección";

const KEY_COLUMNS: TableColumn<PadronKey>[] = [
  TYPE_COLUMN,
  { header: "Provincia (id)", cell: (key) => idOrNoData(key.provinceId) },
  { header: "Localidad (id)", cell: (key) => idOrNoData(key.localityId) },
  NUMBER_COLUMN,
];

const NAMED_COLUMNS: TableColumn<PadronNamedKey>[] = [
  TYPE_COLUMN,
  { header: "Provincia", cell: (key) => textOrNoData(key.department) },
  { header: "Localidad", cell: (key) => textOrNoData(key.locality) },
  NUMBER_COLUMN,
];

const INSERTED_COLUMNS: TableColumn<PadronInserted>[] = [{ header: "Id", cell: (padron) => String(padron.id) }, ...NAMED_COLUMNS];

const PAIR_COLUMNS: TableColumn<PairRowView>[] = [
  { header: "Tipo", cell: (row) => row.view.type },
  { header: "Departamento", cell: (row) => row.view.department },
  { header: "Localidad", cell: (row) => row.view.locality },
  { header: "Padrón", cell: (row) => row.view.number },
  { header: "Id actual", cell: (row) => idOrNoData(row.view.oldId) },
  { header: "Tipo anterior", cell: (row) => row.view.oldType },
  { header: "Localidad anterior", cell: (row) => row.view.oldLocality },
  { header: "Padrón anterior", cell: (row) => row.view.oldNumber },
  ...locationColumnsOf<PairRowView["view"]>(SIGNED_CHANGE_HEADER).map((column) => ({
    header: column.header,
    cell: (row: PairRowView) => column.cell(row.view),
  })),
  { header: "Estado", cell: (row) => row.view.status },
  { header: "Coincidencia", cell: (row) => row.view.tier },
];

/** The decision a pair row carries: the acceptance of a pending pair, or the choice of its new key for an ambiguous one. */
function pairDecisionOf(row: PairRowView, index: ChoiceIndex, ambiguousIds: ReadonlySet<string>): string {
  if (row.pending) return PENDING_CHOICE_STATE_LABEL[pendingChoiceStateIn(index, row.choice)];
  if (row.choice === null || !ambiguousIds.has(pairChoiceKeyId(row.choice))) return "";
  const chosen = index.byKey.get(pairChoiceKeyId(row.choice));
  if (chosen === undefined) return NO_DECISION;
  return chosen.oldId === null ? NO_PAIR_DECISION : `Elegido: id ${chosen.oldId}`;
}

interface TargetDetailsProps {
  target: TargetView;
  selection: PairChoiceSelection;
  geometrySelection: GeometryAcceptSelection;
  choiceRows: readonly ListedPairChoice[];
  unappliedChoices: readonly PairChoice[];
  onOpenReview: OpenReview;
}

function PairsTable({ target, selection, onOpenReview }: Pick<TargetDetailsProps, "target" | "selection" | "onOpenReview">) {
  const { pairRows, ambiguousGroups } = target;
  const columns = useMemo(() => {
    const index = choiceIndexOf(selection.choices);
    const ambiguousIds = new Set(ambiguousGroups.map((group) => group.id));
    return [...PAIR_COLUMNS, { header: "Decisión", cell: (row: PairRowView) => pairDecisionOf(row, index, ambiguousIds) }];
  }, [selection.choices, ambiguousGroups]);
  return (
    <CollapsibleSection summary={target.pairsSummary}>
      <RowsTable
        columns={columns}
        rows={pairRows}
        rowKey={(row) => row.view.key}
        onShowOnMap={(row) => onOpenReview(pairReviewItemsOf(pairRows, ambiguousGroups), pairRows.indexOf(row))}
      />
    </CollapsibleSection>
  );
}

function TargetDetails({ target, selection, geometrySelection, choiceRows, unappliedChoices, onOpenReview }: TargetDetailsProps) {
  const pendingRows = target.pairRows.filter((row) => row.pending);
  return (
    <>
      {target.inserted.length > 0 && (
        <CollapsibleSection summary={target.insertedSummary}>
          <RowsTable columns={INSERTED_COLUMNS} rows={target.inserted} rowKey={(padron) => `${padron.id}`} />
        </CollapsibleSection>
      )}
      {target.geometryChanges.length > 0 && (
        <GeometryChangesSection
          changes={target.geometryChanges}
          summary={target.geometryChangesSummary}
          selection={geometrySelection}
          onResimulate={selection.onResimulate}
          canResimulate={selection.canResimulate}
          onOpenReview={onOpenReview}
        />
      )}
      {target.pairRows.length > 0 && <PairsTable target={target} selection={selection} onOpenReview={onOpenReview} />}
      <PendingPairsSection
        rows={pendingRows}
        pendingTotal={target.pairsPending}
        selection={selection}
        onOpenReview={onOpenReview}
      />
      {choiceRows.length > 0 && <PairChoiceList rows={choiceRows} onRemove={selection.onRemove} />}
      {target.ambiguousGroups.length > 0 && (
        <PairChoiceGroups
          groups={target.ambiguousGroups}
          unappliedChoices={unappliedChoices}
          selection={selection}
          onOpenReview={onOpenReview}
        />
      )}
      {target.missing.length > 0 && (
        <CollapsibleSection summary={target.missingSummary}>
          <RowsTable columns={KEY_COLUMNS} rows={target.missing} rowKey={keyContentOf} />
        </CollapsibleSection>
      )}
      {target.ambiguous.length > 0 && (
        <CollapsibleSection summary={target.ambiguousSummary}>
          <RowsTable columns={KEY_COLUMNS} rows={target.ambiguous} rowKey={keyContentOf} />
        </CollapsibleSection>
      )}
    </>
  );
}

export type ActualizarTargetSectionProps = TargetDetailsProps;

export function ActualizarTargetSection(props: ActualizarTargetSectionProps) {
  const { target } = props;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{target.table}</SectionTitle>
      {target.notes.map((note) => (
        <p key={note} className={sharedStyles.hint}>
          {note}
        </p>
      ))}
      <ReportRowList rows={target.counts} />
      <TargetDetails {...props} />
    </section>
  );
}
