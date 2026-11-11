"use client";

import React from "react";
import type { CentrosBackup, CentrosComparisonRow, CentrosRepeatedRuee, CentrosResult } from "../jobs/centros-anep/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { buildCentrosAnepReportView, signedDifferenceOf, subsistemaTextOf } from "./centrosAnepReportView";
import { CENTROS_NEXT_STEP_TEXT, CENTROS_NEXT_STEP_TITLE } from "./centrosAnepTexts";
import { KpiCards, OutcomeBanners, RowsTable, SectionTitle, TimingsSection, WarningsSection, type TableColumn } from "./ReportParts";
import { RevertBackupSection } from "./RevertBackupSection";
import sharedStyles from "./CargarPadronesReport.module.css";

const COMPARISON_COLUMNS: TableColumn<CentrosComparisonRow>[] = [
  { header: "Subsistema", cell: (row) => subsistemaTextOf(row.value) },
  { header: "Ahora en la tabla final", cell: (row) => String(row.current) },
  { header: "Después del reemplazo", cell: (row) => String(row.after) },
  { header: "Diferencia", cell: (row) => signedDifferenceOf(row.difference) },
];

const REPEATED_COLUMNS: TableColumn<CentrosRepeatedRuee>[] = [
  { header: "ruee", cell: (row) => row.ruee },
  { header: "Filas", cell: (row) => String(row.rows) },
];

const BACKUP_INSTRUCTIONS = [
  "Para revertir, descomprima el .gz y ejecute el .sql completo contra la base, con psql o con pgAdmin / cualquier cliente SQL. Vacía la tabla final y vuelve a insertar las filas que tenía antes de esta carga.",
  "El servidor guarda una copia temporal durante 7 días.",
  "Si el servidor se reinicia, los enlaces de descarga dejan de funcionar: descargue el respaldo antes.",
];

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{title}</SectionTitle>
      <ul className={sharedStyles.list}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function BackupBlock({ backup }: { backup: CentrosBackup }) {
  return (
    <RevertBackupSection
      backup={backup}
      rows={[{ label: "Filas guardadas para restaurar", value: backup.rows }]}
      instructions={BACKUP_INSTRUCTIONS}
    />
  );
}

export interface CentrosAnepReportProps {
  result: CentrosResult;
}

export const CentrosAnepReport: React.FC<CentrosAnepReportProps> = ({ result }) => {
  const view = buildCentrosAnepReportView(result);
  return (
    <div className={sharedStyles.report}>
      <OutcomeBanners banners={view.banners} />
      <KpiCards kpis={view.kpis} />
      <section className={sharedStyles.section}>
        <SectionTitle>Filas por subsistema</SectionTitle>
        <RowsTable columns={COMPARISON_COLUMNS} rows={view.comparisonRows} rowKey={(row) => row.value ?? ""} />
      </section>
      <TextList title="Bloqueos para la carga" items={view.blockers} />
      <TextList title="Privilegios de escritura (información del análisis)" items={view.privilegeInfo} />
      <TextList title="Columnas de la tabla final que no vienen de staging" items={view.columnInfo} />
      <WarningsSection warnings={view.warnings} />
      {view.repeatedRows.length > 0 && (
        <CollapsibleSection summary={view.repeatedSummary}>
          <RowsTable columns={REPEATED_COLUMNS} rows={view.repeatedRows} rowKey={(row) => row.ruee} />
        </CollapsibleSection>
      )}
      {view.backup !== null && <BackupBlock backup={view.backup} />}
      {result.targetModified && (
        <section className={sharedStyles.section}>
          <SectionTitle>{CENTROS_NEXT_STEP_TITLE}</SectionTitle>
          <p className={sharedStyles.hint}>{CENTROS_NEXT_STEP_TEXT}</p>
        </section>
      )}
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
