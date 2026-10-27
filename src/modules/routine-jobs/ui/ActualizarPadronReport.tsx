"use client";

import React from "react";
import type { ActualizarPadronResult } from "../jobs/actualizar-padron/types";
import {
  buildActualizarReportView,
  type ActualizarBannerKind,
  type ActualizarReportView,
  type GroupRow,
} from "./actualizarPadronReportView";
import { DataTable } from "./DataTable";
import { ReportRowList } from "./ReportRowList";
import styles from "./CargarPadronesReport.module.css";

const BANNER_CLASS: Record<ActualizarBannerKind, string> = {
  unknown: styles.bannerUnknown,
  dryRun: styles.bannerDryRun,
  warning: styles.bannerWarning,
  done: styles.bannerDone,
};
const DECIMAL_PLACES = 2;
const SECONDS_SUFFIX = "s";
const SECTION_TITLES = {
  totals: "Totales",
  skipped: "Filas omitidas por motivo",
  department: "Omitidas por departamento",
  locality: "Omitidas por localidad",
  samples: "Muestras de filas omitidas",
  colliding: "Claves duplicadas",
  warnings: "Advertencias",
  timings: "Tiempos por paso",
  analyze: "Estadísticas",
} as const;

const secondsText = (seconds: number): string => `${seconds.toFixed(DECIMAL_PLACES).replace(".", ",")} ${SECONDS_SUFFIX}`;

const groupRowsOf = (groups: GroupRow[]) => groups.map((group) => ({ label: group.name, value: group.count }));

function SampleTable({ view }: { view: ActualizarReportView }) {
  return (
    <DataTable headers={["Departamento", "Localidad", "Padrón", "Motivo"]}>
      {view.samples.map((sample) => (
        <tr key={`${sample.department}|${sample.locality}|${sample.padron}|${sample.reason}`}>
          <td>{sample.department}</td>
          <td>{sample.locality}</td>
          <td>{sample.padron}</td>
          <td>{sample.reason}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function CollidingKeyList({ view }: { view: ActualizarReportView }) {
  const hidden = view.collidingKeyCount - view.collidingKeys.length;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{SECTION_TITLES.colliding}</h3>
      <p className={styles.hint}>{`Claves con más de una fila: ${view.collidingKeyCount}. Todas sus filas se omiten.`}</p>
      <ul className={styles.list}>
        {view.collidingKeys.map((key, index) => (
          <li key={`${index}-${key.keyLabel}`}>{`${key.keyLabel}: ${key.rows} filas`}</li>
        ))}
      </ul>
      {hidden > 0 && <p className={styles.hint}>{`y ${hidden} más`}</p>}
    </section>
  );
}

function OutcomeBanners({ view }: { view: ActualizarReportView }) {
  return (
    <>
      {view.banners.map((banner) => (
        <div key={banner.kind} className={`${styles.banner} ${BANNER_CLASS[banner.kind]}`}>
          <p className={styles.bannerText}>{banner.text}</p>
        </div>
      ))}
    </>
  );
}

function DetailSections({ view }: { view: ActualizarReportView }) {
  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{SECTION_TITLES.skipped}</h3>
        <ReportRowList rows={view.skippedByReason} />
      </section>
      {view.byDepartment.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{SECTION_TITLES.department}</h3>
          <ReportRowList rows={groupRowsOf(view.byDepartment)} />
        </section>
      )}
      {view.byLocality.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{SECTION_TITLES.locality}</h3>
          <ReportRowList rows={groupRowsOf(view.byLocality)} />
        </section>
      )}
      {view.samples.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{SECTION_TITLES.samples}</h3>
          <SampleTable view={view} />
        </section>
      )}
      {view.collidingKeys.length > 0 && <CollidingKeyList view={view} />}
    </>
  );
}

function ClosingSections({ view }: { view: ActualizarReportView }) {
  return (
    <>
      {view.warnings.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{SECTION_TITLES.warnings}</h3>
          <ul className={styles.list}>
            {view.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{SECTION_TITLES.timings}</h3>
        <ul className={styles.list}>
          {view.timings.map((timing, index) => (
            <li key={`${index}-${timing.label}`}>{`${timing.label}: ${secondsText(timing.seconds)}`}</li>
          ))}
          <li className={styles.total}>{`Total: ${secondsText(view.totalSeconds)}`}</li>
        </ul>
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{SECTION_TITLES.analyze}</h3>
        <p className={styles.hint}>{view.analyze.label}</p>
        {view.analyze.message !== undefined && <p className={styles.hint}>{view.analyze.message}</p>}
      </section>
    </>
  );
}

export interface ActualizarPadronReportProps {
  result: ActualizarPadronResult;
}

export const ActualizarPadronReport: React.FC<ActualizarPadronReportProps> = ({ result }) => {
  const view = buildActualizarReportView(result);

  return (
    <div className={styles.report}>
      <OutcomeBanners view={view} />

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{SECTION_TITLES.totals}</h3>
        <ReportRowList rows={view.totals} />
      </section>

      <DetailSections view={view} />
      <ClosingSections view={view} />
    </div>
  );
};
