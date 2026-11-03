"use client";

import React from "react";
import type { ActualizarTargetReport } from "../jobs/actualizar-padron/types";
import { ReportDownloadActions, ReportDownloadButton } from "./ReportDownloadButton";
import { REPORT_CSV_KIND } from "./reportCsv/filename";
import { buildMissingPadronCsv } from "./reportCsv/missingPadronCsv";
import { ReportRowList } from "./ReportRowList";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { decimalOrNoData } from "./reportFormat";
import type { MissingPadronView, MissingReviewView } from "./missingPadronView";
import { missingReviewItemsOf, type OpenReview } from "./padronReviewItems";
import { MonthlyStage } from "./monthlyCartoStages";
import sharedStyles from "./CargarPadronesReport.module.css";

const AREA_DECIMAL_PLACES = 1;
const PERCENT_DECIMAL_PLACES = 1;
const COORDINATE_DECIMAL_PLACES = 6;
const INFO_TEXT = "El análisis no borra nada: al guardar se eliminan los padrones sin direcciones asociadas ni par sin resolver.";
const REAL_RUN_NOTICE = "La clasificación de padrones que ya no están en el catastro se muestra en el análisis previo.";

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
  { header: "Eliminación", cell: (padron) => padron.removalStatus },
];

export interface MissingPadronSectionProps {
  review: MissingReviewView;
  target: ActualizarTargetReport;
  dryRun: boolean;
  onOpenReview: OpenReview;
}

export const MissingPadronSection: React.FC<MissingPadronSectionProps> = ({ review, target, dryRun, onOpenReview }) => {
  if (!dryRun) return <p className={sharedStyles.hint}>{REAL_RUN_NOTICE}</p>;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{review.title}</SectionTitle>
      <p className={sharedStyles.hint}>{INFO_TEXT}</p>
      <ReportRowList rows={review.counts} />
      {review.shown < review.total && (
        <p className={sharedStyles.hint}>{`Lista incompleta: se muestran las primeras ${review.shown} de ${review.total} padrones faltantes.`}</p>
      )}
      {review.awaitingPairNote !== null && <p className={sharedStyles.hint}>{review.awaitingPairNote}</p>}
      <RowsTable
        columns={MISSING_COLUMNS}
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
      </ReportDownloadActions>
    </section>
  );
};
