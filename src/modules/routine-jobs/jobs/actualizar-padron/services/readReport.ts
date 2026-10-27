import type { PopulateLayouts } from "../domain/layouts";
import { toReportView, type ReportView } from "../domain/reportMapping";
import { buildReportSql } from "../domain/reportSql";
import type { RunSession } from "../types";

export async function readSkippedReport(session: RunSession, layouts: PopulateLayouts): Promise<ReportView> {
  const result = await session.query(buildReportSql(layouts));
  return toReportView(result.rows[0]);
}
