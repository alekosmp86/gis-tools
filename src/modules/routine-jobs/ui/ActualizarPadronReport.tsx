"use client";

import React, { useMemo, useState } from "react";
import type { ActualizarPadronResult } from "../jobs/actualizar-padron/types";
import type { GeometryMapBase } from "./clientTypes";
import type { PadronReview, PadronReviewItem } from "./padronReviewItems";
import { PadronMapModal } from "./PadronMapModal";
import {
  readOnlyAcceptsOf,
  type GeometryAcceptSelection,
  type ReviewDecisions,
} from "./reviewDecisions";
import {
  buildActualizarReportView,
  type ActualizarBannerKind,
  type ActualizarReportView,
} from "./actualizarPadronReportView";
import {
  CollapsibleSection,
  CollidingKeyList,
  GroupTopList,
  LocalityTable,
  SampleTable,
  SkippedReasonsTable,
  TimingList,
} from "./ActualizarReportSections";
import { AddressMasterSection } from "./AddressMasterSection";
import { PADRON_ADDRESS_MASTER_TEXTS } from "./addressMasterSubjectTexts";
import { ActualizarBackupSection } from "./ActualizarBackupSection";
import { ActualizarTargetSection } from "./ActualizarTargetSection";
import { MissingPadronSection } from "./MissingPadronSection";
import { PendingGeometryDownload } from "./PendingGeometryDownload";
import type { PairChoiceSelection } from "./PairChoiceGroups";
import { unappliedChoicesOf } from "./pairChoices";
import { RefreshSuggestion } from "./RefreshSuggestion";
import styles from "./ActualizarPadronReport.module.css";
import sharedStyles from "./CargarPadronesReport.module.css";
import { ReportDownloadActions, ReportDownloadButton } from "./ReportDownloadButton";
import { buildActualizarPadronCsv, buildActualizarPadronInconsistenciasCsv } from "./reportCsv/actualizarPadronCsv";
import { REPORT_CSV_KIND } from "./reportCsv/filename";
import { MonthlyStage } from "./monthlyCartoStages";

const BANNER_CLASS: Record<ActualizarBannerKind, string> = {
  unknown: sharedStyles.bannerUnknown,
  dryRun: sharedStyles.bannerDryRun,
  warning: sharedStyles.bannerWarning,
  done: sharedStyles.bannerDone,
};
const SECTION_TITLES = {
  department: "Omitidas por departamento",
  locality: "Omitidas por localidad",
  notFound: "Localidades no encontradas",
  ambiguous: "Localidades ambiguas",
  warnings: "Advertencias",
} as const;

function OutcomeBanners({ view }: { view: ActualizarReportView }) {
  return (
    <>
      {view.banners.map((banner) => (
        <div key={banner.kind} className={`${sharedStyles.banner} ${BANNER_CLASS[banner.kind]}`}>
          <p className={sharedStyles.bannerText}>{banner.text}</p>
        </div>
      ))}
    </>
  );
}

function KpiCards({ view }: { view: ActualizarReportView }) {
  return (
    <section className={styles.kpis}>
      {view.kpis.map((kpi) => (
        <div key={kpi.label} className={styles.kpi}>
          <span className={styles.kpiLabel}>{kpi.label}</span>
          <strong className={styles.kpiValue}>{kpi.value}</strong>
        </div>
      ))}
    </section>
  );
}

function SampleDetails({ view }: { view: ActualizarReportView }) {
  if (view.samples.length === 0) return null;
  return (
    <CollapsibleSection summary={`Muestras de filas omitidas (${view.samples.length})`}>
      <SampleTable view={view} />
    </CollapsibleSection>
  );
}

function CollidingDetails({ view }: { view: ActualizarReportView }) {
  if (view.collidingKeys.length === 0) return null;
  return (
    <CollapsibleSection summary={`Claves duplicadas (${view.collidingKeyCount})`}>
      <CollidingKeyList view={view} />
    </CollapsibleSection>
  );
}

