"use client";

import React from "react";
import type { CargarPadronesResult } from "../jobs/cargar-padrones/types";
import {
  buildReportView,
  type CargarPadronesReportView,
  type ReportBannerKind,
} from "./cargarPadronesReportView";
import { buildCargarPadronesCsv, buildCargarPadronesInconsistenciasCsv } from "./reportCsv/cargarPadronesCsv";
import { REPORT_CSV_KIND } from "./reportCsv/filename";
import { DataTable } from "./DataTable";
import { ReportDownloadButton } from "./ReportDownloadButton";
import { ReportRowList } from "./ReportRowList";
import { MonthlyStage } from "./monthlyCartoStages";
import styles from "./CargarPadronesReport.module.css";

const BANNER_CLASS: Record<ReportBannerKind, string> = {
  unknown: styles.bannerUnknown,
  dryRun: styles.bannerDryRun,
  warning: styles.bannerWarning,
  done: styles.bannerDone,
};
const EMPTY_VALUE = "sin dato";
const DECIMAL_PLACES = 2;
const SECONDS_SUFFIX = "s";

const countText = (value: string | number | null): string => (value === null ? EMPTY_VALUE : String(value));

const secondsText = (seconds: number): string => `${seconds.toFixed(DECIMAL_PLACES).replace(".", ",")} ${SECONDS_SUFFIX}`;

function ConflictSamples({ view }: { view: CargarPadronesReportView }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Conflictos de atributos</h3>
      <DataTable headers={["Tipo", "Clave", "Columna", "Valores"]}>
        {view.conflictSamples.map((sample) => (
          <tr key={`${sample.unit}-${sample.key}-${sample.column}`}>
            <td>{sample.unit === "rural" ? "Rural" : "Urbano"}</td>
            <td>{sample.key}</td>
            <td>{sample.column}</td>
            <td>{sample.values.join(" / ")}</td>
          </tr>
        ))}
      </DataTable>
      {view.moreConflicts > 0 && <p className={styles.hint}>{`y ${view.moreConflicts} más`}</p>}
    </section>
  );
}

function AmbiguousCodes({ view }: { view: CargarPadronesReportView }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Códigos de localidad ambiguos</h3>
      <p className={styles.hint}>Un mismo código de localidad aparece con nombres distintos en la fuente urbana.</p>
      <ul className={styles.list}>
        {view.ambiguousLocalityCodes.map((code) => (
          <li key={`${code.coddepto}-${code.codloccat}`}>
            {`Departamento ${countText(code.coddepto)}, código ${countText(code.codloccat)}: ${code.names.join(", ")}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface CargarPadronesReportProps {
  result: CargarPadronesResult;
}

export const CargarPadronesReport: React.FC<CargarPadronesReportProps> = ({ result }) => {
  const view = buildReportView(result);

  return (
    <div className={styles.report}>
      <ReportDownloadButton
        stageSlug={MonthlyStage.CARGAR_PADRONES}
        dryRun={result.dryRun}
        buildCsv={() => buildCargarPadronesCsv(result)}
      />
      {result.ambiguousLocalityCodes.length > 0 && (
        <ReportDownloadButton
          stageSlug={MonthlyStage.CARGAR_PADRONES}
          dryRun={result.dryRun}
          kind={REPORT_CSV_KIND.INCONSISTENCIES}
          buildCsv={() => buildCargarPadronesInconsistenciasCsv(result)}
        />
      )}
      <div className={`${styles.banner} ${BANNER_CLASS[view.banner.kind]}`}>
        <p className={styles.bannerText}>{view.banner.text}</p>
      </div>

      <div className={styles.columns}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Rural</h3>
          <ReportRowList rows={view.rural} />
        </section>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Urbano</h3>
          <ReportRowList rows={view.urbano} />
        </section>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Totales</h3>
          <ReportRowList rows={view.totals} />
        </section>
      </div>

      {view.warnings.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Advertencias</h3>
          <ul className={styles.list}>
            {view.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {view.conflictSamples.length > 0 && <ConflictSamples view={view} />}
      {view.ambiguousLocalityCodes.length > 0 && <AmbiguousCodes view={view} />}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Tiempos por paso</h3>
        <ul className={styles.list}>
          {view.timings.map((timing, index) => (
            <li key={`${index}-${timing.label}`}>{`${timing.label}: ${secondsText(timing.seconds)}`}</li>
          ))}
          <li className={styles.total}>{`Total: ${secondsText(view.totalSeconds)}`}</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Estadísticas</h3>
        <p className={styles.hint}>{view.analyze.label}</p>
        {view.analyze.message !== undefined && <p className={styles.hint}>{view.analyze.message}</p>}
      </section>
    </div>
  );
};
