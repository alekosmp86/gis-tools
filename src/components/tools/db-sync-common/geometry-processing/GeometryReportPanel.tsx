import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { NoticeLevel, buildReportNotices, type ReportNotice } from "@/core/services/geometryReportNotices";
import type { GeometryProcessingOptions, GeometryProcessingReport } from "@/core/types/geometryProcessing";
import { GeometryReportKpis } from "./GeometryReportKpis";
import {
  AttributeConflictsTable,
  LargestGroupsTable,
  OverlapsTable,
  ReportSection,
} from "./GeometryReportTables";
import styles from "./GeometryReport.module.css";

const ALERT_TYPE_BY_LEVEL: Record<NoticeLevel, AlertType> = {
  [NoticeLevel.ERROR]: AlertType.ERROR,
  [NoticeLevel.WARNING]: AlertType.WARNING,
  [NoticeLevel.INFO]: AlertType.INFO,
};

export interface GeometryReportPanelProps {
  report: GeometryProcessingReport;
  options: GeometryProcessingOptions;
}

const noticeKey = (notice: ReportNotice, index: number): string => `${notice.level}-${index}`;

export const GeometryReportPanel: React.FC<GeometryReportPanelProps> = ({ report, options }) => {
  const notices = buildReportNotices(report, options);
  return (
    <div className={styles.panel}>
      <GeometryReportKpis report={report} />

      {notices.map((notice, index) => (
        <AlertMessage key={noticeKey(notice, index)} type={ALERT_TYPE_BY_LEVEL[notice.level]} text={notice.text} />
      ))}

      {report.attributeConflictSamples.length > 0 && (
        <ReportSection title="Conflictos de atributos" count={report.attributeConflicts}>
          <AttributeConflictsTable samples={report.attributeConflictSamples} />
        </ReportSection>
      )}

      {report.overlapSamples.length > 0 && (
        <ReportSection title="Solapes" count={report.overlapCount}>
          <OverlapsTable samples={report.overlapSamples} />
        </ReportSection>
      )}

      {report.largestGroups.length > 0 && (
        <ReportSection title="Grupos más grandes" count={report.largestGroups.length}>
          <LargestGroupsTable groups={report.largestGroups} />
        </ReportSection>
      )}
    </div>
  );
};