function ClosingSections({ view }: { view: ActualizarReportView }) {
  return (
    <>
      {view.warnings.length > 0 && (
        <section className={sharedStyles.section}>
          <h3 className={sharedStyles.sectionTitle}>{SECTION_TITLES.warnings}</h3>
          <ul className={sharedStyles.list}>
            {view.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
      <CollapsibleSection summary="Tiempos por paso">
        <TimingList view={view} />
      </CollapsibleSection>
    </>
  );
}

export interface ActualizarPadronReportProps {
  result: ActualizarPadronResult;
  pairChoices: PairChoiceSelection;
  geometryAccepts: GeometryAcceptSelection;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  mapBase: GeometryMapBase | null;
}

const GEOMETRY_LOCKED_OFF = "Actualizar geometrías está desactivado: las geometrías pendientes no se pueden aceptar.";

/** An analysis with Actualizar geometrías off cannot accept geometries: the gate applies nothing without the option. */
const geometryLockReasonOf = (result: ActualizarPadronResult): string | null =>
  result.dryRun && !result.target.updateApplied ? GEOMETRY_LOCKED_OFF : null;

/** Only an analysis that updates geometries takes acceptances; a real-run result shows the submitted ones read-only. */
const geometriesEditableIn = (result: ActualizarPadronResult): boolean => result.dryRun && result.target.updateApplied;

export const ActualizarPadronReport: React.FC<ActualizarPadronReportProps> = ({ result, pairChoices, geometryAccepts, mapBase }) => {
  const [review, setReview] = useState<PadronReview | null>(null);
  const view = useMemo(() => buildActualizarReportView(result), [result]);
  const pairSelection: PairChoiceSelection = result.dryRun
    ? pairChoices
    : { choices: pairChoices.submitted, submitted: pairChoices.submitted, canResimulate: false };
  const geometrySelection = geometriesEditableIn(result)
    ? geometryAccepts
    : {
        ...readOnlyAcceptsOf(geometryAccepts.submitted),
        acceptAll: geometryAccepts.submittedAcceptAll,
        submittedAcceptAll: geometryAccepts.submittedAcceptAll,
        acceptAllCount: geometryAccepts.acceptAllCount,
      };
  const unappliedChoices = unappliedChoicesOf(pairSelection.choices, pairSelection.submitted, result.target.pairs);
  const decisions: ReviewDecisions = {
    pairs: pairSelection,
    unappliedChoices,
    geometries: geometrySelection,
    geometryLockReason: geometryLockReasonOf(result),
  };
  const openReview = (items: PadronReviewItem[], index: number) => setReview({ items, index });
  const navigate = (index: number) => setReview((current) => (current === null ? null : { ...current, index }));

  return (
    <div className={sharedStyles.report}>
      <ReportDownloadActions>
        <ReportDownloadButton
          stageSlug={MonthlyStage.ACTUALIZAR_PADRON}
          dryRun={result.dryRun}
          buildCsv={() => buildActualizarPadronCsv(result)}
        />
        {result.dryRun && result.planId !== undefined && result.target.geometryPending > 0 && (
          <PendingGeometryDownload planId={result.planId} />
        )}
        {(result.skipped.skippedRows.length > 0 || result.target.pairsNotApplied > 0) && (
          <ReportDownloadButton
            stageSlug={MonthlyStage.ACTUALIZAR_PADRON}
            dryRun={result.dryRun}
            kind={REPORT_CSV_KIND.INCONSISTENCIES}
            buildCsv={() => buildActualizarPadronInconsistenciasCsv(result)}
          />
        )}
      </ReportDownloadActions>
      <OutcomeBanners view={view} />
      {result.backup !== undefined && !result.dryRun && <ActualizarBackupSection backup={result.backup} />}
      {view.suggestion !== null && <RefreshSuggestion suggestion={view.suggestion} />}
      <KpiCards view={view} />
      <SkippedReasonsTable view={view} />
      <ActualizarTargetSection
        target={view.target}
        selection={pairSelection}
        geometrySelection={geometrySelection}
        unappliedChoices={unappliedChoices}
        onOpenReview={openReview}
      />
      <PadronMapModal review={review} base={mapBase} decisions={decisions} onNavigate={navigate} onClose={() => setReview(null)} />
      {view.target.missingReview !== null && (
        <MissingPadronSection
          review={view.target.missingReview}
          target={result.target}
          dryRun={result.dryRun}
          onOpenReview={openReview}
        />
      )}
      {view.addressMaster !== null && <AddressMasterSection view={view.addressMaster} texts={PADRON_ADDRESS_MASTER_TEXTS} />}
      <div className={sharedStyles.columns}>
        <GroupTopList title={SECTION_TITLES.department} split={view.byDepartmentSplit} />
        <GroupTopList title={SECTION_TITLES.locality} split={view.byLocalitySplit} />
      </div>
      <LocalityTable title={SECTION_TITLES.notFound} rows={view.localitiesNotFound} />
      <LocalityTable title={SECTION_TITLES.ambiguous} rows={view.localitiesAmbiguous} />
      <SampleDetails view={view} />
      <CollidingDetails view={view} />
      <ClosingSections view={view} />
    </div>
  );
};
