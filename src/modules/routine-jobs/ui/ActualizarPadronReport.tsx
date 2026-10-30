"use client";

import React from "react";
import type { ActualizarPadronResult } from "../jobs/actualizar-padron/types";
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
import { ActualizarAddressMasterSection } from "./ActualizarAddressMasterSection";
import { ActualizarBackupSection } from "./ActualizarBackupSection";
import { ActualizarTargetSection } from "./ActualizarTargetSection";
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
}

export const ActualizarPadronReport: React.FC<ActualizarPadronReportProps> = ({ result }) => {
  const view = buildActualizarReportView(result);

  return (
    <div className={sharedStyles.report}>
      <ReportDownloadActions>
        <ReportDownloadButton
          stageSlug={MonthlyStage.ACTUALIZAR_PADRON}
          dryRun={result.dryRun}
          buildCsv={() => buildActualizarPadronCsv(result)}
        />
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
      <KpiCards view={view} />
      <SkippedReasonsTable view={view} />
      <ActualizarTargetSection target={view.target} />
      {view.addressMaster !== null && <ActualizarAddressMasterSection view={view.addressMaster} />}
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
