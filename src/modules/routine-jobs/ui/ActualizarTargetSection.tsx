"use client";

import React from "react";
import type { PadronInserted, PadronKey, PadronNamedKey, PairChoice } from "../jobs/actualizar-padron/types";
import type { TargetView } from "./actualizarPadronReportView";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { ReportRowList } from "./ReportRowList";
import { textOrNoData } from "./reportFormat";
import { PairChoiceGroups, type PairChoiceSelection } from "./PairChoiceGroups";
import { PendingPairsSection } from "./PendingPairsSection";
import { RemovalSection } from "./RemovalSection";
import { GeometryChangesSection } from "./GeometryChangesSection";
import type { OpenReview } from "./padronReviewItems";
import type { GeometryAcceptSelection } from "./reviewDecisions";
import { idOrNoData, keyContentOf, NUMBER_COLUMN, TYPE_COLUMN } from "./targetColumns";
import sharedStyles from "./CargarPadronesReport.module.css";

const appliedGeometriesTextOf = (count: number): string =>
  `${count} geometrías aplicadas sin revisión individual: bajo el umbral o aceptadas en bloque (incluidas en el CSV de cambios).`;

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

interface TargetDetailsProps {
  target: TargetView;
  selection: PairChoiceSelection;
  geometrySelection: GeometryAcceptSelection;
  unappliedChoices: readonly PairChoice[];
  onOpenReview: OpenReview;
}

function TargetDetails({ target, selection, geometrySelection, unappliedChoices, onOpenReview }: TargetDetailsProps) {
  const pendingRows = target.pairRows.filter((row) => row.pending);
  return (
    <>
      {target.inserted.length > 0 && (
        <CollapsibleSection summary={target.insertedSummary}>
          <RowsTable columns={INSERTED_COLUMNS} rows={target.inserted} rowKey={(padron) => `${padron.id}`} />
        </CollapsibleSection>
      )}
      {target.geometryAppliedCount > 0 && <p className={sharedStyles.hint}>{appliedGeometriesTextOf(target.geometryAppliedCount)}</p>}
      <GeometryChangesSection
        changes={target.geometryChanges}
        summary={target.geometryChangesSummary}
        pendingTotal={target.geometryPending}
        selection={geometrySelection}
        onResimulate={selection.onResimulate}
        canResimulate={selection.canResimulate}
        onOpenReview={onOpenReview}
      />
      <PendingPairsSection
        rows={pendingRows}
        pendingTotal={target.pairsPending}
        selection={selection}
        onOpenReview={onOpenReview}
      />
      {target.ambiguousGroups.length > 0 && (
        <PairChoiceGroups
          groups={target.ambiguousGroups}
          unappliedChoices={unappliedChoices}
          selection={selection}
          onOpenReview={onOpenReview}
        />
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
      <p className={sharedStyles.hint}>{target.reviewSummary}</p>
      {target.removal !== null && <RemovalSection view={target.removal} />}
      <TargetDetails {...props} />
    </section>
  );
}
