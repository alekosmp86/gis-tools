"use client";

import React, { useMemo } from "react";
import type { ActualizarTargetReport } from "../jobs/actualizar-padron/types";
import { ReportDownloadActions, ReportDownloadButton } from "./ReportDownloadButton";
import { REPORT_CSV_KIND } from "./reportCsv/filename";
import { buildMissingPadronCsv, buildRemovalMarksCsv } from "./reportCsv/missingPadronCsv";
import { ReportRowList } from "./ReportRowList";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { decimalOrNoData } from "./reportFormat";
import { removalDecisionLabelOf, type MissingPadronView, type MissingReviewView } from "./missingPadronView";
import { missingReviewItemsOf, type OpenReview } from "./padronReviewItems";
import type { RemovalMarkSelection } from "./reviewDecisions";
import { MonthlyStage } from "./monthlyCartoStages";
import groupStyles from "./PairChoiceGroups.module.css";
import sharedStyles from "./CargarPadronesReport.module.css";

const AREA_DECIMAL_PLACES = 1;
const PERCENT_DECIMAL_PLACES = 1;
const COORDINATE_DECIMAL_PLACES = 6;
const INFO_TEXT = "Clasificación informativa: el análisis no borra ni modifica estos padrones.";
const REAL_RUN_NOTICE = "La clasificación de padrones que ya no están en el catastro se muestra en el análisis previo.";
const MARKS_NOTE =
  "Marcar para eliminar solo registra la decisión en esta pantalla: no se borra nada ni se envía al servidor. Descargue la lista y elimine los padrones más adelante.";

const MISSING_COLUMNS: TableColumn<MissingPadronView>[] = [
  { header: "Clase", cell: (padron) => padron.classLabel },
  { header: "Tipo", cell: (padron) => padron.type },
  { header: "Departamento", cell: (padron) => padron.department },
  { header: "Localidad", cell: (padron) => padron.locality },
  { header: "Padrón", cell: (padron) => padron.number },
  { header: "Id actual", cell: (padron) => String(padron.oldId) },
  { header: "Área (m²)", cell: (padron) => decimalOrNoData(padron.oldAreaM2, AREA_DECIMAL_PLACES) },
  { header: "Cubierto (%)", cell: (padron) => decimalOrNoData(padron.coveredPct, PERCENT_DECIMAL_PLACES) },
  { header: "Reemplazado por", cell: (padron) => padron.replacedBy },
  { header: "Referencias", cell: (padron) => padron.refs },
  { header: "Latitud", cell: (padron) => decimalOrNoData(padron.centroidLat, COORDINATE_DECIMAL_PLACES) },
  { header: "Longitud", cell: (padron) => decimalOrNoData(padron.centroidLon, COORDINATE_DECIMAL_PLACES) },
];

const markedCountTextOf = (count: number): string =>
  count === 1 ? "1 marcado para eliminar" : `${count} marcados para eliminar`;

export interface MissingPadronSectionProps {
  review: MissingReviewView;
  target: ActualizarTargetReport;
  dryRun: boolean;
  removals: RemovalMarkSelection;
  onOpenReview: OpenReview;
}

export const MissingPadronSection: React.FC<MissingPadronSectionProps> = ({ review, target, dryRun, removals, onOpenReview }) => {
  const markedIds = useMemo(() => new Set(removals.marked), [removals.marked]);
  const columns = useMemo(
    () => [...MISSING_COLUMNS, { header: "Decisión", cell: (padron: MissingPadronView) => removalDecisionLabelOf(markedIds.has(padron.oldId)) }],
    [markedIds],
  );
  if (!dryRun) return <p className={sharedStyles.hint}>{REAL_RUN_NOTICE}</p>;
  const markedCount = review.rows.filter((padron) => markedIds.has(padron.oldId)).length;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{review.title}</SectionTitle>
      <p className={sharedStyles.hint}>{INFO_TEXT}</p>
      <ReportRowList rows={review.counts} />
      {review.shown < review.total && (
        <p className={sharedStyles.hint}>{`Lista incompleta: se muestran las primeras ${review.shown} de ${review.total} padrones faltantes.`}</p>
      )}
      <p className={groupStyles.note}>{MARKS_NOTE}</p>
      <p className={groupStyles.count}>{markedCountTextOf(markedCount)}</p>
      <RowsTable
        columns={columns}
        rows={review.rows}
        rowKey={(padron) => padron.key}
        onShowOnMap={(padron) => onOpenReview(missingReviewItemsOf(review.rows), review.rows.indexOf(padron))}
      />
      <ReportDownloadActions>
        <ReportDownloadButton
          stageSlug={MonthlyStage.ACTUALIZAR_PADRON}
          dryRun={dryRun}
          kind={REPORT_CSV_KIND.MISSING}
          buildCsv={() => buildMissingPadronCsv(target)}
        />
        <ReportDownloadButton
          stageSlug={MonthlyStage.ACTUALIZAR_PADRON}
          dryRun={dryRun}
          kind={REPORT_CSV_KIND.REMOVAL_MARKS}
          disabled={markedCount === 0}
          buildCsv={() => buildRemovalMarksCsv(target, removals.marked)}
        />
      </ReportDownloadActions>
    </section>
  );
};
